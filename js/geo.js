// Piccole funzioni di geografia, senza dipendenze.
const R = 6371008.8; // raggio medio della Terra in metri

export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Punto raggiunto partendo da lat/lon, con una rotta (gradi) e una distanza (metri). */
export function destination(lat, lon, bearingDeg, distM) {
  const d = distM / R;
  const t = toRad(bearingDeg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: wrapLon(toDeg(l2)) };
}

/** Distanza in metri sulla superficie. */
export function distanceM(lat1, lon1, lat2, lon2) {
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rotta iniziale da un punto a un altro, in gradi 0-360. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Interpola due angoli in gradi passando dal lato più corto. */
export function lerpAngle(a, b, k) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
export const fmt0 = (n) => nf0.format(n);
export const fmt1 = (n) => nf1.format(n);

/** Punto cardinale in italiano per una rotta. */
export function compass(deg) {
  const names = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
