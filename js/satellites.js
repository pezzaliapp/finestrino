// Satelliti: orbite (TLE) da CelesTrak, posizioni calcolate con satellite.js (MIT).
// CelesTrak aggiorna i dati ogni 2 ore e chiede di scaricarli una volta per ciclo:
// li teniamo in cache nel browser per 2 ore e non riproviamo in caso di errore.

import * as satellite from 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm';

const GROUPS = ['stations', 'visual']; // stazioni spaziali + i ~150 satelliti più luminosi
const KEY = 'finestrino.tle.v1';
const MAX_AGE = 2 * 60 * 60 * 1000;

function readCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export async function loadSatellites() {
  const cached = readCache();
  if (cached && Date.now() - cached.time < MAX_AGE) {
    return { source: 'CelesTrak', list: parseTle(cached.text) };
  }

  try {
    const parts = await Promise.all(
      GROUPS.map(async (g) => {
        const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`);
        if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
        return res.text();
      }),
    );
    const text = parts.join('\n');
    try { localStorage.setItem(KEY, JSON.stringify({ time: Date.now(), text })); } catch { /* spazio pieno */ }
    return { source: 'CelesTrak', list: parseTle(text) };
  } catch (e) {
    // Copia locale facoltativa nella repo (data/tle.txt), poi cache scaduta.
    try {
      const res = await fetch('data/tle.txt');
      if (res.ok) {
        const text = await res.text();
        if (text.includes('\n1 ')) return { source: 'copia locale', list: parseTle(text) };
      }
    } catch { /* niente copia locale */ }
    if (cached) return { source: 'CelesTrak (dati di ieri)', list: parseTle(cached.text) };
    throw e;
  }
}

function parseTle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length - 2; ) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      const id = lines[i + 1].slice(2, 7).trim();
      if (!seen.has(id)) {
        seen.add(id);
        try {
          const satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
          out.push({ id, name: prettyName(lines[i].trim()), satrec });
        } catch { /* riga non valida */ }
      }
      i += 3;
    } else {
      i += 1;
    }
  }
  return out;
}

function prettyName(n) {
  if (/^ISS \(ZARYA\)/.test(n)) return 'Stazione Spaziale Internazionale';
  if (/^CSS \(TIANHE\)/.test(n)) return 'Stazione spaziale cinese Tiangong';
  return n;
}

/** Posizione del satellite a una data: lat, lon in gradi, quota in metri, velocità in km/s. */
export function satellitePosition(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(date);
  const g = satellite.eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  return {
    lat: satellite.degreesLat(g.latitude),
    lon: satellite.degreesLong(g.longitude),
    alt: g.height * 1000,
    speedKms: v && typeof v !== 'boolean' ? Math.hypot(v.x, v.y, v.z) : null,
  };
}
