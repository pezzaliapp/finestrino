// Funzioni comuni dell'intermediario.
export const ALLOWED = [
  'https://alessandropezzali.it',
  'https://www.alessandropezzali.it',
  'https://pezzaliapp.github.io',
  'http://localhost:8000',
];

export const UA = 'Finestrino (https://github.com/pezzaliapp/finestrino)';

/** Imposta CORS e risponde da solo a OPTIONS o a origini non autorizzate. Restituisce true se ha già risposto. */
export function cors(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (origin && !ALLOWED.includes(origin)) { res.status(403).send('{"error":"origine non autorizzata"}'); return true; }
  return false;
}

export async function getJson(url, timeout = 7000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

/** Aerei entro {nm} miglia nautiche da un punto (in volo e a terra): adsb.lol, poi adsb.fi. */
export async function pointAircraft(lat, lon, nm) {
  const la = Number(lat).toFixed(2);
  const lo = Number(lon).toFixed(2);
  const r = Math.min(250, Math.max(1, Math.round(nm)));
  const urls = [
    `https://api.adsb.lol/v2/point/${la}/${lo}/${r}`,
    `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${r}`,
  ];
  for (const url of urls) {
    try {
      const j = await getJson(url, 9000);
      return (j.ac || j.aircraft || []).filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
    } catch { /* prova la fonte successiva */ }
  }
  return [];
}

const routeMemo = new Map();

/** Rotta di un codice radio da adsbdb, ricordata per 30 minuti: { flight, origin, destination } oppure null. */
export async function fetchRoute(cs) {
  const hit = routeMemo.get(cs);
  if (hit && Date.now() - hit.at < 1800000) return hit.value;
  let value = null;
  try {
    const j = await getJson(`https://api.adsbdb.com/v0/callsign/${cs}`, 6000);
    const r = j.response && j.response.flightroute;
    if (r) {
      value = {
        flight: r.callsign_iata || null,
        origin: r.origin ? { iata: r.origin.iata_code || null, icao: r.origin.icao_code || null, city: r.origin.municipality || null, name: r.origin.name || null } : null,
        destination: r.destination ? { iata: r.destination.iata_code || null, icao: r.destination.icao_code || null, city: r.destination.municipality || null, name: r.destination.name || null } : null,
      };
    }
  } catch (e) {
    if (e.status !== 404) return null; // errore temporaneo: non lo ricordiamo
  }
  routeMemo.set(cs, { at: Date.now(), value });
  if (routeMemo.size > 3000) routeMemo.delete(routeMemo.keys().next().value);
  return value;
}

/** Distanza in miglia nautiche tra due punti. */
export function distanceNm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return (2 * 6371 * Math.asin(Math.sqrt(a))) / 1.852;
}

/** Punto a frazione f del cammino più breve tra due punti. */
export function alongRoute(lat1, lon1, lat2, lon2, f) {
  const r = Math.PI / 180;
  const [p1, l1, p2, l2] = [lat1 * r, lon1 * r, lat2 * r, lon2 * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
}
