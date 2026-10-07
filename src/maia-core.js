// Maia neural network inference in plain JavaScript (no dependencies).
// Maia (CSSLab, GPLv3) is a Leela Chess Zero network trained to predict the
// move a human of a given rating would play. Weights come from
// tools/convert-maia.mjs: batch norm folded, stored as half floats.

/** Half-float bits to number. */
function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Read a converted .bin file into named Float32Arrays. */
export function loadWeights(buffer) {
  const view = new DataView(buffer);
  const headLen = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLen)));
  let offset = 4 + headLen;
  offset += offset % 2;
  const halves = new Uint16Array(buffer.slice(offset));
  const t = {};
  let i = 0;
  for (const [name, n] of header.tensors) {
    const a = new Float32Array(n);
    for (let k = 0; k < n; k++) a[k] = halfToFloat(halves[i++]);
    t[name] = a;
  }
  return { blocks: header.blocks, level: header.level, t };
}

/** 3x3 or 1x1 convolution over an 8x8 board, channel-major [c][64]. */
function conv(input, cin, w, b, cout, k, relu) {
  const out = new Float32Array(cout * 64);
  const p = k >> 1;
  for (let o = 0; o < cout; o++) {
    const acc = out.subarray(o * 64, o * 64 + 64);
    acc.fill(b[o]);
    for (let c = 0; c < cin; c++) {
      const src = input.subarray(c * 64, c * 64 + 64);
      const wbase = (o * cin + c) * k * k;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const wv = w[wbase + dy * k + dx];
          if (wv === 0) continue;
          const oy0 = Math.max(0, p - dy);
          const oy1 = Math.min(8, 8 + p - dy);
          const ox0 = Math.max(0, p - dx);
          const ox1 = Math.min(8, 8 + p - dx);
          for (let y = oy0; y < oy1; y++) {
            const row = (y + dy - p) * 8 - p + dx;
            const orow = y * 8;
            for (let x = ox0; x < ox1; x++) acc[orow + x] += wv * src[row + x];
          }
        }
      }
    }
    if (relu) for (let q = 0; q < 64; q++) if (acc[q] < 0) acc[q] = 0;
  }
  return out;
}

/** Run the network. planes: Float32Array(112*64). Returns policy logits (4672) and WDL. */
export function forward(net, planes) {
  const t = net.t;
  const C = t['input.b'].length;
  let x = conv(planes, 112, t['input.w'], t['input.b'], C, 3, true);
  for (let i = 0; i < net.blocks; i++) {
    const y1 = conv(x, C, t[`res${i}.c1.w`], t[`res${i}.c1.b`], C, 3, true);
    const y = conv(y1, C, t[`res${i}.c2.w`], t[`res${i}.c2.b`], C, 3, false);
    // Squeeze and excitation.
    const w1 = t[`res${i}.se.w1`];
    const b1 = t[`res${i}.se.b1`];
    const w2 = t[`res${i}.se.w2`];
    const b2 = t[`res${i}.se.b2`];
    const se = b1.length;
    const pooled = new Float32Array(C);
    for (let c = 0; c < C; c++) {
      let s = 0;
      for (let q = 0; q < 64; q++) s += y[c * 64 + q];
      pooled[c] = s / 64;
    }
    const h = new Float32Array(se);
    for (let j = 0; j < se; j++) {
      let s = b1[j];
      for (let c = 0; c < C; c++) s += w1[j * C + c] * pooled[c];
      h[j] = s > 0 ? s : 0;
    }
    const z = new Float32Array(2 * C);
    for (let j = 0; j < 2 * C; j++) {
      let s = b2[j];
      for (let k = 0; k < se; k++) s += w2[j * se + k] * h[k];
      z[j] = s;
    }
    const next = new Float32Array(C * 64);
    for (let c = 0; c < C; c++) {
      const g = 1 / (1 + Math.exp(-z[c]));
      const bb = z[C + c];
      for (let q = 0; q < 64; q++) {
        const v = g * y[c * 64 + q] + bb + x[c * 64 + q];
        next[c * 64 + q] = v > 0 ? v : 0;
      }
    }
    x = next;
  }
  const p1 = conv(x, C, t['policy1.w'], t['policy1.b'], C, 3, true);
  const pc = t['policy.b'].length;
  const policy = conv(p1, C, t['policy.w'], t['policy.b'], pc, 3, false);
  const vc = t['value.b'].length;
  const v1 = conv(x, C, t['value.w'], t['value.b'], vc, 1, true);
  const hid = t['ip1_val.b'].length;
  const h = new Float32Array(hid);
  for (let j = 0; j < hid; j++) {
    let s = t['ip1_val.b'][j];
    const row = j * v1.length;
    for (let k = 0; k < v1.length; k++) s += t['ip1_val.w'][row + k] * v1[k];
    h[j] = s > 0 ? s : 0;
  }
  const wdl = new Float32Array(3);
  for (let j = 0; j < 3; j++) {
    let s = t['ip2_val.b'][j];
    for (let k = 0; k < hid; k++) s += t['ip2_val.w'][j * hid + k] * h[k];
    wdl[j] = s;
  }
  const m = Math.max(...wdl);
  const e = wdl.map(v => Math.exp(v - m));
  const sum = e[0] + e[1] + e[2];
  return { policy, wdl: [e[0] / sum, e[1] / sum, e[2] / sum] };
}

