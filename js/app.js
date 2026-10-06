// Finestrino: il cielo sopra di te, dal finestrino di ciò che ci passa adesso.
// Tutto gratuito: nessuna chiave API, nessun abbonamento, nessun server.

import './lang-en.js';
import { t, LANG, LOCALE, translatePage, setLang } from './i18n.js';
import { createTerrainProvider, sampleHeight } from './terrain.js';
import { fetchAircraft, aircraftPosition, normalizeAircraft } from './aircraft.js';
import { findFlight, knownRoute, placeName } from './flights.js';
import { visiblePasses, downloadPassIcs } from './sky.js';
import { splitDestination, knownPort, portLabel } from './ports.js';
import { loadSatellites, satellitePosition } from './satellites.js';
import { fetchWeather, describeWeather, searchPlaces } from './weather.js';
import { bearing, destination, distanceM, clamp, fmt0, fmt1, compass } from './geo.js';
import { startCabin, stopCabin } from './audio.js';
import { fetchShips, shipPosition, shipTypeName, NAV_STATUS } from './ships.js';
import { startAutoUpdate } from './update.js';

const C = window.Cesium;
translatePage();
const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const EOX_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const EOX_CREDIT = '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)';
const HOME_KEY = 'finestrino.home.v1';
const SOUND_KEY = 'finestrino.sound.v1';

const PLANE = C.Color.fromCssColorString('#F2A900');
const SAT = C.Color.fromCssColorString('#BFE3FF');
const SHIP = C.Color.fromCssColorString('#3FD6C8');
const OUTLINE = C.Color.fromCssColorString('#0E1B2C').withAlpha(0.85);

// ---------------------------------------------------------------- stato
const state = {
  mode: 'intro',             // intro | arriving | sky | map | ride
  home: null,                // { lat, lon, name, ground }
  look: { heading: 0, pitch: 22 },
  fov: 70,
  ride: null,                // { kind: 'plane'|'sat', id, view, yaw, pitch }
  planes: new Map(),         // hex -> { data, entity, missed }
  sats: new Map(),           // id  -> { name, satrec, entity, pos }
  ships: new Map(),          // mmsi -> { data, entity }
  shipError: false,
  shipFetchedAt: 0,
  shipTimer: null,
  selected: null,            // id entità
  planeSource: '',
  planeFetchedAt: 0,
  planeError: false,
  satSource: '',
  satError: false,
  pollTimer: null,
  sound: readSound(),
};

function readSound() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

// ---------------------------------------------------------------- Cesium
const viewer = new C.Viewer('globe', {
  baseLayer: new C.ImageryLayer(new C.UrlTemplateImageryProvider({
    url: EOX_URL,
    maximumLevel: 15,
    credit: new C.Credit(EOX_CREDIT, true),
  })),
  terrainProvider: createTerrainProvider(),
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  scene3DOnly: true,
  // I crediti della mappa stanno nella finestra "Fonti dei dati", non sopra la vista
  creditContainer: document.getElementById('cesium-credits'),
});

const scene = viewer.scene;
const camera = viewer.camera;
const controller = scene.screenSpaceCameraController;

scene.globe.enableLighting = true;          // giorno e notte reali
// Cesium di default "accende la luce" quando la vista è vicina al suolo (sotto i 10.000 km):
// la spegniamo, così di notte è buio anche dal finestrino e da terra.
scene.globe.lightingFadeOutDistance = 1;
scene.globe.lightingFadeInDistance = 2;
scene.globe.nightFadeOutDistance = 1;
scene.globe.nightFadeInDistance = 2;

// Luci delle città di notte: NASA Black Marble (GIBS), gratuito e senza chiave.
// Si vedono solo sul lato notturno della Terra; di giorno restano invisibili.
const baseLayer = viewer.imageryLayers.get(0);
baseLayer.dayAlpha = 1;
baseLayer.nightAlpha = 0.06; // un filo di "luce lunare" per intuire coste e montagne

const NIGHT_SOURCES = [
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
];
let nightLayer = null;

function addNightLights(i = 0) {
  if (i >= NIGHT_SOURCES.length) return;
  const provider = new C.UrlTemplateImageryProvider({
    url: NIGHT_SOURCES[i],
    maximumLevel: 8,
    credit: new C.Credit(t('Luci notturne: NASA Black Marble (GIBS)'), false),
  });
  let failures = 0;
  provider.errorEvent.addEventListener((err) => {
    failures += 1;
    if (err) err.retry = false;
    // Se questa sorgente non risponde, passa alla successiva
    if (failures === 6) {
      viewer.imageryLayers.remove(nightLayer, true);
      addNightLights(i + 1);
    }
  });
  nightLayer = viewer.imageryLayers.addImageryProvider(provider);
  nightLayer.dayAlpha = 0;
  nightLayer.nightAlpha = 1;
  nightLayer.brightness = 1.8; // città ben visibili anche dal finestrino
  nightLayer.contrast = 1.2;
}
addNightLights();
scene.globe.depthTestAgainstTerrain = true; // ciò che è sotto l'orizzonte resta nascosto
scene.globe.maximumScreenSpaceError = coarse ? 4 : 2;
scene.fog.enabled = true;
viewer.clock.clockStep = C.ClockStep.SYSTEM_CLOCK; // ora vera: sole, luna e stelle al posto giusto
viewer.clock.shouldAnimate = true;
viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

const clouds = scene.primitives.add(new C.CloudCollection());

// Inquadratura iniziale: la Terra con il confine tra giorno e notte, così si vedono sia la luce sia le città illuminate.
// Il Sole è a picco sulla longitudine dove è mezzogiorno; ci mettiamo 70° più a est, dove sta facendo sera.
const subsolarLon = (12 - (Date.now() % 86400000) / 3600000) * 15;
const introLon = ((subsolarLon + 70 + 540) % 360) - 180;
camera.setView({ destination: C.Cartesian3.fromDegrees(introLon, 28, 19000000) });
setFov(state.fov);

// ---------------------------------------------------------------- camera
function setFov(deg) {
  state.fov = clamp(deg, 25, 100);
  camera.frustum.fov = C.Math.toRadians(state.fov);
}

function placeSkyCamera() {
  const h = state.home;
  camera.setView({
    destination: C.Cartesian3.fromDegrees(h.lon, h.lat, h.ground + 30),
    orientation: {
      heading: C.Math.toRadians(state.look.heading),
      pitch: C.Math.toRadians(state.look.pitch),
      roll: 0,
    },
  });
}

const SIDE = { left: -90, front: 0, right: 90 };

