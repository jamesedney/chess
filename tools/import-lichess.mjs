// Import a rated, varied slice of the Lichess puzzle database (CC0).
//
//   node tools/import-lichess.mjs --download              # stream from database.lichess.org
//   node tools/import-lichess.mjs --input lichess_db_puzzle.csv.zst
//   options: --count 3000 --min 500 --max 2000 --max-lines 600000
//
// Writes tools/data/lichess.json. Then run: node tools/build-puzzles.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';

const URL_DB = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

export function parseRow(line) {
  const cols = line.split(',');
  if (cols.length < 8 || cols[0] === 'PuzzleId') return null;
  const [id, fen, moves, rating, deviation, popularity, plays, themes, gameUrl] = cols;
  const list = moves.trim().split(' ');
  if (list.length < 2 || list.length % 2 !== 0) return null;
  return {
    lichessId: id,
    fen,
    setup: list[0],
    line: list.slice(1),
    rating: Number(rating),
    deviation: Number(deviation),
    popularity: Number(popularity),
    plays: Number(plays),
    tags: themes.trim().split(' ').filter(Boolean),
    gameUrl,
  };
}

export function goodQuality(row) {
  return row.deviation <= 90 && row.popularity >= 80 && row.plays >= 300;
}

/** Stratified reservoir sampling: an even spread over 100-point rating bands. */
export class BandSampler {
  constructor({ count, min, max, rng = Math.random }) {
    this.min = min;
    this.max = max;
    this.rng = rng;
    this.bands = Math.ceil((max - min) / 100);
    this.perBand = Math.ceil(count / this.bands);
    this.store = Array.from({ length: this.bands }, () => ({ seen: 0, items: [] }));
  }
  add(row) {
    if (row.rating < this.min || row.rating >= this.max) return;
    const band = this.store[Math.floor((row.rating - this.min) / 100)];
    band.seen++;
    if (band.items.length < this.perBand) band.items.push(row);
    else {
      const j = Math.floor(this.rng() * band.seen);
      if (j < this.perBand) band.items[j] = row;
    }
  }
  result() {
    return this.store.flatMap(b => b.items);
  }
}

async function openInput(args) {
  if (args.download) {
    const res = await fetch(URL_DB);
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    return Readable.fromWeb(res.body).pipe(zlib.createZstdDecompress());
  }
  const stream = fs.createReadStream(args.input);
  return args.input.endsWith('.zst') ? stream.pipe(zlib.createZstdDecompress()) : stream;
}

export async function importLichess(args) {
  const sampler = new BandSampler({ count: Number(args.count || 3000), min: Number(args.min || 500), max: Number(args.max || 2000) });
  const input = await openInput(args);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const maxLines = Number(args['max-lines'] || 600000);
  let n = 0;
  for await (const line of rl) {
    if (++n > maxLines) break;
    const row = parseRow(line);
    if (row && goodQuality(row)) sampler.add(row);
  }
  rl.close();
  input.destroy?.();
  const rows = sampler
    .result()
    .map(({ lichessId, fen, setup, line, rating, tags, gameUrl }) => ({ lichessId, fen, setup, line, rating, tags, gameUrl }));
  return { rows, read: n };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
  }
  if (!args.download && !args.input) {
    console.error('Pass --download or --input <file.csv|file.csv.zst>.');
    process.exit(1);
  }
  const out = args.out || new URL('./data/lichess.json', import.meta.url);
  const { rows, read } = await importLichess(args);
  fs.writeFileSync(out, JSON.stringify(rows));
  console.log(`Read ${read} rows; kept ${rows.length} puzzles. Now run: node tools/build-puzzles.mjs`);
}
