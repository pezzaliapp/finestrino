// Finestrino: intermediario gratuito per i dati degli aerei su Vercel (piano Hobby).
// Gli aggregatori ADS-B non permettono richieste dirette da altri siti (CORS):
// questa funzione le fa al posto del browser e aggiunge l'intestazione che manca.
//
// Uso: GET /point/{lat}/{lon}/{raggio_nm}

// Siti autorizzati. Aggiungi qui il tuo dominio se lo cambi.
const ALLOWED = [
  'https://alessandropezzali.it',
  'https://www.alessandropezzali.it',
  'https://pezzaliapp.github.io',
  'http://localhost:8000',
];

const UA = 'Finestrino (https://github.com/pezzaliapp/finestrino)';

// OpenSky restituisce un formato diverso: lo convertiamo in quello di adsb.lol
function fromOpenSky(json) {
  const ac = (json.states || []).filter((s) => !s[8] && s[5] != null && s[6] != null).map((s) => ({
    hex: s[0],
    flight: s[1] || '',
    lat: s[6],
    lon: s[5],
    alt_geom: s[13] != null ? s[13] / 0.3048 : undefined,
    alt_baro: s[7] != null ? s[7] / 0.3048 : undefined,
    gs: s[9] != null ? s[9] * 1.943844 : undefined,
    track: s[10] ?? undefined,
    geom_rate: s[11] != null ? s[11] * 196.8504 : 0,
    seen_pos: json.time && s[3] ? Math.max(0, json.time - s[3]) : 0,
    squawk: s[14] || undefined,
  }));
  return JSON.stringify({ ac });
}

const SOURCES = [
  { name: 'adsb.lol', url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}` },
  { name: 'adsb.fi', url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
  {
    name: 'OpenSky Network',
    url: (lat, lon, nm) => {
      const dLat = nm / 60;
      const dLon = nm / (60 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      return `https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(3)}&lomin=${(lon - dLon).toFixed(3)}`
        + `&lamax=${(+lat + dLat).toFixed(3)}&lomax=${(+lon + dLon).toFixed(3)}`;
    },
    convert: fromOpenSky,
  },
];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Finestrino-Source');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (origin && !ALLOWED.includes(origin)) return res.status(403).send('Origine non autorizzata');

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const nm = Math.min(250, Math.max(1, Math.round(Number(req.query.nm))));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !nm) {
    return res.status(400).send('Uso: /point/{lat}/{lon}/{raggio_nm}');
  }
  // Arrotondare permette alla cache di Vercel di servire più visitatori vicini con una sola richiesta
  const la = lat.toFixed(2);
  const lo = lon.toFixed(2);

  const errors = [];
  for (const src of SOURCES) {
    try {
      const r = await fetch(src.url(la, lo, nm), {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        errors.push(`${src.name}: HTTP ${r.status}`);
        continue;
      }
      const text = await r.text();
      const body = src.convert ? src.convert(JSON.parse(text)) : text;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');
      res.setHeader('X-Finestrino-Source', src.name);
      return res.status(200).send(body);
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  return res.status(502).send(JSON.stringify({ error: 'fonti non raggiungibili', details: errors }));
}
