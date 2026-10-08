// Rankup service worker: precache the app for offline use.
// Bump VERSION (and package.json) for every release; tests check they match.
const VERSION = '2.1.2';
const CACHE = 'rankup-v' + VERSION;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './src/main.js',
  './src/app-context.js',
  './src/board.js',
  './src/charts.js',
  './src/chess-utils.js',
  './src/engine.js',
  './src/evaluation.js',
  './src/mistakes.js',
  './src/pgn.js',
  './src/rating.js',
  './src/srs.js',
  './src/state.js',
  './src/strength.js',
  './src/tagger.js',
  './src/themes.js',
  './src/uci-parse.js',
  './src/ui.js',
  './src/verify.js',
  './src/vision.js',
  './src/mistake-kinds.js',
  './src/appearance.js',
  './src/sound.js',
  './src/clocks.js',
  './src/openings.js',
  './src/deep.js',
  './src/endgames.js',
  './src/calc.js',
  './src/coach.js',
  './src/personal-lessons.js',
  './src/analyse.js',
  './src/sync.js',
  './src/queue.js',
  './src/guide.js',
  './src/maia.js',
  './src/maia-core.js',
  './src/maia-worker.js',
  './maia/tables.json',
  './src/pages/train.js',
  './src/pages/path.js',
  './src/pages/play.js',
  './src/pages/review.js',
  './src/pages/progress.js',
  './src/pages/drills.js',
  './src/pages/coach.js',
  './data/puzzles.js',
  './data/lessons.js',
  './data/openings.js',
  './data/endgames.js',
  './vendor/chess.js',
  './vendor/stockfish-17.1-lite-single-03e3232.js',
  './vendor/stockfish-17.1-lite-single-03e3232.wasm',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './THIRD-PARTY.md',
  ...['cburnett', 'merida', 'chessnut', 'kiwen-suwi', 'mpchess'].flatMap(set =>
    ['w', 'b'].flatMap(c => [...'KQRBNP'].map(p => `./pieces/${set}/${c}${p}.svg`)),
  ),
];

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
