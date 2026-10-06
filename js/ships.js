// Navi e traghetti (AIS) tramite il tuo intermediario Vercel, che usa aisstream.io.
import { AIRCRAFT_PROXY } from './config.js';
import { destination } from './geo.js';
import { t } from './i18n.js';

export async function fetchShips(lat, lon, radiusNm) {
  if (!AIRCRAFT_PROXY) throw new Error('intermediario non configurato');
  const base = AIRCRAFT_PROXY.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${base}/ships/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.round(radiusNm)}`, { signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    const seen = Date.now();
    return (json.ships || []).map((s) => ({ ...s, seen }));
  } finally {
    clearTimeout(timer);
  }
}

/** Posizione stimata adesso: prosegue con rotta e velocità per al massimo 10 minuti. */
export function shipPosition(s, now) {
  const dt = Math.min(Math.max((now - s.seen) / 1000, 0), 600);
  if (s.sog > 0.3 && s.cog != null) {
    return destination(s.lat, s.lon, s.cog, s.sog * 0.514444 * dt);
  }
  return { lat: s.lat, lon: s.lon };
}

/** Tipo di nave in italiano, dal codice AIS. */
export function shipTypeName(code) {
  const code_ = Number(code) || 0;
  if (code_ >= 60 && code_ <= 69) return t('Nave passeggeri o traghetto');
  if (code_ >= 70 && code_ <= 79) return t('Nave da carico');
  if (code_ >= 80 && code_ <= 89) return t('Petroliera o cisterna');
  if (code_ >= 40 && code_ <= 49) return t('Mezzo veloce');
  if (code_ >= 20 && code_ <= 29) return t('Aliscafo o ala marina');
  const named = {
    30: 'Peschereccio', 31: 'Rimorchiatore', 32: 'Rimorchiatore', 33: 'Draga',
    34: 'Supporto immersioni', 35: 'Nave militare', 36: 'Barca a vela', 37: 'Imbarcazione da diporto',
    50: 'Pilotina', 51: 'Soccorso in mare', 52: 'Rimorchiatore', 53: 'Nave di servizio portuale',
    54: 'Mezzo antinquinamento', 55: 'Forze dell\'ordine', 58: 'Mezzo sanitario',
  };
  return named[code_] ? t(named[code_]) : t('Imbarcazione');
}

const NAV_STATUS_IT = {
  0: 'in navigazione a motore', 1: 'all\'ancora', 2: 'senza governo', 3: 'manovra limitata',
  5: 'ormeggiata', 7: 'in pesca', 8: 'in navigazione a vela',
};

export const NAV_STATUS = new Proxy(NAV_STATUS_IT, { get: (o, k) => (o[k] ? t(o[k]) : undefined) });
