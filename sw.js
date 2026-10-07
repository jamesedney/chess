const CACHE='rankup-v1.0.0';
const FILES=['./','./index.html','./style.css','./app.js','./engine.js','./puzzles.js','./lessons.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./vendor/chess.js','./vendor/stockfish-17.1-lite-single-03e3232.js','./vendor/stockfish-17.1-lite-single-03e3232.wasm',...['w','b'].flatMap(c=>[...'kqrbnp'].map(p=>'./pieces/'+c+p+'.png'))];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rankup-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});