function ridePose(now = Date.now()) {
  const r = state.ride;
  if (!r) return null;
  if (r.kind === 'plane') {
    const p = state.planes.get(r.id);
    if (!p) return null;
    const pos = aircraftPosition(p.data, now);
    return { ...pos, heading: pos.track };
  }
  const s = state.sats.get(r.id);
  if (!s) return null;
  const d = new Date(now);
  const a = satellitePosition(s.satrec, d);
  const b = satellitePosition(s.satrec, new Date(now + 1000));
  if (!a || !b) return null;
  return { ...a, heading: bearing(a.lat, a.lon, b.lat, b.lon) };
}

function placeRideCamera() {
  const pose = ridePose();
  if (!pose) return;
  const r = state.ride;
  camera.setView({
    destination: C.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.alt),
    orientation: {
      heading: C.Math.toRadians(pose.heading + SIDE[r.view] + r.yaw),
      pitch: C.Math.toRadians(r.pitch),
      roll: 0,
    },
  });
}

scene.preRender.addEventListener((_, time) => {
  if (state.mode === 'intro' && !reducedMotion) camera.rotate(C.Cartesian3.UNIT_Z, -0.0004);
  else if (state.mode === 'sky') placeSkyCamera();
  else if (state.mode === 'ride') placeRideCamera();
});

// ---------------------------------------------------------------- guardarsi intorno (trascina, pizzica, rotella, frecce)
const pointers = new Map();
let pinch = null;

function look(dx, dy) {
  const k = state.fov / Math.max(300, viewer.canvas.clientHeight);
  if (state.mode === 'sky') {
    state.look.heading = (state.look.heading - dx * k + 360) % 360;
    state.look.pitch = clamp(state.look.pitch + dy * k, -15, 89);
  } else if (state.mode === 'ride') {
    const r = state.ride;
    r.yaw = clamp(r.yaw - dx * k, -75, 75);
    r.pitch = clamp(r.pitch + dy * k, -88, 35);
  }
}

const canvas = viewer.canvas;
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'sky' && state.mode !== 'ride') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: state.fov };
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    look(e.clientX - p.x, e.clientY - p.y);
  } else if (pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 10) setFov((pinch.fov * pinch.d) / d);
  }
  p.x = e.clientX; p.y = e.clientY;
});
const release = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', release);
canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'sky' && state.mode !== 'ride') return;
  e.preventDefault();
  setFov(state.fov * (1 + e.deltaY * 0.0012));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, dialog')) return;
  const step = 40;
  if (e.key === 'ArrowLeft') look(step, 0);
  else if (e.key === 'ArrowRight') look(-step, 0);
  else if (e.key === 'ArrowUp') look(0, step);
  else if (e.key === 'ArrowDown') look(0, -step);
  else if (e.key === 'Escape') {
    if (state.selected) closeCard();
    else if (state.mode === 'ride') endRide();
  }
});

// ---------------------------------------------------------------- aerei
function planeLabel(d) {
  return d.callsign || d.reg || d.hex.toUpperCase();
}

function addPlaneEntity(hex, d) {
  return viewer.entities.add({
    id: `plane:${hex}`,
    position: new C.CallbackProperty(() => {
      const h = state.planes.get(hex);
      if (!h) return undefined;
      const p = aircraftPosition(h.data, Date.now());
      return C.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
    }, false),
    point: {
      pixelSize: 8,
      color: PLANE,
      outlineColor: OUTLINE,
      outlineWidth: 2,
      scaleByDistance: new C.NearFarScalar(2e3, 1.8, 2e5, 0.8),
    },
    label: {
      text: planeLabel(d),
      font: '600 13px B612, system-ui, sans-serif',
      fillColor: C.Color.WHITE,
      outlineColor: OUTLINE,
      outlineWidth: 4,
      style: C.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: C.HorizontalOrigin.LEFT,
      pixelOffset: new C.Cartesian2(10, -8),
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, 160000),
    },
  });
}

function mergePlanes(list) {
  const now = Date.now();
  const seen = new Set();
  for (const d of list) {
    seen.add(d.hex);
    const h = state.planes.get(d.hex);
    if (h) {
      d.blend = { from: aircraftPosition(h.data, now), start: now };
      h.data = d;
      h.missed = 0;
      h.entity.label.text = planeLabel(d);
    } else {
      state.planes.set(d.hex, { data: d, missed: 0, entity: addPlaneEntity(d.hex, d) });
    }
  }
  for (const [hex, h] of state.planes) {
    if (seen.has(hex)) continue;
    h.missed += 1;
    const ridden = state.ride?.kind === 'plane' && state.ride.id === hex;
    if (ridden && h.missed >= 6) {
      endRide(t('Il volo è uscito dalla zona coperta dai ricevitori, oppure è atterrato. Sei di nuovo a terra.'));
    }
    if (!ridden && h.missed >= 3) {
      if (state.selected === `plane:${hex}`) closeCard();
      viewer.entities.remove(h.entity);
      state.planes.delete(hex);
    }
  }
}

/** Aggiunge o aggiorna un singolo aereo (per esempio trovato con la ricerca) senza toccare gli altri. */
function upsertPlane(d) {
  const h = state.planes.get(d.hex);
  if (h) {
    d.blend = { from: aircraftPosition(h.data, Date.now()), start: Date.now() };
    h.data = d;
    h.missed = 0;
    h.entity.label.text = planeLabel(d);
  } else {
    state.planes.set(d.hex, { data: d, missed: 0, entity: addPlaneEntity(d.hex, d) });
  }
}

/** Nome del volo da mostrare: il numero commerciale se lo conosciamo (FR1234), altrimenti il codice radio. */
function flightName(d) {
  const rt = d.callsign ? knownRoute(d.callsign) : null;
  return (rt && rt.flight) || planeLabel(d);
}

function routeText(d) {
  const rt = d.callsign ? knownRoute(d.callsign) : null;
  if (!rt || !rt.origin || !rt.destination) return '';
  return `${placeName(rt.origin)} → ${placeName(rt.destination)}`;
}

const hm = (date) => date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
/** Quota in metri; in inglese anche in piedi, come si usa in aviazione. */
const altText = (m) => (LANG === 'en' ? `${fmt0(m)} m (${fmt0(m / 0.3048)} ft)` : `${fmt0(m)} m`);

/** Stime di decollo, atterraggio e percorso, da aeroporti, posizione e velocità. */
function flightTimes(d) {
  const rt = d.callsign ? knownRoute(d.callsign) : null;
  const o = rt && rt.origin;
  const t = rt && rt.destination;
  if (!o || !t || o.lat == null || t.lat == null) return null;
  const now = Date.now();
  const pos = aircraftPosition(d, now);
  const flown = distanceM(o.lat, o.lon, pos.lat, pos.lon) / 1000;
  const left = distanceM(pos.lat, pos.lon, t.lat, t.lon) / 1000;
  const total = distanceM(o.lat, o.lon, t.lat, t.lon) / 1000;
  // Se l'aereo è molto fuori dalla linea tra i due aeroporti, la rotta probabilmente non è quella giusta
  if (flown + left > total * 1.35 + 150) return null;
  const speed = Math.max((d.gsKt || 430) * 1.852, 350); // km/h
  const etaMin = (left / speed) * 60 + (left > 150 ? 12 : 5);  // margine per discesa e avvicinamento
  const depMin = (flown / (speed * 0.85)) * 60 + 6;            // la salita è più lenta della crociera
  return {
    left,
    progress: Math.min(1, flown / Math.max(1, flown + left)),
    eta: new Date(now + etaMin * 60000),
    dep: new Date(now - depMin * 60000),
  };
}

