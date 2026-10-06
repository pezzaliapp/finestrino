// Aerei in volo da aggregatori ADS-B comunitari e gratuiti.
// 1) ADSB.lol: API aperta, dati con licenza ODbL, nessuna chiave (per ora).
// 2) adsb.fi: riserva. Uso personale non commerciale, max 1 richiesta al secondo, va citato.
// airplanes.live NON è usato: richiede di contattarli anche per l'uso non commerciale.

import { destination, lerpAngle, wrapLon } from './geo.js';

const SOURCES = [
  {
    name: 'adsb.lol',
    url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`,
  },
  {
    name: 'adsb.fi',
    url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${nm}`,
  },
];

let preferred = 0;
let lastRequest = 0;

export async function fetchAircraft(lat, lon, radiusNm) {
  // Rispetta il limite più severo (adsb.fi: 1 richiesta al secondo)
  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  let lastError;
  for (let k = 0; k < SOURCES.length; k++) {
    const i = (preferred + k) % SOURCES.length;
    const src = SOURCES[i];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      lastRequest = Date.now();
      const res = await fetch(src.url(lat, lon, Math.round(radiusNm)), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
      const json = await res.json();
      const raw = json.ac || json.aircraft || [];
      const received = Date.now();
      preferred = i;
      return { source: src.name, list: raw.map((a) => normalize(a, received)).filter(Boolean) };
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Nessuna fonte disponibile');
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normalize(a, received) {
  if (num(a.lat) === null || num(a.lon) === null || !a.hex) return null;
  if (a.alt_baro === 'ground') return null; // solo aerei in volo
  const altFt = num(a.alt_geom) ?? num(a.alt_baro);
  if (altFt === null) return null;
  return {
    hex: String(a.hex).toLowerCase(),
    callsign: (a.flight || '').trim() || null,
    reg: a.r || null,
    type: a.t || null,
    desc: a.desc || null,
    operator: a.ownOp || null,
    lat: a.lat,
    lon: a.lon,
    altFt,
    altM: altFt * 0.3048,
    gsKt: num(a.gs),
    track: num(a.track) ?? num(a.true_heading) ?? num(a.mag_heading),
    vrateFpm: num(a.geom_rate) ?? num(a.baro_rate) ?? 0,
    squawk: a.squawk || null,
    posTime: received - (num(a.seen_pos) ?? 0) * 1000,
    blend: null,
  };
}

/** Posizione stimata adesso, proseguendo in linea retta dall'ultima posizione nota. */
function deadReckon(d, now) {
  const dt = Math.min(Math.max((now - d.posTime) / 1000, 0), 60);
  let lat = d.lat, lon = d.lon;
  if (d.gsKt && d.track !== null) {
    const p = destination(lat, lon, d.track, d.gsKt * 0.514444 * dt);
    lat = p.lat; lon = p.lon;
  }
  const alt = Math.max(30, d.altM + ((d.vrateFpm || 0) * 0.3048 * dt) / 60);
  return { lat, lon, alt, track: d.track ?? 0 };
}

/** Posizione da disegnare: stima + raccordo morbido quando arrivano dati nuovi. */
export function aircraftPosition(d, now) {
  const base = deadReckon(d, now);
  if (d.blend) {
    const t = (now - d.blend.start) / 2500;
    if (t < 1) {
      const k = t * t * (3 - 2 * t);
      const f = d.blend.from;
      return {
        lat: f.lat + (base.lat - f.lat) * k,
        lon: wrapLon(f.lon + wrapLon(base.lon - f.lon) * k),
        alt: f.alt + (base.alt - f.alt) * k,
        track: lerpAngle(f.track, base.track, k),
      };
    }
  }
  return base;
}
