// Finestrino: navi e traghetti in tempo reale (AIS) da aisstream.io, gratuito per uso non commerciale.
// aisstream non accetta connessioni dal browser, per proteggere la chiave: questa funzione
// si collega al suo flusso per qualche secondo, raccoglie le navi nella zona e le restituisce.
// La chiave sta nella variabile d'ambiente AISSTREAM_KEY su Vercel, mai nel codice pubblico.
//
// Uso: GET /ships/{lat}/{lon}/{raggio_nm}

const ALLOWED = [
  'https://alessandropezzali.it',
  'https://www.alessandropezzali.it',
  'https://pezzaliapp.github.io',
  'http://localhost:8000',
];

const WINDOW_MS = 15000; // per quanto ascoltare il flusso a ogni richiesta

function ingest(ships, m) {
  const md = m.MetaData || {};
  const mmsi = md.MMSI;
  if (!mmsi) return;
  const s = ships.get(mmsi) || { mmsi };
  const name = (md.ShipName || '').trim();
  if (name) s.name = name;
  const type = m.MessageType || '';
  const body = (m.Message && m.Message[type]) || {};

  if (type.includes('PositionReport')) {
    const lat = body.Latitude ?? md.latitude;
    const lon = body.Longitude ?? md.longitude;
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { s.lat = lat; s.lon = lon; }
    if (body.Sog != null && body.Sog < 102.3) s.sog = body.Sog;          // nodi
    if (body.Cog != null && body.Cog < 360) s.cog = body.Cog;            // gradi
    if (body.TrueHeading != null && body.TrueHeading < 360) s.heading = body.TrueHeading;
    if (body.NavigationalStatus != null) s.status = body.NavigationalStatus;
  } else if (type === 'ShipStaticData') {
    if (body.Type) s.type = body.Type;
    const dest = (body.Destination || '').trim();
    if (dest) s.destination = dest;
    const d = body.Dimension;
    if (d && (d.A || d.B)) s.length = (d.A || 0) + (d.B || 0);
  } else if (type === 'StaticDataReport') {
    const b = body.ReportB;
    if (b && b.ShipType) s.type = b.ShipType;
  }
  ships.set(mmsi, s);
}

function listen(key, box) {
  return new Promise((resolve) => {
    const ships = new Map();
    let error = null;
    let ws;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws && ws.close(); } catch { /* */ }
      resolve({ ships, error });
    };
    const timer = setTimeout(finish, WINDOW_MS);
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch (e) {
      error = e.message;
      return finish();
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(JSON.stringify({
        APIKey: key,
        BoundingBoxes: [box],
        FilterMessageTypes: [
          'PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport',
          'ShipStaticData', 'StaticDataReport',
        ],
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
        const m = JSON.parse(text);
        if (m.error) { error = m.error; return finish(); }
        ingest(ships, m);
      } catch { /* messaggio non valido */ }
    };
    ws.onerror = () => { error = error || 'connessione ad aisstream non riuscita'; finish(); };
    ws.onclose = finish;
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (origin && !ALLOWED.includes(origin)) return res.status(403).send('{"error":"origine non autorizzata"}');

  const key = process.env.AISSTREAM_KEY;
  if (!key) return res.status(500).send('{"error":"manca la variabile AISSTREAM_KEY su Vercel"}');

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const nm = Math.min(150, Math.max(5, Math.round(Number(req.query.nm))));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !nm) {
    return res.status(400).send('{"error":"uso: /ships/{lat}/{lon}/{raggio_nm}"}');
  }

  // Arrotondare a un quarto di grado permette alla cache di Vercel di servire più visitatori vicini
  const la = Math.round(lat * 4) / 4;
  const lo = Math.round(lon * 4) / 4;
  const dLat = nm / 60;
  const dLon = nm / (60 * Math.max(0.2, Math.cos((la * Math.PI) / 180)));
  const box = [[la - dLat, lo - dLon], [la + dLat, lo + dLon]];

  const { ships, error } = await listen(key, box);
  const list = [...ships.values()].filter((s) => s.lat != null && s.lon != null);

  if (!list.length && error) {
    return res.status(502).send(JSON.stringify({ error, ships: [] }));
  }
  res.setHeader('Cache-Control', 'public, s-maxage=25, stale-while-revalidate=60');
  return res.status(200).send(JSON.stringify({ ships: list }));
}