function pollCenter() {
  if (state.mode === 'ride' && state.ride?.kind === 'plane') {
    const pose = ridePose();
    if (pose) return { lat: pose.lat, lon: pose.lon, nm: 50 };
  }
  if (state.mode === 'map') {
    const c = camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    if (c) {
      const g = C.Cartographic.fromCartesian(c);
      return { lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude), nm: 120 };
    }
  }
  return { lat: state.home.lat, lon: state.home.lon, nm: 80 };
}

async function pollPlanes() {
  clearTimeout(state.pollTimer);
  if (state.home && !document.hidden) {
    const c = pollCenter();
    try {
      const res = await fetchAircraft(c.lat, c.lon, c.nm);
      mergePlanes(res.list);
      state.planeSource = res.source;
      state.planeFetchedAt = Date.now();
      state.planeError = false;
    } catch (e) {
      state.planeError = true;
      state.planeNeedsProxy = !!e?.needsProxy;
    }
    updateStatus();
  }
  state.pollTimer = setTimeout(pollPlanes, state.mode === 'ride' ? 5000 : 10000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.home) { pollPlanes(); pollShips(); }
});

// ---------------------------------------------------------------- satelliti
async function startSatellites() {
  try {
    const res = await loadSatellites();
    state.satSource = res.source;
    for (const s of res.list) {
      const entity = viewer.entities.add({
        id: `sat:${s.id}`,
        position: new C.ConstantPositionProperty(new C.Cartesian3()),
        show: false,
        point: {
          pixelSize: 5,
          color: SAT,
          outlineColor: OUTLINE,
          outlineWidth: 1,
        },
        label: {
          text: s.name,
          font: '12px B612, system-ui, sans-serif',
          fillColor: SAT,
          outlineColor: OUTLINE,
          outlineWidth: 4,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: C.HorizontalOrigin.LEFT,
          pixelOffset: new C.Cartesian2(8, -6),
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2.6e6),
        },
      });
      state.sats.set(s.id, { ...s, entity, pos: null });
    }
    updateSatellites();
    setInterval(updateSatellites, 1000);
  } catch {
    state.satError = true;
  }
  updateStatus();
}

function updateSatellites() {
  const now = new Date();
  for (const s of state.sats.values()) {
    const p = satellitePosition(s.satrec, now);
    s.pos = p;
    const ridden = state.ride?.kind === 'sat' && state.ride.id === s.id;
    if (!p) { s.entity.show = false; continue; }
    s.entity.position.setValue(C.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
    s.entity.show = !ridden;
  }
}

// ---------------------------------------------------------------- navi
function shipLabel(d) {
  return d.name || `MMSI ${d.mmsi}`;
}

function addShipEntity(mmsi, d) {
  return viewer.entities.add({
    id: `ship:${mmsi}`,
    position: new C.CallbackProperty(() => {
      const h = state.ships.get(mmsi);
      if (!h) return undefined;
      const p = shipPosition(h.data, Date.now());
      return C.Cartesian3.fromDegrees(p.lon, p.lat, 6);
    }, false),
    point: {
      pixelSize: 7,
      color: SHIP,
      outlineColor: OUTLINE,
      outlineWidth: 2,
      scaleByDistance: new C.NearFarScalar(2e3, 1.6, 3e5, 0.7),
    },
    label: {
      text: shipLabel(d),
      font: '12px B612, system-ui, sans-serif',
      fillColor: SHIP,
      outlineColor: OUTLINE,
      outlineWidth: 4,
      style: C.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: C.HorizontalOrigin.LEFT,
      pixelOffset: new C.Cartesian2(9, -6),
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, 70000),
    },
  });
}

const SHIPS_KEY = 'finestrino.ships.v1';

function saveShips() {
  try {
    localStorage.setItem(SHIPS_KEY, JSON.stringify([...state.ships.values()].map((h) => h.data)));
  } catch { /* spazio pieno */ }
}

function restoreShips() {
  try {
    const list = JSON.parse(localStorage.getItem(SHIPS_KEY) || '[]');
    if (Array.isArray(list) && list.length) mergeShips(list, false);
  } catch { /* dati non validi */ }
}

// Nome, tipo, destinazione e arrivo arrivano solo ogni 6 minuti: li ricordiamo per 3 giorni
const SHIPINFO_KEY = 'finestrino.shipinfo.v1';
const INFO_FIELDS = ['name', 'type', 'destination', 'eta', 'length'];
const shipInfo = (() => {
  try {
    const all = JSON.parse(localStorage.getItem(SHIPINFO_KEY) || '{}');
    const limit = Date.now() - 3 * 86400000;
    for (const k of Object.keys(all)) if (!all[k].t || all[k].t < limit) delete all[k];
    return all;
  } catch { return {}; }
})();
let shipInfoDirty = false;

function rememberShipInfo(d) {
  const info = shipInfo[d.mmsi] || {};
  let changed = false;
  for (const f of INFO_FIELDS) {
    if (d[f] != null && d[f] !== '' && info[f] !== d[f]) { info[f] = d[f]; changed = true; }
  }
  if (changed) { info.t = Date.now(); shipInfo[d.mmsi] = info; shipInfoDirty = true; }
}

function withShipInfo(d) {
  const info = shipInfo[d.mmsi];
  if (!info) return d;
  const out = { ...d };
  for (const f of INFO_FIELDS) if ((out[f] == null || out[f] === '') && info[f] != null) out[f] = info[f];
  return out;
}

setInterval(() => {
  if (!shipInfoDirty) return;
  shipInfoDirty = false;
  try { localStorage.setItem(SHIPINFO_KEY, JSON.stringify(shipInfo)); } catch { /* spazio pieno */ }
}, 10000);

function mergeShips(list, save = true) {
  for (const raw of list) {
    rememberShipInfo(raw);
    const d = withShipInfo(raw);
    const h = state.ships.get(d.mmsi);
    if (h) {
      h.data = { ...h.data, ...d };
      h.entity.label.text = shipLabel(h.data);
    } else {
      state.ships.set(d.mmsi, { data: d, entity: addShipEntity(d.mmsi, d) });
    }
  }
  // Le navi trasmettono di rado: le teniamo 15 minuti dall'ultima posizione ricevuta
  const now = Date.now();
  for (const [mmsi, h] of state.ships) {
    if (now - h.data.seen > 15 * 60 * 1000) {
      if (state.selected === `ship:${mmsi}`) closeCard();
      viewer.entities.remove(h.entity);
      state.ships.delete(mmsi);
    }
  }
  if (save) saveShips();
}