const PIECES = 'pnbrqk';

/** Board squares a1..h8 → piece letters from a FEN board field. */
function boardFromFen(fen) {
  const rows = fen.split(' ')[0].split('/');
  const board = new Array(64).fill(null);
  rows.forEach((row, ri) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        board[(7 - ri) * 8 + file] = ch;
        file++;
      }
    }
  });
  return board;
}

/**
 * Encode the 112 input planes (Leela "classical" format) from the side to
 * move's perspective. fens: positions oldest → newest; the last is current.
 */
export function encode(fens) {
  const planes = new Float32Array(112 * 64);
  const current = fens[fens.length - 1].split(' ');
  const black = current[1] === 'b';
  const keyOf = f => f.split(' ').slice(0, 4).join(' ');
  const counts = new Map();
  const reps = fens.map(f => {
    const k = keyOf(f);
    const n = counts.get(k) || 0;
    counts.set(k, n + 1);
    return n;
  });
  const history = fens.slice(-8).reverse();
  const repHistory = reps.slice(-8).reverse();
  const fill = (planeIndex, fen, rep) => {
    const board = boardFromFen(fen);
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p) continue;
      const white = p === p.toUpperCase();
      const ours = white !== black;
      const type = PIECES.indexOf(p.toLowerCase());
      const r = sq >> 3;
      const f = sq & 7;
      const row = black ? 7 - r : r;
      planes[(planeIndex * 13 + (ours ? 0 : 6) + type) * 64 + row * 8 + f] = 1;
    }
    if (rep >= 1) planes.fill(1, (planeIndex * 13 + 12) * 64, (planeIndex * 13 + 13) * 64);
  };
  history.forEach((fen, i) => fill(i, fen, repHistory[i]));
  // Missing history before a position that is not the start repeats the oldest one.
  const oldest = history[history.length - 1];
  if (history.length < 8 && oldest.split(' ')[0] !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') {
    for (let i = history.length; i < 8; i++) fill(i, oldest, 0);
  }
  const castling = current[2];
  const has = c => castling.includes(c);
  const [usQ, usK, themQ, themK] = black ? ['q', 'k', 'Q', 'K'] : ['Q', 'K', 'q', 'k'];
  const set = (plane, v = 1) => planes.fill(v, plane * 64, plane * 64 + 64);
  if (has(usQ)) set(104);
  if (has(usK)) set(105);
  if (has(themQ)) set(106);
  if (has(themK)) set(107);
  if (black) set(108);
  set(109, Number(current[4] || 0));
  set(111);
  return planes;
}

/**
 * Probabilities for the legal moves. legal: UCI strings from the real board.
 * tables: { index: 1858 UCI strings, map: 4672 plane-square → index }.
 */
export function moveProbabilities(policy, legal, black, tables) {
  if (!tables.lookup) tables.lookup = new Map(tables.index.map((u, i) => [u, i]));
  const logits = new Float32Array(1858).fill(-1e9);
  for (let i = 0; i < tables.map.length; i++) if (tables.map[i] >= 0) logits[tables.map[i]] = policy[i];
  const flip = sq => sq[0] + (9 - Number(sq[1]));
  const scored = legal.map(u => {
    let key = black ? flip(u.slice(0, 2)) + flip(u.slice(2, 4)) + u.slice(4) : u;
    // Leela encodes a knight promotion as the plain move.
    if (key.length === 5 && key[4] === 'n') key = key.slice(0, 4);
    const idx = tables.lookup.get(key);
    return [u, idx === undefined ? -1e9 : logits[idx]];
  });
  const max = Math.max(...scored.map(s => s[1]));
  const exps = scored.map(([u, l]) => [u, Math.exp(l - max)]);
  const sum = exps.reduce((a, [, e]) => a + e, 0);
  return exps.map(([u, e]) => ({ uci: u, p: e / sum })).sort((a, b) => b.p - a.p);
}

/** Sample a move from the distribution; temperature < 1 sharpens it. */
export function sample(probs, rng = Math.random, temperature = 1) {
  const w = probs.map(m => m.p ** (1 / temperature));
  const total = w.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < probs.length; i++) {
    x -= w[i];
    if (x <= 0) return probs[i].uci;
  }
  return probs[0].uci;
}
