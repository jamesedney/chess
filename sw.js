// Rankup service worker: precache the app for offline use.
// Bump VERSION (and package.json) for every release; tests check they match.
const VERSION = '7.0.0';
const CACHE = 'rankup-v' + VERSION;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './fonts/nunito.woff2',
  './src/main.js',
  './src/settings.js',
  './src/app-context.js',
  './src/state.js',
  './src/ui.js',
  './src/board.js',
  './src/appearance.js',
  './src/sound.js',
  './src/chess-utils.js',
  './src/engine.js',
  './src/uci-parse.js',
  './src/evaluation.js',
  './src/verify.js',
  './src/srs.js',
  './src/rating.js',
  './src/mistakes.js',
  './src/tagger.js',
  './src/analyse.js',
  './src/deep.js',
  './src/pgn.js',
  './src/sync.js',
  './src/queue.js',
  './src/ratings.js',
  './src/rating-sync.js',
  './src/nemesis.js',
  './src/maia.js',
  './src/maia-core.js',
  './src/maia-worker.js',
  './maia/tables.json',
  './src/pages/train.js',
  './src/pages/play.js',
  './src/pages/you.js',
  './data/puzzles.js',
  './vendor/chess.js',
  './vendor/stockfish-17.1-lite-single-03e3232.js',
  './vendor/stockfish-17.1-lite-single-03e3232.wasm',
  './icons/icon-192-bw.png',
  './icons/icon-512-bw.png',
  './icons/icon-maskable-512-bw.png',
  './icons/apple-touch-icon-bw.png',
  './THIRD-PARTY.md',
  ...['cburnett', 'merida', 'chessnut', 'kiwen-suwi', 'mpchess'].flatMap(set =>
    ['w', 'b'].flatMap(c => [...'KQRBNP'].map(p => `./pieces/${set}/${c}${p}.svg`)),
  ),
];
// Large optional files: deployed with the site but cached only on first use
// (see the fetch handler). tools/stage-site.mjs publishes these as well.
const LAZY_FILES = ['./maia/maia-1100.bin', './maia/maia-1500.bin', './maia/maia-1900.bin'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rankup-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Maia networks are large and optional: cache each one the first time it is used.
  if (new URL(request.url).pathname.includes('/maia/') && request.url.endsWith('.bin')) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(request).then(
          hit =>
            hit ||
            fetch(request).then(res => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