function shipCenter() {
  if (state.mode === 'ride') {
    const pose = ridePose();
    if (pose) return { lat: pose.lat, lon: pose.lon, nm: 150 };
  }
  if (state.mode === 'map') {
    const c = camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    if (c) {
      const g = C.Cartographic.fromCartesian(c);
      return { lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude), nm: 150 };
    }
  }
  return { lat: state.home.lat, lon: state.home.lon, nm: 150 };
}

async function pollShips() {
  clearTimeout(state.shipTimer);
  if (state.home && !document.hidden) {
    const c = shipCenter();
    try {
      mergeShips(await fetchShips(c.lat, c.lon, c.nm));
      state.shipError = false;
      state.shipFetchedAt = Date.now();
    } catch {
      state.shipError = true;
    }
    updateStatus();
  }
  state.shipTimer = setTimeout(pollShips, 30000);
}

// ---------------------------------------------------------------- nuvole dal meteo vero
function placeClouds(cover) {
  clouds.removeAll();
  const h = state.home;
  const n = Math.round((clamp(cover, 0, 100) / 100) * 48);
  for (let i = 0; i < n; i++) {
    const p = destination(h.lat, h.lon, Math.random() * 360, 1500 + Math.random() * 26000);
    clouds.add({
      position: C.Cartesian3.fromDegrees(p.lon, p.lat, h.ground + 1100 + Math.random() * 1900),
      scale: new C.Cartesian2(1600 + Math.random() * 2400, 450 + Math.random() * 500),
      maximumSize: new C.Cartesian3(50, 15, 13),
      slice: 0.3 + Math.random() * 0.2,
      brightness: cover > 85 ? 0.8 : 1,
    });
  }
}

async function loadWeather() {
  try {
    const w = await fetchWeather(state.home.lat, state.home.lon);
    $('weather').textContent = `${fmt0(w.temperature_2m)}°, ${describeWeather(w.weather_code)}`;
    placeClouds(w.cloud_cover ?? 0);
  } catch {
    $('weather').textContent = '';
  }
}

