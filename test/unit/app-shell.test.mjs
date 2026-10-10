import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function serviceWorker() {
  const ctx = { self: { addEventListener() {}, location: {} } };
  vm.runInNewContext(read('sw.js') + '\n;globalThis.__out = { FILES, LAZY_FILES, VERSION };', ctx);
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

test('every Maia level has its network deployed, and the staged site contains every file', async () => {
  const { FILES, LAZY_FILES } = serviceWorker();
  const { LEVELS } = await import('../../src/strength.js');
  for (const l of LEVELS.filter(l => l.mode === 'maia'))
    assert.ok(LAZY_FILES.includes(`./maia/maia-${l.maia}.bin`), `maia ${l.maia} not deployed`);
  for (const f of LAZY_FILES) assert.ok(fs.existsSync(path.join(root, f)), 'missing ' + f);
  // Stage the site exactly as the Pages workflow does and check nothing the app fetches is left out.
  const { execFileSync } = await import('node:child_process');
  const out = fs.mkdtempSync(path.join(root, '.stage-test-'));
  try {
    execFileSync(process.execPath, ['tools/stage-site.mjs', path.relative(root, out)], { cwd: root, stdio: 'pipe' });
    for (const f of [...FILES, ...LAZY_FILES])
      if (f !== './') assert.ok(fs.existsSync(path.join(out, f)), `${f} missing from the deployed site`);
    // Local links in the app (such as the licences page) must be deployed too.
    for (const file of fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(f => String(f).endsWith('.js')))
      for (const m of read(path.join('src', String(file))).matchAll(/href="\.\/([^"#?]+)"/g))
        assert.ok(fs.existsSync(path.join(out, m[1])), `${m[1]} linked from src/${file} is not deployed`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
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
