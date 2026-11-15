// Service worker: tiene in memoria i file dell'app così si apre anche con poca rete.
// Quando cambi i file, aumenta VERSION per far aggiornare i telefoni.
const VERSION = "pop-v8";
const SHELL = ["./", "index.html", "privacy.html", "style.css", "app.js", "store.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "fonts/fredoka-latin.woff2", "fonts/nunito-latin.woff2", "images/gruppo.webp", "images/asino.webp"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // Firebase e font passano direttamente
  // Prima la rete (così vedi subito gli aggiornamenti), la copia salvata se sei offline.
  // "no-cache" chiede sempre al server se il file è cambiato, invece di usare la cache del browser.
  e.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