// ---------------------------------------------------------------- selezione e scheda
function entityAt(win) {
  const picked = scene.pick(win);
  if (picked?.id instanceof C.Entity) return picked.id;

  // Tocco impreciso: prende l'oggetto visibile più vicino entro 32 px
  const toWin = C.SceneTransforms.worldToWindowCoordinates || C.SceneTransforms.wgs84ToWindowCoordinates;
  const now = C.JulianDate.now();
  const occluder = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, camera.positionWC);
  let best = null;
  let bestD = 32;
  const scratch = new C.Cartesian3();
  for (const e of viewer.entities.values) {
    if (!e.show) continue;
    const p = e.position?.getValue(now);
    if (!p) continue;
    C.Cartesian3.subtract(p, camera.positionWC, scratch);
    if (C.Cartesian3.dot(scratch, camera.directionWC) <= 0) continue;
    if (!occluder.isPointVisible(p)) continue;
    const w = toWin(scene, p);
    if (!w) continue;
    const d = Math.hypot(w.x - win.x, w.y - win.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

viewer.screenSpaceEventHandler.setInputAction((click) => {
  if (state.mode === 'intro' || state.mode === 'arriving') return;
  const e = entityAt(click.position);
  if (e && e.id !== 'route-line') openCard(e.id);
  else if (state.selected) closeCard();
}, C.ScreenSpaceEventType.LEFT_CLICK);

// Linea tratteggiata dal mezzo selezionato alla sua destinazione
const routeLine = viewer.entities.add({
  id: 'route-line',
  show: false,
  polyline: {
    positions: [],
    width: 2,
    arcType: C.ArcType.GEODESIC,
    material: new C.PolylineDashMaterialProperty({ color: C.Color.WHITE.withAlpha(0.75), dashLength: 18 }),
  },
});

function updateRouteLine() {
  const id = state.selected || (state.mode === 'ride' && state.ride ? `${state.ride.kind}:${state.ride.id}` : null);
  let from = null;
  let to = null;
  let color = PLANE;
  if (id) {
    const [kind, key] = id.split(':');
    if (kind === 'plane') {
      const p = state.planes.get(key);
      const rt = p && p.data.callsign ? knownRoute(p.data.callsign) : null;
      if (p && rt && rt.destination && rt.destination.lat != null) {
        const pos = aircraftPosition(p.data, Date.now());
        from = [pos.lon, pos.lat, pos.alt];
        to = [rt.destination.lon, rt.destination.lat, 0];
      }
    } else if (kind === 'ship') {
      const sh = state.ships.get(Number(key));
      const dest = sh && sh.data.destination ? splitDestination(sh.data.destination) : null;
      const port = dest && dest.to ? knownPort(dest.to) : null;
      if (port) {
        const pos = shipPosition(sh.data, Date.now());
        from = [pos.lon, pos.lat, 30];
        to = [port.lon, port.lat, 30];
        color = SHIP;
      }
    }
  }
  if (!from) { routeLine.show = false; return; }
  routeLine.polyline.positions = C.Cartesian3.fromDegreesArrayHeights([...from, ...to]);
  routeLine.polyline.material = new C.PolylineDashMaterialProperty({ color: color.withAlpha(0.8), dashLength: 18 });
  routeLine.show = true;
}

function openCard(id) {
  state.selected = id;
  $('card').hidden = false;
  renderCard();
}

function closeCard() {
  state.selected = null;
  $('card').hidden = true;
  updateRouteLine();
}

function row(dt, dd) {
  return `<dt>${dt}</dt><dd>${dd}</dd>`;
}

function renderCard() {
  const id = state.selected;
  if (!id) return;
  const [kind, key] = id.split(':');
  const h = state.home;
  let title = '', sub = '', rows = '', route = '', routeMuted = false;

  if (kind === 'plane') {
    const p = state.planes.get(key);
    if (!p) return closeCard();
    const d = p.data;
    const pos = aircraftPosition(d, Date.now());
    const rt = d.callsign ? knownRoute(d.callsign) : null;
    title = flightName(d);
    route = routeText(d);
    sub = [rt && rt.airline, d.desc || d.type].filter(Boolean).join(', ') || t('Aereo in volo');
    rows += row(t('Quota'), altText(pos.alt));
    if (d.gsKt !== null) rows += row(t('Velocità'), `${fmt0(d.gsKt * 1.852)} km/h`);
    if (d.track !== null) rows += row(t('Direzione'), t('verso {dir}', { dir: compass(d.track) }));
    rows += row(t('Distanza da te'), `${fmt1(distanceM(h.lat, h.lon, pos.lat, pos.lon) / 1000)} km`);
    const ft = flightTimes(d);
    if (ft) {
      rows += row(t('Decollo (stima)'), t('verso le {time}', { time: hm(ft.dep) }));
      rows += row(t('Atterraggio (stima)'), t('verso le {time}', { time: hm(ft.eta) }));
      rows += row(t('Percorso'), t('{pct}%, mancano {km} km', { pct: Math.round(ft.progress * 100), km: fmt0(ft.left) }));
    }
    if (!route) {
      route = !d.callsign ? t('Rotta non trasmessa da questo aereo')
        : rt === undefined ? t('Cerco da dove viene e dove va…')
          : t('Rotta non disponibile per questo volo');
      routeMuted = true;
    }
    if (d.callsign && title !== d.callsign) rows += row(t('Codice radio'), escapeHtml(d.callsign));
    if (d.reg) rows += row(t('Registrazione'), escapeHtml(d.reg));
  } else if (kind === 'ship') {
    const sh = state.ships.get(Number(key));
    if (!sh) return closeCard();
    const d = sh.data;
    const pos = shipPosition(d, Date.now());
    title = shipLabel(d);
    sub = shipTypeName(d.type) + (NAV_STATUS[d.status] ? `, ${NAV_STATUS[d.status]}` : '');
    rows += d.sog > 0.3
      ? row(t('Velocità'), t('{kn} nodi ({kmh} km/h)', { kn: fmt1(d.sog), kmh: fmt0(d.sog * 1.852) }))
      : row(t('Velocità'), t('ferma'));
    if (d.sog > 0.3 && d.cog != null) rows += row(t('Direzione'), t('verso {dir}', { dir: compass(d.cog) }));

    // Rotta: partenza (se l'equipaggio la scrive) e destinazione
    const dest = d.destination ? splitDestination(d.destination) : null;
    const toPort = dest && dest.to ? knownPort(dest.to) : null;
    const fromPort = dest && dest.from ? knownPort(dest.from) : null;
    const dateFmt = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    if (dest && dest.to) {
      const toName = toPort ? portLabel(toPort) : dest.to;
      const fromName = dest.from ? (fromPort ? portLabel(fromPort) : dest.from) : null;
      route = fromName ? `${fromName} → ${toName}` : toPort ? t('Verso {place}', { place: toName }) : t('Destinazione: {place}', { place: toName });
      if (toPort) {
        const left = distanceM(pos.lat, pos.lon, toPort.lat, toPort.lon) / 1000;
        rows += row(t('Mancano'), t('{nm} miglia ({km} km in linea d\'aria)', { nm: fmt0(left / 1.852), km: fmt0(left) }));
        if (d.sog > 1) {
          const est = new Date(Date.now() + (left / (d.sog * 1.852)) * 3600000 * 1.1);
          rows += row(t('Arrivo (stima)'), escapeHtml(est.toLocaleString(LOCALE, dateFmt)));
        }
      }
      if (toPort) rows += row(t('Destinazione scritta'), escapeHtml(d.destination));
    } else {
      route = t('Destinazione non ancora ricevuta: le navi la trasmettono ogni 6 minuti');
      routeMuted = true;
    }
    if (d.eta) {
      const eta = new Date(d.eta);
      rows += row(t('Arrivo dichiarato'), escapeHtml(eta.toLocaleString(LOCALE, dateFmt)));
    }
    if (d.length) rows += row(t('Lunghezza'), `${fmt0(d.length)} m`);
    rows += row(t('Distanza da te'), `${fmt1(distanceM(h.lat, h.lon, pos.lat, pos.lon) / 1000)} km`);
  } else {
    const s = state.sats.get(key);
    if (!s || !s.pos) return closeCard();
    title = s.name;
    sub = (s.id === '25544' || s.id === '48274') ? t('Stazione spaziale con equipaggio') : t('Satellite in orbita');
    rows += row(t('Quota'), `${fmt0(s.pos.alt / 1000)} km`);
    if (s.pos.speedKms) rows += row(t('Velocità'), `${fmt0(s.pos.speedKms * 3600)} km/h`);
    rows += row(t('Distanza da te'), t('{km} km in linea d\'aria al suolo', { km: fmt0(distanceM(h.lat, h.lon, s.pos.lat, s.pos.lon) / 1000) }));
  }

  $('board').hidden = kind === 'ship'; // sulle navi non si sale (per ora)
  $('card-share').hidden = kind === 'ship';
  $('card-route').textContent = route;
  $('card-route').classList.toggle('is-muted', routeMuted);
  $('card-title').textContent = title;
  $('card-sub').textContent = sub;
  $('card-data').innerHTML = rows;
}

$('card-close').addEventListener('click', closeCard);
$('board').addEventListener('click', () => state.selected && startRide(state.selected));

// ---------------------------------------------------------------- a bordo
function setWindow() {
  const r = state.ride;
  const win = $('window');
  const porthole = r?.kind === 'sat';
  win.hidden = !r || r.view === 'front';
  win.classList.toggle('is-porthole', porthole);
  document.body.classList.toggle('riding', !!r && r.view !== 'front');
  document.body.classList.toggle('porthole', porthole);
}

function defaultPitch(kind, view) {
  if (kind === 'sat') return view === 'front' ? -35 : -55;
  return view === 'front' ? -6 : -14;
}

function setView(view) {
  const r = state.ride;
  r.view = view;
  r.yaw = 0;
  r.pitch = defaultPitch(r.kind, view);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.view === view));
  setWindow();
}

function startRide(id) {
  const [kind, key] = id.split(':');
  const entity = viewer.entities.getById(id);
  if (!entity) return;
  if (state.ride) endRide();
  state.ride = { kind, id: key, view: 'left', yaw: 0, pitch: defaultPitch(kind, 'left') };
  entity.show = false;
  closeCard();
  controller.enableInputs = false;
  state.mode = 'ride';
  setFov(kind === 'sat' ? 75 : 62);
  $('sky-controls').hidden = true;
  $('ride-controls').hidden = false;
  $('sound').hidden = kind !== 'plane'; // nello spazio non c'è rumore
  setView('left');
  applySound();
  updateStatus();
  pollPlanes();
  pollShips();
}

// Rumore di cabina: solo a bordo degli aerei, mai sui satelliti
function applySound() {
  const btn = $('sound');
  btn.classList.toggle('is-on', state.sound);
  btn.setAttribute('aria-pressed', String(state.sound));
  btn.textContent = state.sound ? t('Suono') : t('Muto');
  if (state.ride?.kind === 'plane' && state.sound) startCabin();
  else stopCabin();
}

$('sound').addEventListener('click', () => {
  state.sound = !state.sound;
  try { localStorage.setItem(SOUND_KEY, state.sound ? 'on' : 'off'); } catch { /* */ }
  applySound();
});

