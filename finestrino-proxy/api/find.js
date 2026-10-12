// Finestrino: cerca un volo in aria per numero di volo (FR1234), codice radio (RYR4KX),
// registrazione (EI-DYC) o identificativo esadecimale (4ca7b1).
// Funziona anche con gli aerei a terra (in attesa di decollare o appena atterrati).
// Uso: GET /find/{testo}
//
// Molte compagnie (Ryanair, easyJet, Wizz...) via radio non usano il numero di volo:
// FR299 vola come RYR2SN. Per scoprire il codice radio vero serve l'orario dei voli:
// se su Vercel c'è la chiave AERODATABOX_KEY (gratuita, vedi README) lo chiediamo ad AeroDataBox.
import { cors, getJson, UA } from './_common.js';

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

// Orario del volo da AeroDataBox: codice radio vero, aereo, partenza, arrivo, stato.
const ADB_HOST = 'aerodatabox.p.rapidapi.com';

function adbAirport(p) {
  if (!p || !p.airport) return null;
  const a = p.airport;
  return {
    iata: a.iata || null,
    icao: a.icao || null,
    name: a.shortName || a.name || null,
    city: a.municipalityName || null,
    lat: a.location ? a.location.lat : null,
    lon: a.location ? a.location.lon : null,
    scheduled: (p.scheduledTime && p.scheduledTime.utc) || null,
    revised: (p.revisedTime && p.revisedTime.utc) || (p.predictedTime && p.predictedTime.utc) || null,
    runway: (p.runwayTime && p.runwayTime.utc) || null,
    terminal: p.terminal || null,
    gate: p.gate || null,
  };
}

function toMs(utc) {
  if (!utc) return null;
  const ms = Date.parse(String(utc).replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

// Memoria di 10 minuti, per non consumare la quota gratuita con richieste ripetute
const memo = new Map();

async function schedule(q) {
  const key = process.env.AERODATABOX_KEY;
  if (!key || !/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(q) || /^\d{2}/.test(q)) return null;
  const hit = memo.get(q);
  if (hit && Date.now() - hit.at < 600000) return hit.value;
  const value = await fetchSchedule(q, key);
  memo.set(q, { at: Date.now(), value });
  if (memo.size > 200) memo.delete(memo.keys().next().value);
  return value;
}

async function fetchSchedule(q, key) {
  try {
    const r = await fetch(`https://${ADB_HOST}/flights/number/${q}?withAircraftImage=false&withLocation=false`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': ADB_HOST, 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) return null;
    // Il volo più vicino ad adesso (quello di oggi, non quello di ieri o domani)
    const now = Date.now();
    const when = (f) => toMs((f.departure && (f.departure.revisedTime || f.departure.scheduledTime) || {}).utc) ?? now;
    const f = list.slice().sort((a, b) => Math.abs(when(a) - now) - Math.abs(when(b) - now))[0];
    return {
      flight: f.number || q,
      callsign: f.callSign ? String(f.callSign).toUpperCase().replace(/\s+/g, '') : null,
      status: f.status || null,
      airline: (f.airline && f.airline.name) || null,
      reg: (f.aircraft && f.aircraft.reg) || null,
      hex: (f.aircraft && f.aircraft.modeS) ? String(f.aircraft.modeS).toLowerCase() : null,
      model: (f.aircraft && f.aircraft.model) || null,
      origin: adbAirport(f.departure),
      destination: adbAirport(f.arrival),
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const raw = String(req.query.q || '').toUpperCase().replace(/\s+/g, '');
  const q = raw.replace(/[^A-Z0-9-]/g, '').slice(0, 10);
  if (q.length < 3) return res.status(400).send('{"error":"testo troppo corto"}');

  const tried = [];
  let found = [];

  // 0) Numero di volo: chiede l'orario per avere il codice radio e l'aereo veri
  const sched = await schedule(q);
  if (sched) {
    if (sched.hex) { tried.push(sched.hex); found = await lookup('hex', sched.hex); }
    if (!found.length && sched.callsign) { tried.push(sched.callsign); found = await lookup('callsign', sched.callsign); }
    if (!found.length && sched.reg) { tried.push(sched.reg); found = await lookup('reg', sched.reg); }
  }

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
  if (!found.length && !q.includes('-') && !tried.includes(q)) {
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
  return res.status(200).send(JSON.stringify({ ac: found, tried, schedule: sched }));
}
