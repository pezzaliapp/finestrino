// Finestrino service worker: prima la rete (versione più recente), la copia salvata solo offline.
// Gestisce solo i file del sito; mappe, dati e librerie esterne passano senza intervento.
const CACHE = 'finestrino-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.url.includes('version.json')) return; // sempre dalla rete, gestito dall'app

  event.respondWith((async () => {
    try {
      // 'no-cache' = chiede al server se il file è cambiato, ignorando la cache del browser
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return fresh;
    } catch {
      const saved = await caches.match(req);
      return saved || Response.error();
    }
  })());
});