function endRide(message) {
  const r = state.ride;
  if (!r) return;
  const entity = viewer.entities.getById(`${r.kind}:${r.id}`);
  if (entity) entity.show = true;
  state.ride = null;
  stopCabin();
  setWindow();
  $('ride-controls').hidden = true;
  $('sky-controls').hidden = false;
  setMode('sky');
  if (message) toast(message);
}

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('leave').addEventListener('click', () => endRide());

// ---------------------------------------------------------------- modalità cielo / mappa
function setMode(mode) {
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
  if (mode === 'sky') {
    state.mode = 'sky';
    controller.enableInputs = false;
    setFov(70);
  } else if (mode === 'map') {
    state.mode = 'map';
    setFov(60);
    controller.enableInputs = true;
    const h = state.home;
    const back = destination(h.lat, h.lon, 180, 90000);
    camera.flyTo({
      destination: C.Cartesian3.fromDegrees(back.lon, back.lat, 85000),
      orientation: { heading: 0, pitch: C.Math.toRadians(-48), roll: 0 },
      duration: reducedMotion ? 0 : 2,
    });
  }
  updateStatus();
}

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------------------------------------------------------------- stato e avvisi
function updateStatus() {
  const el = $('status');
  if (!state.home) return;
  el.hidden = false;

  if (state.mode === 'ride') {
    const pose = ridePose();
    const r = state.ride;
    if (pose && r.kind === 'plane') {
      const d = state.planes.get(r.id)?.data;
      const speed = d?.gsKt ? `, ${fmt0(d.gsKt * 1.852)} km/h` : '';
      const route = routeText(d);
      const ft = flightTimes(d);
      const eta = ft ? t(', atterraggio verso le {time}', { time: hm(ft.eta) }) : '';
      el.textContent = `${t('A bordo di {name}', { name: flightName(d) })}${route ? `, ${route}` : ''}\n${altText(pose.alt)}${speed}, ${t('verso {dir}', { dir: compass(pose.heading) })}${eta}`;
    } else if (pose) {
      el.textContent = t('A bordo di {name}, {km} km di quota', { name: state.sats.get(r.id).name, km: fmt0(pose.alt / 1000) });
    }
    return;
  }

  if (state.planeError && !state.planeFetchedAt) {
    el.textContent = state.planeNeedsProxy
      ? t('Aerei non disponibili: il browser blocca le fonti dirette. Configura il Worker gratuito in js/config.js (vedi README).')
      : t('Il Worker degli aerei non risponde. Riprovo tra pochi secondi.');
    return;
  }
  const n = state.planes.size;
  const age = state.planeFetchedAt ? Math.round((Date.now() - state.planeFetchedAt) / 1000) : null;
  let text = t(n === 1 ? '1 aereo e {sats} satelliti tracciati' : '{n} aerei e {sats} satelliti tracciati', { n, sats: state.sats.size });
  if (age !== null) text += t('. Dati {src}, aggiornati {age} s fa', { src: state.planeSource, age });
  if (state.satError) text += t('. Satelliti non disponibili ora');

  // Riga delle navi: sempre presente, così si capisce cosa sta succedendo
  const ns = state.ships.size;
  let ships;
  if (ns) ships = ns === 1 ? t('1 nave sul mare') : t('{n} navi sul mare', { n: ns });
  else if (state.shipError) ships = t('Navi non disponibili ora, riprovo tra 30 secondi');
  else if (!state.shipFetchedAt) ships = t('Navi in arrivo…');
  else ships = t('Nessuna nave ricevuta finora: in questa zona i ricevitori AIS sono pochi, continuo ad ascoltare');
  text += `.\n${ships}`;
  el.textContent = text.endsWith('…') ? text : text + '.';
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

setInterval(() => {
  updateStatus();
  if (state.selected) renderCard();
  updateRouteLine();
}, 1000);

// ---------------------------------------------------------------- luogo
function saveHome(h) {
  try { localStorage.setItem(HOME_KEY, JSON.stringify({ lat: h.lat, lon: h.lon, name: h.name })); } catch { /* */ }
}

function readHome() {
  try { return JSON.parse(localStorage.getItem(HOME_KEY) || 'null'); } catch { return null; }
}

let started = false;

async function setHome(lat, lon, name, opts = {}) {
  $('intro-msg').textContent = t('Preparo il cielo sopra di te…');
  const ground = await sampleHeight(lat, lon).catch(() => 0);
  state.home = { lat, lon, name, ground };
  if (opts.save !== false) saveHome(state.home);
  $('place').textContent = t(name);

  if (state.ride) endRide();
  closeCard();
  for (const h of state.planes.values()) viewer.entities.remove(h.entity);
  state.planes.clear();
  state.planeFetchedAt = 0;
  for (const h of state.ships.values()) viewer.entities.remove(h.entity);
  state.ships.clear();
  state.shipFetchedAt = 0;
  restoreShips();

  $('intro').hidden = true;
  $('topbar').hidden = false;
  $('controls').hidden = false;
  $('credits-btn').hidden = false;

  state.mode = 'arriving';
  controller.enableInputs = false;
  setFov(70);
  camera.flyTo({
    destination: C.Cartesian3.fromDegrees(lon, lat, ground + 30),
    orientation: {
      heading: C.Math.toRadians(state.look.heading),
      pitch: C.Math.toRadians(state.look.pitch),
      roll: 0,
    },
    duration: reducedMotion ? 0 : 4.5,
    complete: () => { setMode('sky'); if (opts.onArrive) opts.onArrive(); },
    cancel: () => { setMode('sky'); if (opts.onArrive) opts.onArrive(); },
  });

  loadWeather();
  pollPlanes();
  pollShips();
  if (!started) {
    started = true;
    startSatellites();
  }
}

function useMyLocation() {
  const msg = $('intro-msg');
  if (!('geolocation' in navigator)) {
    msg.textContent = t('Questo browser non condivide la posizione. Cerca un luogo per nome.');
    return openPlaceDialog();
  }
  msg.textContent = t('Chiedo la posizione al browser…');
  navigator.geolocation.getCurrentPosition(
    (p) => setHome(p.coords.latitude, p.coords.longitude, 'La tua posizione'),
    () => {
      msg.textContent = t('Posizione non disponibile. Cerca un luogo per nome.');
      openPlaceDialog();
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
  );
}

function openPlaceDialog() {
  $('place-results').innerHTML = '';
  $('place-input').value = '';
  $('place-dialog').showModal();
  $('place-input').focus();
}

$('place-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('place-input').value.trim();
  const list = $('place-results');
  if (!q) return;
  list.innerHTML = `<li><p>${t('Cerco…')}</p></li>`;
  try {
    const results = await searchPlaces(q);
    if (!results.length) {
      list.innerHTML = `<li><p>${t('Nessun luogo con questo nome. Prova con la città più vicina.')}</p></li>`;
      return;
    }
    list.innerHTML = '';
    for (const r of results) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${escapeHtml(r.name)}<small>${escapeHtml(r.detail)}</small>`;
      b.addEventListener('click', () => {
        $('place-dialog').close();
        setHome(r.lat, r.lon, r.name);
      });
      li.append(b);
      list.append(li);
    }
  } catch {
    list.innerHTML = `<li><p>${t('La ricerca non risponde. Controlla la connessione e riprova.')}</p></li>`;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('place-cancel').addEventListener('click', () => $('place-dialog').close());
$('use-location').addEventListener('click', useMyLocation);
$('search-place').addEventListener('click', openPlaceDialog);
$('place').addEventListener('click', openPlaceDialog);
$('credits-btn').addEventListener('click', () => $('credits-dialog').showModal());
$('credits-close').addEventListener('click', () => $('credits-dialog').close());

const saved = readHome();
if (saved) {
  const b = $('resume-place');
  b.hidden = false;
  b.textContent = saved.name === 'La tua posizione' ? t('Torna dove eri') : t('Torna a {place}', { place: saved.name });
  b.addEventListener('click', () => setHome(saved.lat, saved.lon, saved.name));
}

// ---------------------------------------------------------------- aggiornamento automatico
startAutoUpdate(() => state.mode !== 'ride' && state.mode !== 'arriving', toast).then((v) => {
  if (v) $('app-version').textContent = t('Versione {v}.', { v });
});

// ---------------------------------------------------------------- altezza dei comandi (per non coprirli con la scheda)
const controlsEl = $('controls');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--controls-h', `${controlsEl.offsetHeight}px`);
}).observe(controlsEl);

// ---------------------------------------------------------------- cerca un volo
function openFindDialog() {
  $('find-results').innerHTML = '';
  $('find-input').value = '';
  $('find-dialog').showModal();
  $('find-input').focus();
}

function boardFound(d) {
  if ($('find-dialog').open) $('find-dialog').close();
  upsertPlane(d);
  knownRoute(d.callsign);
  startRide(`plane:${d.hex}`);
}

$('find-btn').addEventListener('click', openFindDialog);
$('find-cancel').addEventListener('click', () => $('find-dialog').close());
$('find-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('find-input').value.trim();
  const list = $('find-results');
  if (!q) return;
  list.innerHTML = `<li><p>${t('Cerco nel cielo…')}</p></li>`;
  try {
    const raw = await findFlight(q);
    const flying = raw.map(normalizeAircraft).filter(Boolean);
    if (!raw.length) {
      list.innerHTML = `<li><p>${t('Nessun aereo in volo con questo codice. Forse non è ancora decollato o è già atterrato, oppure la compagnia usa via radio un codice diverso: prova quello che vedi sul tabellone o su un sito di voli.')}</p></li>`;
      return;
    }
    if (!flying.length) {
      list.innerHTML = `<li><p>${t('L\'ho trovato, ma in questo momento è a terra. Riprova quando sarà decollato.')}</p></li>`;
      return;
    }
    if (flying.length === 1) return boardFound(flying[0]);
    list.innerHTML = '';
    for (const d of flying) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${escapeHtml(planeLabel(d))}<small>${escapeHtml([d.desc || d.type, `${fmt0(d.altM)} m`].filter(Boolean).join(', '))}</small>`;
      b.addEventListener('click', () => boardFound(d));
      li.append(b);
      list.append(li);
    }
  } catch {
    list.innerHTML = `<li><p>${t('La ricerca non risponde. Controlla la connessione e riprova.')}</p></li>`;
  }
});

