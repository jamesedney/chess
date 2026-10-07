import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function serviceWorker() {
  const ctx = { self: { addEventListener() {}, location: {} } };
  vm.runInNewContext(read('sw.js') + '\n;globalThis.__out = { FILES, VERSION };', ctx);
  return ctx.__out;
}

/** Every file the app loads, following static imports from the entry point. */
function moduleGraph(entry) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = read(file);
    for (const m of src.matchAll(
      /(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g,
    )) {
      const rel = path.normalize(path.join(path.dirname(file), m[1] || m[2]));
      if (rel.endsWith('.js') && !rel.includes('stockfish')) visit(rel);
      else seen.add(rel);
    }
  };
  visit(entry);
  return seen;
}

test('versions agree across package.json, the app and the service worker', () => {
  const { VERSION } = serviceWorker();
  assert.equal(VERSION, JSON.parse(read('package.json')).version);
  assert.match(read('src/main.js'), new RegExp(`VERSION = '${VERSION.replace(/\./g, '\\.')}'`));
});

test('every precached file exists', () => {
  for (const f of serviceWorker().FILES) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(root, f)), 'missing ' + f);
  }
});

test('everything the app loads is precached for offline use', () => {
  const files = new Set(serviceWorker().FILES.map(f => f.replace(/^\.\//, '')));
  for (const f of moduleGraph('src/main.js')) assert.ok(files.has(f), `${f} is imported but not in sw.js`);
  assert.ok(files.has('vendor/stockfish-17.1-lite-single-03e3232.wasm'));
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="\.\/([^"#]+)"/g)) assert.ok(files.has(m[1]), `${m[1]} from index.html not cached`);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(files.has(icon.src.replace('./', '')), icon.src);
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable') && manifest.icons.some(i => i.purpose === 'any'));
});
