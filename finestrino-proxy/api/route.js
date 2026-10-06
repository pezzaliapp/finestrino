// Finestrino: da dove viene e dove va un volo, dal suo codice radio (adsbdb, gratuito).
// I dati delle rotte sono di David Taylor e Jim Mason tramite adsbdb: li mostriamo
// a ogni richiesta senza copiarli in un nostro database.
// Uso: GET /route/{codice_radio}
import { cors, getJson } from './_common.js';

function airport(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || null,
    icao: a.icao_code || null,
    name: a.name || null,
    city: a.municipality || null,
    country: a.country_name || null,
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const cs = String(req.query.cs || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (cs.length < 3) return res.status(400).send('{"error":"codice non valido"}');
  try {
    const j = await getJson(`https://api.adsbdb.com/v0/callsign/${cs}`);
    const r = j.response && j.response.flightroute;
    if (!r) throw Object.assign(new Error('nessuna rotta'), { status: 404 });
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(JSON.stringify({
      route: {
        flight: r.callsign_iata || null,
        airline: (r.airline && r.airline.name) || null,
        origin: airport(r.origin),
        destination: airport(r.destination),
      },
    }));
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(200).send('{"route":null}');
  }
}
