// An accessible chess board: tap, drag or keyboard (arrow keys + Enter).
import { NAMES } from './chess-utils.js';

const FILES = 'abcdefgh';
let uid = 0;

export class BoardView {
  /**
   * el: container element. options.onMove({from, to, promotion}) is called for
   * legal moves; options.askPromotion(color) resolves to a piece letter.
   */
  constructor(el, { onMove = null, askPromotion = async () => 'q', label = 'Chess board' } = {}) {
    this.el = el;
    this.onMove = onMove;
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
    this.lastDrag = 0;

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

    this.grid.addEventListener('click', e => {
      const b = e.target.closest('[data-square]');
      // A drag already made its move; ignore the click the browser sends after it.
      if (b && Date.now() - this.lastDrag > 300) this.tap(b.dataset.square);
    });
    this.grid.addEventListener('keydown', e => this.key(e));
    this.grid.addEventListener('pointerdown', e => this.dragStart(e));
  }

  set(options) {
    Object.assign(this, options);
    if ('game' in options || 'interactive' in options) this.selected = null;
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
      this.render();
      this.announce('That move is not legal.');
      this.flash(sq);
      return;
    }
    let promotion;
    if (moves.some(m => m.promotion)) promotion = await this.askPromotion(this.game.turn());
    this.render();
    await this.onMove?.({ from, to: sq, ...(promotion ? { promotion } : {}) });
  }

  flash(sq) {
    const b = this.grid.querySelector(`[data-square="${sq}"]`);
    if (!b) return;
    b.classList.add('wrong');
    setTimeout(() => b.classList.remove('wrong'), 450);
  }

  dragStart(e) {
    const b = e.target.closest('[data-square]');
    if (!b || e.button > 0 || !this.canPick(b.dataset.square)) return;
    const from = b.dataset.square;
    if (this.selected !== from) {
      this.selected = from;
      this.render();
    }
    const done = () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', done);
    };
    const up = ev => {
      done();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-square]');
      if (target && this.grid.contains(target) && target.dataset.square !== from) {
        this.lastDrag = Date.now();
        this.tap(target.dataset.square);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', done);
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
    for (const b of this.grid.querySelectorAll('[data-square]')) b.tabIndex = b.dataset.square === this.focusTarget() ? 0 : -1;
    if (move) this.grid.querySelector(`[data-square="${this.focusTarget()}"]`)?.focus({ preventScroll: true });
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

  render() {
    if (!this.game) {
      this.grid.innerHTML = '';
      return;
    }
    const hadFocus = this.grid.contains(document.activeElement);
    const legal = this.selected ? new Set(this.game.moves({ square: this.selected, verbose: true }).map(m => m.to)) : new Set();
    const files = this.orientation === 'w' ? FILES : [...FILES].reverse().join('');
    const ranks = this.orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    let checked = null;
    if (this.game.isCheck()) {
      for (const row of this.game.board()) for (const p of row) if (p && p.type === 'k' && p.color === this.game.turn()) checked = p.square;
    }
    const target = this.focusTarget();
    let html = '';
    ranks.forEach((rank, ri) => {
      [...files].forEach((file, fi) => {
        const sq = file + rank;
        const p = this.game.get(sq);
        const dark = (FILES.indexOf(file) + rank) % 2 === 1;
        const cls = ['square', dark ? 'dark' : 'light'];
        if (this.selected === sq) cls.push('selected');
        if (legal.has(sq)) cls.push(p ? 'capture' : 'dot');
        if (this.lastMove.includes(sq)) cls.push('last');
        if (checked === sq) cls.push('check');
        if (this.marks[sq]) cls.push('mark-' + this.marks[sq]);
        html += `<button type="button" class="${cls.join(' ')}" data-square="${sq}" tabindex="${sq === target ? 0 : -1}" aria-label="${this.squareLabel(sq, p, legal.has(sq))}">`;
        if (fi === 0) html += `<span class="coord rank">${rank}</span>`;
        if (ri === 7) html += `<span class="coord file">${file}</span>`;
        if (p) html += `<img src="./pieces/${p.color}${p.type}.png" alt="" draggable="false">`;
        html += '</button>';
      });
    });
    this.grid.innerHTML = html;
    this.el.dataset.fen = this.game.fen();
    this.drawArrows();
    if (hadFocus) this.grid.querySelector(`[data-square="${target}"]`)?.focus({ preventScroll: true });
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
