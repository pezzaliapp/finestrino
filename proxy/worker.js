// Finestrino: intermediario gratuito per i dati degli aerei (Cloudflare Workers, piano Free).
// Gli aggregatori ADS-B non permettono richieste dirette da altri siti (CORS):
// questo Worker le fa al posto del browser e aggiunge l'intestazione che manca.
//
// Uso: GET /point/{lat}/{lon}/{raggio_nm}

// Siti autorizzati a usare il Worker. Aggiungi qui il tuo dominio se lo cambi.
const ALLOWED = [
  'https://alessandropezzali.it',
  'https://www.alessandropezzali.it',
  'https://pezzaliapp.github.io',
  'http://localhost:8000',
];

const SOURCES = [
  { name: 'adsb.lol', url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}` },
  { name: 'adsb.fi', url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
];

function corsHeaders(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Finestrino-Source',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origin && !ALLOWED.includes(origin)) {
      return new Response('Origine non autorizzata', { status: 403, headers: cors });
    }

    const m = new URL(request.url).pathname.match(/^\/point\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/);
    if (!m) return new Response('Uso: /point/{lat}/{lon}/{raggio_nm}', { status: 404, headers: cors });

    const lat = Number(m[1]).toFixed(4);
    const lon = Number(m[2]).toFixed(4);
    const nm = Math.min(250, Number(m[3]));

    const errors = [];
    for (const src of SOURCES) {
      try {
        const res = await fetch(src.url(lat, lon, nm), {
          headers: { 'User-Agent': 'Finestrino (https://github.com/pezzaliapp/finestrino)' },
          cf: { cacheTtl: 5, cacheEverything: true },
        });
        if (!res.ok) {
          errors.push(`${src.name}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
          continue;
        }
        return new Response(res.body, {
          headers: {
            ...cors,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=5',
            'X-Finestrino-Source': src.name,
          },
        });
      } catch (e) {
        errors.push(`${src.name}: ${e.message}`);
      }
    }
    return new Response(JSON.stringify({ error: 'fonti non raggiungibili', details: errors }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
