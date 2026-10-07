// An accessible chess board: tap, drag or keyboard (arrow keys + Enter).
import { NAMES } from './chess-utils.js';

const FILES = 'abcdefgh';
let uid = 0;

export class BoardView {
  /**
   * el: container element. options.onMove({from, to, promotion}) is called for
   * legal moves; options.askPromotion(color) resolves to a piece letter.
   */
  constructor(el, { onMove = null, onSquare = null, askPromotion = async () => 'q', label = 'Chess board' } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.onSquare = onSquare; // when set, any tapped square is reported instead of selecting pieces
    this.askPromotion = askPromotion;
    this.game = null;
    this.orientation = 'w';
    this.interactive = false;
    this.movable = null; // restrict moves to one colour
    this.selected = null;
    this.lastMove = [];
    this.marks = {};
    this.arrows = [];
    this.focusSquare = null;
    this.id = 'board' + ++uid;
    this.handled = null; // the square a pointer gesture just handled itself
    this.drag = null;
    this.squares = null;
    this.builtFor = null;

    el.classList.add('board');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', label);
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'board-arrows');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.setAttribute('aria-hidden', 'true');
    this.live = document.createElement('div');
    this.live.className = 'visually-hidden';
    this.live.setAttribute('aria-live', 'polite');
    el.replaceChildren(this.grid, this.svg, this.live);

