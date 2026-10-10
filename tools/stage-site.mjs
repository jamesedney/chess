// Copy exactly the files the app needs into _site/ for deployment.
// The list comes from sw.js (FILES and LAZY_FILES), so the deployed site and
// the offline cache agree.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, process.argv[2] || '_site');
const ctx = { self: { addEventListener() {}, location: {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8') + '\n;globalThis.__files = [...FILES, ...LAZY_FILES];', ctx);
const extra = [
  'sw.js',
  '.nojekyll',
  'LICENSE',
  'THIRD-PARTY.md',
  'vendor/STOCKFISH-LICENSE.txt',
  'vendor/chess.LICENSE',
  'vendor/DEJAVU-LICENSE.txt',
];
const files = [...ctx.__files.filter(f => f !== './').map(f => f.replace(/^\.\//, '')), ...extra];

fs.rmSync(out, { recursive: true, force: true });
for (const f of new Set(files)) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) throw new Error('Missing file for the site: ' + f);
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(src, path.join(out, f));
}
console.log(`Staged ${new Set(files).size} files in ${path.relative(root, out)}/`);
