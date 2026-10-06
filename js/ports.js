// Destinazioni delle navi: l'equipaggio le scrive a mano nel segnale AIS, in formati diversi
// ("SPLIT", "HR SPU", "IT ANC>HR SPU", "ANCONA ITALY"...). Qui le trasformiamo in un porto con coordinate.

// Codici UN/LOCODE dei porti principali di Adriatico e Mediterraneo
const PORTS = {
  ITANC: ['Ancona', 'Italia', 43.62, 13.51], ITVCE: ['Venezia', 'Italia', 45.44, 12.33],
  ITTRS: ['Trieste', 'Italia', 45.65, 13.76], ITRAN: ['Ravenna', 'Italia', 44.49, 12.28],
  ITBRI: ['Bari', 'Italia', 41.14, 16.86], ITBDS: ['Brindisi', 'Italia', 40.64, 17.95],
  ITPSR: ['Pescara', 'Italia', 42.47, 14.22], ITORT: ['Ortona', 'Italia', 42.36, 14.41],
  ITCHI: ['Chioggia', 'Italia', 45.22, 12.28], ITMNF: ['Monfalcone', 'Italia', 45.79, 13.55],
  ITTAR: ['Taranto', 'Italia', 40.47, 17.21], ITGOA: ['Genova', 'Italia', 44.41, 8.92],
  ITSPE: ['La Spezia', 'Italia', 44.10, 9.83], ITLIV: ['Livorno', 'Italia', 43.55, 10.30],
  ITCIV: ['Civitavecchia', 'Italia', 42.09, 11.79], ITNAP: ['Napoli', 'Italia', 40.84, 14.26],
  ITSAL: ['Salerno', 'Italia', 40.67, 14.75], ITGIT: ['Gioia Tauro', 'Italia', 38.44, 15.90],
  ITPMO: ['Palermo', 'Italia', 38.13, 13.37], ITCTA: ['Catania', 'Italia', 37.50, 15.09],
  ITMSN: ['Messina', 'Italia', 38.19, 15.56], ITAUG: ['Augusta', 'Italia', 37.21, 15.22],
  ITCAG: ['Cagliari', 'Italia', 39.21, 9.11], ITOLB: ['Olbia', 'Italia', 40.92, 9.51],
  ITPTO: ['Porto Torres', 'Italia', 40.84, 8.40],
  HRRJK: ['Fiume (Rijeka)', 'Croazia', 45.33, 14.43], HRSPU: ['Spalato (Split)', 'Croazia', 43.50, 16.44],
  HRZAD: ['Zara (Zadar)', 'Croazia', 44.12, 15.22], HRPLE: ['Ploče', 'Croazia', 43.05, 17.43],
  HRDBV: ['Ragusa (Dubrovnik)', 'Croazia', 42.66, 18.08], HRPUY: ['Pola (Pula)', 'Croazia', 44.87, 13.84],
  HRSIB: ['Sebenico (Šibenik)', 'Croazia', 43.73, 15.89], SIKOP: ['Capodistria (Koper)', 'Slovenia', 45.55, 13.73],
  MEBAR: ['Antivari (Bar)', 'Montenegro', 42.09, 19.09], ALDRZ: ['Durazzo (Durrës)', 'Albania', 41.31, 19.45],
  ALVOA: ['Valona (Vlorë)', 'Albania', 40.45, 19.49], GRIGO: ['Igoumenitsa', 'Grecia', 39.50, 20.26],
  GRPAS: ['Patrasso', 'Grecia', 38.25, 21.73], GRCFU: ['Corfù', 'Grecia', 39.62, 19.92],
  GRPIR: ['Pireo', 'Grecia', 37.94, 23.64], GRSKG: ['Salonicco', 'Grecia', 40.63, 22.93],
  MTMAR: ['Marsaxlokk', 'Malta', 35.83, 14.54], MTMLA: ['La Valletta', 'Malta', 35.90, 14.51],
  ESBCN: ['Barcellona', 'Spagna', 41.35, 2.17], ESVLC: ['Valencia', 'Spagna', 39.44, -0.32],
  ESALG: ['Algeciras', 'Spagna', 36.13, -5.44], FRMRS: ['Marsiglia', 'Francia', 43.31, 5.36],
  TNTUN: ['Tunisi', 'Tunisia', 36.80, 10.30], EGPSD: ['Port Said', 'Egitto', 31.26, 32.30],
};

// Parole che non sono luoghi
const NOT_PLACES = /^(OFFSHORE|FISHING|FISH|FOR ORDERS?|ORDERS?|ANCHORAGE|ANCHOR|AT SEA|SEA|NONE|N\/?A|TEST|TRAINING|PATROL|SAR|WORK|WORKING|CRUISING|SAILING|PILOT|TUG|DREDGING|STANDBY|STAND BY|LOCAL|HOME|PORT|[-. ]*)$/;

const cache = new Map();

function clean(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9 >\-/]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Divide "IT ANC > HR SPU" in partenza e arrivo. Se c'è un solo luogo, è l'arrivo. */
export function splitDestination(text) {
  const t = clean(text);
  const parts = t.split(/\s*(?:>|=>|->)\s*/).filter(Boolean);
  if (parts.length >= 2) return { from: parts[0], to: parts[parts.length - 1] };
  return { from: null, to: t || null };
}

async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=it&format=json`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const p = j.results && j.results[0];
  return p ? { name: p.name, country: p.country || '', lat: p.latitude, lon: p.longitude } : null;
}

/** Trasforma un testo di destinazione in un porto { name, country, lat, lon }, oppure null. */
export function resolvePort(text) {
  const t = clean(text);
  if (!t || NOT_PLACES.test(t)) return Promise.resolve(null);
  if (cache.has(t)) return cache.get(t);

  const p = (async () => {
    // Codice del porto: "ITANC", "IT ANC", "IT-ANC"
    const code = t.replace(/[\s\-/]/g, '');
    if (/^[A-Z]{5}$/.test(code) && PORTS[code]) {
      const [name, country, lat, lon] = PORTS[code];
      return { name, country, lat, lon };
    }
    // Nome del porto, eventualmente con il paese: "SPLIT", "ANCONA ITALY"
    const words = t.replace(/[\-/]/g, ' ').split(' ').filter((w) => w.length > 2);
    for (const candidate of [words.join(' '), words[0]].filter(Boolean)) {
      try {
        const g = await geocode(candidate);
        if (g) return g;
      } catch { /* rete */ }
    }
    return null;
  })();
  cache.set(t, p);
  return p;
}

/** Il porto già risolto (senza attendere), oppure undefined se la ricerca è in corso. */
const known = new Map();
export function knownPort(text) {
  const t = clean(text);
  if (!t) return null;
  if (!known.has(t)) {
    known.set(t, undefined);
    resolvePort(t).then((p) => known.set(t, p));
  }
  return known.get(t);
}

export function portLabel(p) {
  if (!p) return '';
  return p.country ? `${p.name}, ${p.country}` : p.name;
}