    this.grid.addEventListener('click', e => this.click(e));
    this.grid.addEventListener('keydown', e => this.key(e));
    this.grid.addEventListener('pointerdown', e => this.pointerDown(e));
    this.grid.addEventListener('pointermove', e => this.pointerMove(e));
    this.grid.addEventListener('pointerup', e => this.pointerUp(e));
    this.grid.addEventListener('pointercancel', () => this.endDrag());
    this.grid.addEventListener('contextmenu', e => e.preventDefault());
  }

  set(options) {
    Object.assign(this, options);
    if ('game' in options || 'interactive' in options) {
      this.selected = null;
      this.endDrag();
    }
    this.render();
  }

  announce(text) {
    this.live.textContent = '';
    requestAnimationFrame(() => (this.live.textContent = text));
  }

  canPick(sq) {
    const p = this.game?.get(sq);
    return !!(
      this.interactive &&
      p &&
      p.color === this.game.turn() &&
      (!this.movable || p.color === this.movable) &&
      !this.game.isGameOver()
    );
  }

  legalTargets(from) {
    return from ? new Set(this.game.moves({ square: from, verbose: true }).map(m => m.to)) : new Set();
  }

  /** Select, switch selection, deselect, or move to `sq` — the same rules for taps, keys and drops. */
  async tap(sq) {
    if (!this.game) return;
    this.focusSquare = sq;
    if (!this.interactive) return this.render();
    if (this.canPick(sq)) {
      this.selected = this.selected === sq ? null : sq;
      return this.render();
    }
    if (!this.selected) return this.render();
    const from = this.selected;
    const moves = this.game.moves({ square: from, verbose: true }).filter(m => m.to === sq);
    this.selected = null;
    if (!moves.length) {
      // Tapping elsewhere just clears the selection, as on Lichess.
      this.render();
      return;
    }
    let promotion;
    if (moves.some(m => m.promotion)) promotion = await this.askPromotion(this.game.turn());
    this.render();
    await this.onMove?.({ from, to: sq, ...(promotion ? { promotion } : {}) });
  }

  click(e) {
    const sq = e.target.closest('[data-square]')?.dataset.square;
    if (!sq) return;
    // pointerUp already handled the gesture on this square; skip the click the browser adds.
    if (sq === this.handled?.square && Date.now() - this.handled.at < 400) {
      this.handled = null;
      return;
    }
    if (this.onSquare && !this.interactive) {
      this.focusSquare = sq;
      this.onSquare(sq);
      return;
    }
    this.tap(sq);
  }

  flash(sq) {
    const b = this.squares?.get(sq);
    if (!b) return;
    b.classList.add('wrong');
    setTimeout(() => b.classList.remove('wrong'), 450);
  }

  squareAt(x, y) {
    const b = document.elementFromPoint(x, y)?.closest?.('[data-square]');
    return b && this.grid.contains(b) ? b.dataset.square : null;
  }

  pointerDown(e) {
    if (e.button > 0 || this.drag) return;
    const sq = e.target.closest('[data-square]')?.dataset.square;
    // Taps on destination squares are left to the click handler.
    if (!sq || !this.canPick(sq)) return;
    e.preventDefault();
    this.drag = {
      from: sq,
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      moved: false,
      wasSelected: this.selected === sq,
      touch: e.pointerType !== 'mouse',
    };
    this.selected = sq;
    this.focusSquare = sq;
    this.render();
    try {
      this.grid.setPointerCapture(e.pointerId);
    } catch {}
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.moved = true;
      const origin = this.squares.get(d.from);
      d.size = origin.getBoundingClientRect().width;
      d.ghost = document.createElement('img');
      d.ghost.src = origin.querySelector('img').src;
      d.ghost.alt = '';
      d.ghost.className = 'drag-ghost';
      d.ghost.style.width = d.ghost.style.height = d.size + 'px';
      document.body.append(d.ghost);
      origin.classList.add('drag-origin');
      d.legal = this.legalTargets(d.from);
    }
    // On touch screens, lift the piece above the finger so it stays visible.
    const lift = d.touch ? d.size * 0.6 : 0;
    const scale = d.touch ? 1.35 : 1.1;
    d.ghost.style.transform = `translate(${e.clientX - d.size / 2}px, ${e.clientY - d.size / 2 - lift}px) scale(${scale})`;
    const over = this.squareAt(e.clientX, e.clientY);
    if (over !== d.over) {
      if (d.over) this.squares.get(d.over)?.classList.remove('drag-over');
      if (over && d.legal.has(over)) this.squares.get(over)?.classList.add('drag-over');
      d.over = over;
    }
  }

  pointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.handled = { square: d.from, at: Date.now() };
    const target = d.moved ? this.squareAt(e.clientX, e.clientY) : null;
    this.endDrag();
    if (!d.moved) {
      // A tap on your own piece: a second tap on the same piece deselects it.
      if (d.wasSelected) {
        this.selected = null;
        this.render();
      }
      return;
    }
    if (target && target !== d.from && this.legalTargets(d.from).has(target)) this.tap(target);
    else this.render(); // dropped off target: snap back and stay selected
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost?.remove();
    this.squares?.get(d.from)?.classList.remove('drag-origin');
    if (d.over) this.squares?.get(d.over)?.classList.remove('drag-over');
    try {
      this.grid.releasePointerCapture(d.id);
    } catch {}
  }

  key(e) {
    const sq = e.target.closest?.('[data-square]')?.dataset.square;
    if (!sq) return;
    const dirs = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dirs[e.key]) {
      e.preventDefault();
      let [dx, dy] = dirs[e.key];
      if (this.orientation === 'b') [dx, dy] = [-dx, -dy];
      const f = FILES.indexOf(sq[0]) + dx;
      const r = Number(sq[1]) + dy;
      if (f < 0 || f > 7 || r < 1 || r > 8) return;
      this.focusSquare = FILES[f] + r;
      this.updateFocus(true);
    } else if (e.key === 'Escape' && this.selected) {
      this.selected = null;
      this.render();
    }
  }

  updateFocus(move) {
    const target = this.focusTarget();
    for (const [sq, b] of this.squares || []) b.tabIndex = sq === target ? 0 : -1;
    if (move) this.squares?.get(target)?.focus({ preventScroll: true });
  }

  focusTarget() {
    return this.focusSquare || this.selected || this.lastMove[1] || (this.orientation === 'w' ? 'e2' : 'e7');
  }

  squareLabel(sq, p, legal) {
    let label = sq + ', ' + (p ? `${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}` : 'empty');
    if (this.selected === sq) label += ', selected';
    if (legal) label += p ? ', can capture' : ', legal move';
    if (this.lastMove.includes(sq)) label += ', last move';
    return label;
  }

  /** Create the 64 squares once per orientation; later renders update them in place. */
  build() {
    const files = this.orientation === 'w' ? FILES : [...FILES].reverse().join('');
    const ranks = this.orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    this.squares = new Map();
    const frag = document.createDocumentFragment();
    ranks.forEach((rank, ri) => {
      [...files].forEach((file, fi) => {
        const sq = file + rank;
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.square = sq;
        b.dataset.shade = (FILES.indexOf(file) + rank) % 2 === 1 ? 'dark' : 'light';
        if (fi === 0) b.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank}</span>`);
        if (ri === 7) b.insertAdjacentHTML('beforeend', `<span class="coord file">${file}</span>`);
        this.squares.set(sq, b);
        frag.append(b);
      });
    });
    this.grid.replaceChildren(frag);
    this.builtFor = this.orientation;
  }

  render() {
    if (!this.game) {
      this.grid.replaceChildren();
      this.builtFor = null;
      return;
    }
    if (this.builtFor !== this.orientation) this.build();
    const hadFocus = this.grid.contains(document.activeElement);
    const legal = this.legalTargets(this.selected);
    let checked = null;
    if (this.game.isCheck()) {
      for (const row of this.game.board()) for (const p of row) if (p && p.type === 'k' && p.color === this.game.turn()) checked = p.square;
    }
    const target = this.focusTarget();
    for (const [sq, b] of this.squares) {
      const p = this.game.get(sq);
      const cls = ['square', b.dataset.shade];
      if (this.selected === sq) cls.push('selected');
      if (legal.has(sq)) cls.push(p ? 'capture' : 'dot');
      if (this.lastMove.includes(sq)) cls.push('last');
      if (checked === sq) cls.push('check');
      if (this.marks[sq]) cls.push('mark-' + this.marks[sq]);
      if (this.canPick(sq)) cls.push('movable');
      if (this.drag?.from === sq && this.drag.moved) cls.push('drag-origin');
      b.className = cls.join(' ');
      b.tabIndex = sq === target ? 0 : -1;
      b.setAttribute('aria-label', this.squareLabel(sq, p, legal.has(sq)));
      const piece = p ? p.color + p.type : '';
      if (b.dataset.piece !== piece) {
        b.querySelector('img')?.remove();
        if (piece) b.insertAdjacentHTML('beforeend', `<img src="./pieces/${piece}.svg" alt="" draggable="false">`);
        b.dataset.piece = piece;
      }
    }
    this.el.dataset.fen = this.game.fen();
    this.drawArrows();
    if (hadFocus && document.activeElement !== this.squares.get(target)) this.squares.get(target)?.focus({ preventScroll: true });
  }

  drawArrows() {
    const pos = sq => {
      let x = FILES.indexOf(sq[0]);
      let y = 8 - Number(sq[1]);
      if (this.orientation === 'b') [x, y] = [7 - x, 7 - y];
      return [x + 0.5, y + 0.5];
    };
    this.svg.innerHTML = this.arrows
      .map(({ from, to, kind = 'best' }) => {
        const [x1, y1] = pos(from);
        const [x2, y2] = pos(to);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        const ex = x2 - ux * 0.3;
        const ey = y2 - uy * 0.3;
        const head = `${x2},${y2} ${ex - uy * 0.22},${ey + ux * 0.22} ${ex + uy * 0.22},${ey - ux * 0.22}`;
        return `<g class="arrow arrow-${kind}"><line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}"/><polygon points="${head}"/></g>`;
      })
      .join('');
  }
}

/** Board card markup shared by the pages. */
export function boardCard({ id = 'board', title = '', chip = '', footer = '' } = {}) {
  return `<div class="board-card"><div class="board-top"><strong id="${id}-title">${title}</strong><span class="chip" id="${id}-chip">${chip}</span></div><div class="board-wrap"><div id="${id}"></div></div><div class="board-bottom"><span id="${id}-note" class="board-note">${footer}</span><button type="button" id="${id}-flip" class="secondary" aria-label="Flip board">⇅ Flip</button></div></div>`;
}

export function turnLabel(game) {
  if (game.isCheckmate()) return 'Checkmate';
  if (game.isStalemate()) return 'Stalemate';
  if (game.isDraw()) return 'Draw';
  return (game.turn() === 'w' ? 'White' : 'Black') + (game.isCheck() ? ' in check' : ' to move');
}
