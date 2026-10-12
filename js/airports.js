// Trova un aeroporto da quello che scrive l'utente: codice (AOI), città (Ancona) o nome.
// L'elenco (350 kB) si scarica solo la prima volta che serve.

let data = null;
async function load() {
  if (!data) {
    const list = (await import('./airports-data.js')).default;
    data = list.map(([iata, name, city, cc, lat, lon, rank, kw]) => ({
      iata, name, city, cc, lat, lon, rank,
      text: norm(`${city} ${name} ${kw}`),
      cityN: norm(city),
    }));
  }
  return data;
}

// Nomi italiani delle città che nell'elenco sono in inglese
const ALIAS = {
  roma: 'rome', milano: 'milan', londra: 'london', parigi: 'paris', venezia: 'venice', firenze: 'florence',
  torino: 'turin', genova: 'genoa', bruxelles: 'brussels', 'monaco di baviera': 'munich', lisbona: 'lisbon',
  atene: 'athens', siviglia: 'seville', varsavia: 'warsaw', praga: 'prague', copenaghen: 'copenhagen',
  edimburgo: 'edinburgh', dublino: 'dublin', cracovia: 'krakow', berlino: 'berlin', francoforte: 'frankfurt',
  amburgo: 'hamburg', colonia: 'cologne', ginevra: 'geneva', zurigo: 'zurich', marsiglia: 'marseille',
  nizza: 'nice', tolosa: 'toulouse', lione: 'lyon', napoli: 'naples', bucarest: 'bucharest', belgrado: 'belgrade',
  stoccolma: 'stockholm', mosca: 'moscow', 'il cairo': 'cairo', cairo: 'cairo', tunisi: 'tunis', algeri: 'algiers',
  'la valletta': 'malta', valletta: 'malta', tenerife: 'tenerife', 'gran canaria': 'gran canaria', siracusa: 'catania',
  taormina: 'catania', bergamo: 'bergamo', 'new york': 'new york', 'nuova york': 'new york',
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** L'aeroporto più probabile per il testo scritto, oppure null. */
export async function resolveAirport(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const list = await load();
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const byCode = list.find((a) => a.iata === raw.toUpperCase());
    if (byCode) return byCode;
  }
  const q0 = norm(raw);
  const q = ALIAS[q0] || q0;
  if (q.length < 3) return null;
  let best = null;
  let bestScore = 0;
  for (const a of list) {
    let s = 0;
    if (a.cityN === q) s = 100;
    else if (a.cityN.startsWith(q)) s = 80;
    else if (` ${a.text} `.includes(` ${q} `)) s = 70;
    else if (` ${a.text}`.includes(` ${q}`)) s = 50;
    else if (a.text.includes(q)) s = 20;
    if (!s) continue;
    s += a.rank * 3;
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return best;
}

/** Nome breve da mostrare: "Ancona (AOI)" se lo conosciamo, altrimenti la città. */
export function airportLabel(a, typed) {
  if (!a) return typed || '?';
  const t = typed && !/^[A-Za-z]{3}$/.test(typed.trim()) ? typed.trim() : (a.city || a.name);
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} (${a.iata})`;
}