// ---------------------------------------------------------------- condividi
function shareKey() {
  if (state.mode === 'ride' && state.ride) return [state.ride.kind, state.ride.id];
  if (state.selected) return state.selected.split(':');
  return [null, null];
}

async function shareCurrent() {
  const [kind, key] = shareKey();
  if (!kind || kind === 'ship') return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('lang', LANG);
  let text;
  if (kind === 'plane') {
    const d = state.planes.get(key)?.data;
    if (!d) return;
    url.searchParams.set('volo', key);
    if (d.callsign) url.searchParams.set('cs', d.callsign);
    const rt = d.callsign ? knownRoute(d.callsign) : null;
    const alt = fmt0(aircraftPosition(d, Date.now()).alt);
    const from = rt?.origin && (rt.origin.city || rt.origin.name);
    const to = rt?.destination && (rt.destination.city || rt.destination.name);
    text = from && to
      ? t('Sono al finestrino del volo {name} da {from} a {to}, a {alt} metri. Vieni a guardare in diretta:', { name: flightName(d), from, to, alt })
      : t('Sono al finestrino del volo {name}, a {alt} metri. Vieni a guardare in diretta:', { name: flightName(d), alt });
  } else {
    const s = state.sats.get(key);
    if (!s) return;
    url.searchParams.set('sat', key);
    const alt = s.pos ? t(', a {km} km dalla Terra', { km: fmt0(s.pos.alt / 1000) }) : '';
    text = t('Sono a bordo di {name}{alt}. Vieni a guardare in diretta:', { name: s.name, alt });
  }
  const link = url.toString();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Finestrino', text, url: link });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`);
    toast(t('Link copiato: incollalo in un messaggio.'));
  } catch {
    window.prompt(t('Copia questo link:'), link);
  }
}

$('share').addEventListener('click', shareCurrent);
$('card-share').addEventListener('click', shareCurrent);

// ---------------------------------------------------------------- aprire un link condiviso
const params = new URLSearchParams(location.search);
const linkPlane = params.get('volo');
const linkCs = params.get('cs');
const linkSat = params.get('sat');

function clearLink() {
  history.replaceState(null, '', location.pathname);
}

