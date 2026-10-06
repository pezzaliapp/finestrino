// Ricerca dei voli e rotte (da dove viene, dove va), tramite il tuo intermediario Vercel.
import { AIRCRAFT_PROXY } from './config.js';

const base = () => AIRCRAFT_PROXY.replace(/\/+$/, '');

async function get(path, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${base()}${path}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Cerca aerei in volo per numero di volo, codice radio, registrazione o identificativo. Restituisce i dati grezzi. */
export async function findFlight(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const j = await get(`/find/${encodeURIComponent(q)}`);
  return j.ac || [];
}

const routes = new Map(); // codice radio -> Promise<route|null>

/** Rotta del volo (partenza e arrivo), con memoria per non chiederla due volte. */
export function getRoute(callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  if (cs.length < 3) return Promise.resolve(null);
  if (!routes.has(cs)) {
    routes.set(cs, get(`/route/${encodeURIComponent(cs)}`, 10000).then((j) => j.route || null).catch(() => {
      routes.delete(cs); // riproverà più tardi
      return null;
    }));
  }
  return routes.get(cs);
}

/** La rotta già nota (senza attendere), oppure undefined se non ancora arrivata. */
const known = new Map();
export function knownRoute(callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  if (!known.has(cs)) {
    known.set(cs, undefined);
    getRoute(cs).then((r) => known.set(cs, r));
  }
  return known.get(cs);
}

export function placeName(a) {
  if (!a) return '?';
  const city = a.city || a.name || a.icao || '?';
  return a.iata ? `${city} (${a.iata})` : city;
}
