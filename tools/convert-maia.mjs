// Convert Maia (Leela Chess Zero format) networks into compact files the
// browser can load: batch norm folded into the convolutions, weights stored
// as IEEE half floats, plus the move-index tables.
//
//   node tools/convert-maia.mjs
//
// Inputs (tools/data): maia-<level>.pb.gz from github.com/CSSLab/maia-chess
// (GPLv3), lc0-policy-index.py and lc0-policy-map.h from Leela Chess Zero (GPLv3).
// Outputs: maia/maia-<level>.bin and maia/tables.json.
import fs from 'node:fs';
import zlib from 'node:zlib';

const DATA = new URL('./data/', import.meta.url);
const OUT = new URL('../maia/', import.meta.url);
export const LEVELS = [1100, 1500, 1900];

function varint(b, i) {
  let r = 0n;
  let s = 0n;
  for (;;) {
    const c = b[i++];
    r |= BigInt(c & 0x7f) << s;
    s += 7n;
    if (c < 0x80) return [Number(r), i];
  }
}

/** Decode one protobuf message into { field: [values] }. */
export function parse(b) {
  const out = {};
  let i = 0;
  while (i < b.length) {
    let key;
    [key, i] = varint(b, i);
    const f = key >> 3;
    const wt = key & 7;
    let v;
    if (wt === 0) [v, i] = varint(b, i);
    else if (wt === 1) ((v = b.subarray(i, i + 8)), (i += 8));
    else if (wt === 5) ((v = b.subarray(i, i + 4)), (i += 4));
    else if (wt === 2) {
      let len;
      [len, i] = varint(b, i);
      v = b.subarray(i, i + len);
      i += len;
    } else throw new Error('Unsupported wire type ' + wt);
    (out[f] ||= []).push(v);
  }
  return out;
}

const f32 = b => new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);

/** A Layer: linear16-quantised values between min and max. */
function layer(b) {
  const d = parse(b);
  const min = f32(d[1][0]);
  const max = f32(d[2][0]);
  const raw = d[3][0];
  const n = raw.length / 2;
  const out = new Float32Array(n);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.length);
  for (let i = 0; i < n; i++) out[i] = min + ((max - min) * view.getUint16(i * 2, true)) / 65535;
  return out;
}

/** A ConvBlock with batch norm folded into weights and biases (as lc0 does). */
function convBlock(b) {
  const d = parse(b);
  const w = layer(d[1][0]);
  let bias = d[2] ? layer(d[2][0]) : null;
  if (!d[3]) return { w, b: bias };
  const means = layer(d[3][0]);
  const vars = layer(d[4][0]);
  const gam = d[5] ? layer(d[5][0]) : new Float32Array(means.length).fill(1);
  const bet = d[6] ? layer(d[6][0]) : new Float32Array(means.length);
  bias ||= new Float32Array(means.length);
  const out = means.length;
  const per = w.length / out;
  const nb = new Float32Array(out);
  for (let o = 0; o < out; o++) {
    const g = gam[o] / Math.sqrt(vars[o] + 1e-5);
    for (let k = 0; k < per; k++) w[o * per + k] *= g;
    nb[o] = -g * (means[o] - bias[o]) + bet[o];
  }
  return { w, b: nb };
}

/** Float32 to IEEE 754 half, round to nearest. */
function toHalf(v) {
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, v);
  const x = buf.getUint32(0);
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7c00;
  const h = sign | (exp << 10) | (mant >> 13);
  return mant & 0x1000 ? h + 1 : h;
}

/** Ordered list of tensors; the browser reads them back in this order. */
export function tensors(path) {
  const net = parse(zlib.gunzipSync(fs.readFileSync(path)));
  const W = parse(net[10][0]);
  const list = [];
  const push = (name, t) => list.push([name, t]);
  const input = convBlock(W[1][0]);
  push('input.w', input.w);
  push('input.b', input.b);
  W[2].forEach((r, i) => {
    const rd = parse(r);
    const c1 = convBlock(rd[1][0]);
    const c2 = convBlock(rd[2][0]);
    const se = parse(rd[3][0]);
    push(`res${i}.c1.w`, c1.w);
    push(`res${i}.c1.b`, c1.b);
    push(`res${i}.c2.w`, c2.w);
    push(`res${i}.c2.b`, c2.b);
    push(`res${i}.se.w1`, layer(se[1][0]));
    push(`res${i}.se.b1`, layer(se[2][0]));
    push(`res${i}.se.w2`, layer(se[3][0]));
    push(`res${i}.se.b2`, layer(se[4][0]));
  });
  const p1 = convBlock(W[11][0]);
  const p = convBlock(W[3][0]);
  const v = convBlock(W[6][0]);
  push('policy1.w', p1.w);
  push('policy1.b', p1.b);
  push('policy.w', p.w);
  push('policy.b', p.b);
  push('value.w', v.w);
  push('value.b', v.b);
  push('ip1_val.w', layer(W[7][0]));
  push('ip1_val.b', layer(W[8][0]));
  push('ip2_val.w', layer(W[9][0]));
  push('ip2_val.b', layer(W[10][0]));
  return { list, blocks: W[2].length };
}

export function tables() {
  const src = fs.readFileSync(new URL('lc0-policy-index.py', DATA), 'utf8');
  const index = JSON.parse(
    src
      .slice(src.indexOf('[', src.indexOf('policy_index')), src.lastIndexOf(']') + 1)
      .replace(/'/g, '"')
      .replace(/,\s*\]/, ']'),
  );
  const pm = fs.readFileSync(new URL('lc0-policy-map.h', DATA), 'utf8');
  // 73 move planes x 64 squares; the network's last 7 policy channels are unused.
  const start = pm.indexOf('{', pm.indexOf('kConvPolicyMap'));
  const body = pm.slice(start, pm.indexOf('};', start));
  const map = (body.match(/-?\d+/g) || []).map(Number);
  if (index.length !== 1858 || map.length !== 73 * 64) throw new Error('Unexpected lc0 table sizes');
  return { index, map };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const level of LEVELS) {
    const { list, blocks } = tensors(new URL(`maia-${level}.pb.gz`, DATA));
    const header = { level, blocks, tensors: list.map(([name, t]) => [name, t.length]) };
    const total = list.reduce((a, [, t]) => a + t.length, 0);
    const halves = new Uint16Array(total);
    let o = 0;
    for (const [, t] of list) for (let i = 0; i < t.length; i++) halves[o++] = toHalf(t[i]);
    const head = Buffer.from(JSON.stringify(header));
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(head.length);
    const pad = Buffer.alloc((4 - ((4 + head.length) % 2)) % 2);
    fs.writeFileSync(new URL(`maia-${level}.bin`, OUT), Buffer.concat([lenBuf, head, pad, Buffer.from(halves.buffer)]));
    console.log(`maia-${level}.bin: ${blocks} blocks, ${total} weights, ${(8 + head.length + total * 2) / 1e6} MB`);
  }
  fs.writeFileSync(new URL('tables.json', OUT), JSON.stringify(tables()));
  console.log('tables.json written');
}