async function waitSat(id) {
  for (let i = 0; i < 60; i++) {
    if (state.sats.get(id)?.pos) return startRide(`sat:${id}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  toast(t('Non trovo più questo satellite. Guarda il cielo sopra di te.'));
}

async function joinFromLink() {
  const msg = $('intro-msg');
  const btn = $('join-link');
  btn.disabled = true;
  try {
    if (linkPlane) {
      msg.textContent = t('Cerco il volo…');
      let raw = await findFlight(linkPlane).catch(() => []);
      if (!raw.length && linkCs) raw = await findFlight(linkCs).catch(() => []);
      const d = raw.map(normalizeAircraft).find(Boolean);
      if (!d) {
        msg.textContent = t('Questo volo non è più in aria: probabilmente è atterrato. Puoi guardare il cielo sopra di te.');
        btn.hidden = true;
        $('use-location').classList.replace('ghost', 'primary');
        clearLink();
        return;
      }
      const home = saved || { lat: d.lat, lon: d.lon, name: 'Sotto il volo' };
      clearLink();
      await setHome(home.lat, home.lon, home.name, {
        save: !!saved,
        onArrive: () => boardFound(d),
      });
    } else if (linkSat) {
      msg.textContent = t('Preparo il viaggio in orbita…');
      const home = saved || { lat: 41.9, lon: 12.5, name: 'Italia' };
      clearLink();
      await setHome(home.lat, home.lon, home.name, { save: !!saved, onArrive: () => waitSat(linkSat) });
    }
  } finally {
    btn.disabled = false;
  }
}

if (linkPlane || linkSat) {
  $('intro-lede').textContent = linkPlane
    ? t('Ti hanno invitato al finestrino del volo {name}, in diretta. Tocca il pulsante e sali a bordo.', { name: (linkCs || linkPlane).toUpperCase() })
    : t('Ti hanno invitato a bordo di un satellite, in diretta. Tocca il pulsante e parti.');
  $('join-link').hidden = false;
  $('use-location').classList.replace('primary', 'ghost');
  $('join-link').addEventListener('click', joinFromLink);
}

// ---------------------------------------------------------------- sopra di me
/** Direzione (azimut), altezza sull'orizzonte e distanza di un punto visto da casa. */
function lookFromHome(lat, lon, alt) {
  const h = state.home;
  const o = C.Cartesian3.fromDegrees(h.lon, h.lat, h.ground + 2);
  const t = C.Cartesian3.fromDegrees(lon, lat, alt);
  const inv = C.Matrix4.inverseTransformation(C.Transforms.eastNorthUpToFixedFrame(o), new C.Matrix4());
  const v = C.Matrix4.multiplyByPoint(inv, t, new C.Cartesian3());
  const range = C.Cartesian3.magnitude(v);
  return {
    az: ((Math.atan2(v.x, v.y) * 180) / Math.PI + 360) % 360,
    el: (Math.asin(v.z / range) * 180) / Math.PI,
    range,
  };
}

function lookAt(az, el) {
  if (state.mode !== 'sky') setMode('sky');
  state.look.heading = az;
  state.look.pitch = clamp(el, -10, 85);
}

function heightWords(el) {
  if (el > 70) return t('quasi sopra la testa');
  if (el > 40) return t('alto nel cielo');
  if (el > 15) return t('a metà cielo');
  return t('basso sull\'orizzonte');
}

function renderOverhead() {
  const list = $('overhead-planes');
  const now = Date.now();
  const items = [...state.planes.values()]
    .map((p) => {
      const pos = aircraftPosition(p.data, now);
      return { d: p.data, look: lookFromHome(pos.lat, pos.lon, pos.alt) };
    })
    .filter((x) => x.look.el > 3)
    .sort((a, b) => a.look.range - b.look.range)
    .slice(0, 6);

  if (!items.length) {
    list.innerHTML = `<li><p>${t('In questo momento nessun aereo è sopra il tuo orizzonte. Riprova tra qualche minuto.')}</p></li>`;
    return;
  }
  list.innerHTML = '';
  for (const { d, look } of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const route = routeText(d);
    const where = `${fmt1(look.range / 1000)} km, ${heightWords(look.el)} ${t('in direzione {dir}', { dir: compass(look.az) })}`;
    b.innerHTML = `${escapeHtml(flightName(d))}${route ? ` <span class="muted">${escapeHtml(route)}</span>` : ''}<small>${escapeHtml(where)}</small>`;
    b.addEventListener('click', () => {
      $('overhead-dialog').close();
      lookAt(look.az, look.el);
      openCard(`plane:${d.hex}`);
    });
    li.append(b);
    list.append(li);
  }
}

function renderPasses() {
  const list = $('overhead-iss');
  const iss = state.sats.get('25544');
  if (!iss) {
    list.innerHTML = `<li><p>${t('Sto ancora caricando le orbite dei satelliti. Riapri tra qualche secondo.')}</p></li>`;
    return;
  }
  const passes = visiblePasses(iss.satrec, state.home, 72, 4);
  if (!passes.length) {
    list.innerHTML = `<li><p>${t('Nessun passaggio visibile nelle prossime 72 ore: in questi giorni la Stazione passa di giorno o in pieno buio, quando non è illuminata dal Sole.')}</p></li>`;
    return;
  }
  list.innerHTML = '';
  const dayFmt = { weekday: 'long', day: 'numeric', month: 'long' };
  for (const p of passes) {
    const mins = Math.max(1, Math.round((p.end - p.start) / 60000));
    const day = p.start.toLocaleDateString(LOCALE, dayFmt);
    const desc = t('Appare a {a} alle {t1}, sale fino a {el}° verso {b} e sparisce a {c} alle {t2}. Visibile a occhio nudo come un punto luminoso che si muove veloce, senza lampeggiare.', {
      a: compass(p.startAz), t1: hm(p.start), el: Math.round(p.maxEl), b: compass(p.maxAz), c: compass(p.endAz), t2: hm(p.end),
    });
    const li = document.createElement('li');
    li.className = 'pass';
    li.innerHTML = `<p class="pass-when">${escapeHtml(day)}, ${t('alle {time}', { time: hm(p.start) })} <span class="muted">${t('per {min} min', { min: mins })}</span></p>
      <p class="pass-desc">${t('Da {a} a {b}, alta fino a {el}° sull\'orizzonte.', { a: compass(p.startAz), b: compass(p.endAz), el: Math.round(p.maxEl) })}</p>`;
    const actions = document.createElement('div');
    actions.className = 'pass-actions';
    const cal = document.createElement('button');
    cal.type = 'button';
    cal.className = 'ghost small';
    cal.textContent = t('Aggiungi al calendario');
    cal.addEventListener('click', () => downloadPassIcs(p, t('Stazione Spaziale Internazionale'), desc));
    const see = document.createElement('button');
    see.type = 'button';
    see.className = 'ghost small';
    see.textContent = t('Dove guardare');
    see.addEventListener('click', () => {
      $('overhead-dialog').close();
      lookAt(p.startAz, 15);
      toast(t('Guarda a {dir}, basso sull\'orizzonte: alle {time} la Stazione apparirà lì.', { dir: compass(p.startAz), time: hm(p.start) }));
    });
    actions.append(see, cal);
    li.append(actions);
    list.append(li);
  }
}

function openOverhead() {
  if (!state.home) return;
  renderOverhead();
  renderPasses();
  $('overhead-dialog').showModal();
}

$('overhead-btn').addEventListener('click', openOverhead);
$('overhead-close').addEventListener('click', () => $('overhead-dialog').close());

// ---------------------------------------------------------------- lingua
document.querySelectorAll('[data-lang]').forEach((b) => {
  b.classList.toggle('is-on', b.dataset.lang === LANG);
  b.addEventListener('click', () => { if (b.dataset.lang !== LANG) setLang(b.dataset.lang); });
});
