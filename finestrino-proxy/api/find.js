// Finestrino: cerca un volo in aria per numero di volo (FR1234), codice radio (RYR4KX),
// registrazione (EI-DYC) o identificativo esadecimale (4ca7b1).
// Uso: GET /find/{testo}
import { cors, getJson } from './_common.js';

const LOOKUPS = {
  callsign: [
    (q) => `https://api.adsb.lol/v2/callsign/${q}`,
    (q) => `https://opendata.adsb.fi/api/v2/callsign/${q}`,
  ],
  reg: [
    (q) => `https://api.adsb.lol/v2/reg/${q}`,
    (q) => `https://opendata.adsb.fi/api/v2/registration/${q}`,
  ],
  hex: [
    (q) => `https://api.adsb.lol/v2/hex/${q}`,
    (q) => `https://opendata.adsb.fi/api/v2/hex/${q}`,
  ],
};

async function lookup(kind, q) {
  for (const make of LOOKUPS[kind]) {
    try {
      const j = await getJson(make(q));
      const ac = (j.ac || j.aircraft || []).filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number');
      if (ac.length) return ac;
    } catch { /* prova la fonte successiva */ }
  }
  return [];
}

// "FR1234" -> ["RYR1234"] usando il codice ICAO della compagnia (adsbdb)
async function iataToCallsigns(q) {
  const m = q.match(/^([A-Z0-9]{2})0*(\d{1,4}[A-Z]?)$/);
  if (!m || /^\d{2}$/.test(m[1])) return [];
  try {
    const j = await getJson(`https://api.adsbdb.com/v0/airline/${m[1]}`);
    const list = Array.isArray(j.response) ? j.response : [j.response];
    return list.filter((a) => a && a.icao).map((a) => `${a.icao}${m[2]}`);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const raw = String(req.query.q || '').toUpperCase().replace(/\s+/g, '');
  const q = raw.replace(/[^A-Z0-9-]/g, '').slice(0, 10);
  if (q.length < 3) return res.status(400).send('{"error":"testo troppo corto"}');

  const tried = [];
  let found = [];

  // 1) Identificativo esadecimale (6 caratteri 0-9 A-F)
  if (/^[0-9A-F]{6}$/.test(q)) {
    tried.push(q);
    found = await lookup('hex', q.toLowerCase());
  }
  // 2) Registrazione con trattino (EI-DYC, I-ABCD)
  if (!found.length && q.includes('-')) {
    tried.push(q);
    found = await lookup('reg', q);
  }
  // 3) Codice radio così come scritto (RYR4KX, AZA1234)
  if (!found.length && !q.includes('-')) {
    tried.push(q);
    found = await lookup('callsign', q);
  }
  // 4) Numero di volo IATA (FR1234 -> RYR1234)
  if (!found.length && !q.includes('-')) {
    for (const cs of await iataToCallsigns(q)) {
      if (tried.includes(cs)) continue;
      tried.push(cs);
      found = await lookup('callsign', cs);
      if (found.length) break;
    }
  }
  // 5) Registrazione senza trattino (EIDYC)
  if (!found.length && /^[A-Z]{1,2}[A-Z0-9]{3,5}$/.test(q)) {
    found = await lookup('reg', q);
  }

  res.setHeader('Cache-Control', 'public, s-maxage=10');
  return res.status(200).send(JSON.stringify({ ac: found, tried }));
}
