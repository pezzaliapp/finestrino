// Funzioni comuni dell'intermediario.
export const ALLOWED = [
  'https://alessandropezzali.it',
  'https://www.alessandropezzali.it',
  'https://pezzaliapp.github.io',
  'http://localhost:8000',
];

export const UA = 'Finestrino (https://github.com/pezzaliapp/finestrino)';

/** Imposta CORS e risponde da solo a OPTIONS o a origini non autorizzate. Restituisce true se ha già risposto. */
export function cors(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (origin && !ALLOWED.includes(origin)) { res.status(403).send('{"error":"origine non autorizzata"}'); return true; }
  return false;
}

export async function getJson(url, timeout = 7000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
