// Calcoli del cielo, tutti nel browser: passaggi visibili della Stazione Spaziale
// e file calendario (.ics) per non perderli.
import * as satellite from 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm';

const RE = 6378.137; // raggio terrestre (km)
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Posizione approssimata del Sole in coordinate inerziali (km). Precisione ~0,01°, più che sufficiente. */
function sunEci(date) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = rad((357.528 + 0.9856003 * n) % 360);
  const lambda = rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * n);
  const R = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * 149597870.7;
  return { x: R * Math.cos(lambda), y: R * Math.cos(eps) * Math.sin(lambda), z: R * Math.sin(eps) * Math.sin(lambda) };
}

/** Il satellite è illuminato dal Sole (non nell'ombra della Terra)? Modello a cilindro. */
function sunlit(r, s) {
  const sl = Math.hypot(s.x, s.y, s.z);
  const u = { x: s.x / sl, y: s.y / sl, z: s.z / sl };
  const dot = r.x * u.x + r.y * u.y + r.z * u.z;
  if (dot > 0) return true;
  const px = r.x - dot * u.x, py = r.y - dot * u.y, pz = r.z - dot * u.z;
  return Math.hypot(px, py, pz) > RE;
}

/**
 * Prossimi passaggi visibili a occhio nudo: satellite sopra 10°, illuminato dal Sole,
 * mentre per chi guarda è già buio (Sole sotto -6°).
 */
export function visiblePasses(satrec, home, hours = 48, maxPasses = 5) {
  const obs = { latitude: rad(home.lat), longitude: rad(home.lon), height: (home.ground || 0) / 1000 };
  const out = [];
  const step = 20 * 1000;
  const start = Date.now();
  let cur = null;

  for (let t = start; t < start + hours * 3600 * 1000 && out.length < maxPasses; t += step) {
    const date = new Date(t);
    const pv = satellite.propagate(satrec, date);
    if (!pv.position || typeof pv.position === 'boolean') continue;
    const gmst = satellite.gstime(date);
    const look = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
    const el = deg(look.elevation);

    if (el >= 10) {
      const s = sunEci(date);
      const sunLook = satellite.ecfToLookAngles(obs, satellite.eciToEcf(s, gmst));
      const visible = sunlit(pv.position, s) && deg(sunLook.elevation) < -6;
      const az = (deg(look.azimuth) + 360) % 360;
      if (!cur) cur = { start: date, startAz: az, maxEl: el, maxAz: az, maxAt: date, visible: false };
      if (el > cur.maxEl) { cur.maxEl = el; cur.maxAz = az; cur.maxAt = date; }
      cur.visible = cur.visible || visible;
      cur.end = date;
      cur.endAz = az;
    } else if (cur) {
      if (cur.visible) out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.visible && out.length < maxPasses) out.push(cur);
  return out;
}

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Scarica un file calendario con un promemoria 10 minuti prima. */
export function downloadPassIcs(pass, satName, description) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finestrino//IT', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${pass.start.getTime()}-iss@finestrino`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(pass.start)}`,
    `DTEND:${icsDate(pass.end)}`,
    `SUMMARY:Passaggio visibile: ${satName}`,
    `DESCRIPTION:${description.replace(/[,;]/g, (m) => `\\${m}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:Tra 10 minuti passa ${satName}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'passaggio-stazione-spaziale.ics';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
