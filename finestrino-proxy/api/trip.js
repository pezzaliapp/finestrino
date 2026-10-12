// Finestrino: trova un volo conoscendo compagnia e rotta, senza orari a pagamento.
// Esempio: FR299 da Ancona (AOI) a Catania (CTA). Ryanair via radio lo chiama RYR2SN,
// quindi il numero di volo da solo non basta: guardiamo gli aerei della compagnia
// vicino ai due aeroporti e lungo la rotta, chiediamo a ciascuno la sua rotta (adsbdb)
// e teniamo quello che va da AOI a CTA. Funziona anche con l'aereo a terra, se trasmette.
// Uso: GET /trip/{volo}/{partenza}/{arrivo}   es. /trip/FR299/AOI/CTA
import { cors, getJson, pointAircraft, fetchRoute, distanceNm, alongRoute } from './_common.js';
import AIRPORTS from './_airports.js';

// Compagnie che volano con più codici radio (gruppi e filiali)
const GROUPS = {
  FR: ['RYR', 'MAY', 'RYS', 'RUK', 'LDA'],
  U2: ['EZY', 'EJU', 'EZS'],
  EC: ['EJU'],
  W6: ['WZZ', 'WMT', 'WUK', 'WAZ'],
  W4: ['WMT'],
  VY: ['VLG'],
  V7: ['VOE'],
  AZ: ['ITY'],
  LH: ['DLH', 'CLH'],
  AF: ['AFR', 'HOP'],
  KL: ['KLM', 'KLC'],
  BA: ['BAW', 'SHT', 'CFE'],
  IB: ['IBE', 'IBS', 'ANE'],
  EW: ['EWG', 'EWE'],
  LX: ['SWR'],
  OS: ['AUA'],
  TK: ['THY'],
};

const airlineMemo = new Map();

async function airlineCodes(prefix) {
  if (/^[A-Z]{3}$/.test(prefix)) return [prefix];
  if (airlineMemo.has(prefix)) return airlineMemo.get(prefix);
  const codes = new Set(GROUPS[prefix] || []);
  try {
    const j = await getJson(`https://api.adsbdb.com/v0/airline/${prefix}`, 5000);
    const list = Array.isArray(j.response) ? j.response : [j.response];
    for (const a of list) if (a && a.icao) codes.add(a.icao);
  } catch { /* bastano i gruppi noti */ }
  const out = [...codes];
  if (out.length) airlineMemo.set(prefix, out);
  return out;
}

const same = (a, code) => a && code && (a.iata === code.iata || (a.icao && a.icao === code.icao));

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const flight = String(req.query.f || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const from = String(req.query.from || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const to = String(req.query.to || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const m = flight.match(/^([A-Z][A-Z0-9]|[A-Z0-9][A-Z]|[A-Z]{3})0*(\d{1,4}[A-Z]?)$/) || flight.match(/^([A-Z][A-Z0-9]|[A-Z0-9][A-Z]|[A-Z]{3})$/);
  const A = AIRPORTS[from];
  const B = AIRPORTS[to];
  if (!m || !A || !B || from === to) return res.status(400).send('{"error":"uso: /trip/{volo}/{partenza}/{arrivo}"}');
  const prefix = m[1];
  const number = m[2] || null;
  const codes = await airlineCodes(prefix);
  const orig = { iata: from, icao: A[2] };
  const dest = { iata: to, icao: B[2] };

  // Zone da guardare: i due aeroporti e qualche punto lungo la rotta (massimo 6 richieste)
  const dist = distanceNm(A[0], A[1], B[0], B[1]);
  const zones = [{ lat: A[0], lon: A[1], nm: 40 }, { lat: B[0], lon: B[1], nm: 40 }];
  const legs = Math.min(4, Math.ceil(dist / 450));
  for (let i = 1; i <= legs; i++) {
    const p = alongRoute(A[0], A[1], B[0], B[1], (i - 0.5) / legs);
    zones.push({ ...p, nm: Math.min(250, dist / legs / 2 + 40) });
  }
  const seen = new Map();
  for (const list of await Promise.all(zones.map((z) => pointAircraft(z.lat, z.lon, z.nm)))) {
    for (const a of list) if (a.hex && !seen.has(a.hex)) seen.set(a.hex, a);
  }

  // Solo gli aerei della compagnia, con il codice radio
  const mine = [...seen.values()].filter((a) => {
    const cs = (a.flight || '').trim().toUpperCase();
    return cs && (codes.length ? codes.some((c) => cs.startsWith(c)) : true);
  }).slice(0, 80);

  const matches = [];
  const nearby = [];
  await Promise.all(mine.map(async (a) => {
    const cs = a.flight.trim().toUpperCase();
    const rt = await fetchRoute(cs);
    const byNumber = number && (
      (rt && rt.flight && rt.flight.replace(/\s+/g, '') === `${prefix}${number}`)
      || codes.some((c) => cs === `${c}${number}`)
    );
    const byRoute = rt && same(rt.origin, orig) && same(rt.destination, dest);
    if (byNumber || byRoute) {
      matches.push({ ...a, _route: rt, _match: byRoute && byNumber ? 3 : byRoute ? 2 : 1 });
      return;
    }
    // A terra o appena decollato dall'aeroporto di partenza: lo proponiamo, la rotta registrata potrebbe essere vecchia
    const near = distanceNm(a.lat, a.lon, A[0], A[1]) < 8;
    const low = a.alt_baro === 'ground' || (typeof a.alt_baro === 'number' && a.alt_baro < 4000);
    if (near && low) nearby.push({ ...a, _route: rt });
  }));
  matches.sort((x, y) => y._match - x._match);

  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=20');
  return res.status(200).send(JSON.stringify({ ac: matches, nearby: nearby.slice(0, 6), airline: codes, scanned: seen.size }));
}
