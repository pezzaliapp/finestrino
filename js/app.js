// Finestrino: il cielo sopra di te, dal finestrino di ciò che ci passa adesso.
// Tutto gratuito: nessuna chiave API, nessun abbonamento, nessun server.

import { createTerrainProvider, sampleHeight } from './terrain.js';
import { fetchAircraft, aircraftPosition } from './aircraft.js';
import { loadSatellites, satellitePosition } from './satellites.js';
import { fetchWeather, describeWeather, searchPlaces } from './weather.js';
import { bearing, destination, distanceM, clamp, fmt0, fmt1, compass } from './geo.js';
import { startCabin, stopCabin } from './audio.js';
import { fetchShips, shipPosition, shipTypeName, NAV_STATUS } from './ships.js';
import { startAutoUpdate } from './update.js';

const C = window.Cesium;
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
    credit: new C.Credit('Luci notturne: NASA Black Marble (GIBS)', false),
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

camera.setView({ destination: C.Cartesian3.fromDegrees(12, 28, 19000000) });
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
      endRide('Il volo è uscito dalla zona coperta dai ricevitori, oppure è atterrato. Sei di nuovo a terra.');
    }
    if (!ridden && h.missed >= 3) {
      if (state.selected === `plane:${hex}`) closeCard();
      viewer.entities.remove(h.entity);
      state.planes.delete(hex);
    }
  }
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

function mergeShips(list, save = true) {
  for (const d of list) {
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
  if (e) openCard(e.id);
  else if (state.selected) closeCard();
}, C.ScreenSpaceEventType.LEFT_CLICK);

function openCard(id) {
  state.selected = id;
  $('card').hidden = false;
  renderCard();
}

function closeCard() {
  state.selected = null;
  $('card').hidden = true;
}

function row(dt, dd) {
  return `<dt>${dt}</dt><dd>${dd}</dd>`;
}

function renderCard() {
  const id = state.selected;
  if (!id) return;
  const [kind, key] = id.split(':');
  const h = state.home;
  let title = '', sub = '', rows = '';

  if (kind === 'plane') {
    const p = state.planes.get(key);
    if (!p) return closeCard();
    const d = p.data;
    const pos = aircraftPosition(d, Date.now());
    title = planeLabel(d);
    sub = [d.desc || d.type, d.operator].filter(Boolean).join(', ') || 'Aereo in volo';
    rows += row('Quota', `${fmt0(pos.alt)} m`);
    if (d.gsKt !== null) rows += row('Velocità', `${fmt0(d.gsKt * 1.852)} km/h`);
    if (d.track !== null) rows += row('Direzione', `verso ${compass(d.track)}`);
    rows += row('Distanza da te', `${fmt1(distanceM(h.lat, h.lon, pos.lat, pos.lon) / 1000)} km`);
    if (d.reg) rows += row('Registrazione', d.reg);
  } else if (kind === 'ship') {
    const sh = state.ships.get(Number(key));
    if (!sh) return closeCard();
    const d = sh.data;
    const pos = shipPosition(d, Date.now());
    title = shipLabel(d);
    sub = shipTypeName(d.type) + (NAV_STATUS[d.status] ? `, ${NAV_STATUS[d.status]}` : '');
    rows += d.sog > 0.3
      ? row('Velocità', `${fmt1(d.sog)} nodi (${fmt0(d.sog * 1.852)} km/h)`)
      : row('Velocità', 'ferma');
    if (d.sog > 0.3 && d.cog != null) rows += row('Direzione', `verso ${compass(d.cog)}`);
    if (d.destination) rows += row('Destinazione', escapeHtml(d.destination));
    if (d.length) rows += row('Lunghezza', `${fmt0(d.length)} m`);
    rows += row('Distanza da te', `${fmt1(distanceM(h.lat, h.lon, pos.lat, pos.lon) / 1000)} km`);
  } else {
    const s = state.sats.get(key);
    if (!s || !s.pos) return closeCard();
    title = s.name;
    sub = /stazione/i.test(s.name) ? 'Stazione spaziale con equipaggio' : 'Satellite in orbita';
    rows += row('Quota', `${fmt0(s.pos.alt / 1000)} km`);
    if (s.pos.speedKms) rows += row('Velocità', `${fmt0(s.pos.speedKms * 3600)} km/h`);
    rows += row('Distanza da te', `${fmt0(distanceM(h.lat, h.lon, s.pos.lat, s.pos.lon) / 1000)} km in linea d'aria al suolo`);
  }

  $('board').hidden = kind === 'ship'; // sulle navi non si sale (per ora)
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
  btn.textContent = state.sound ? 'Suono' : 'Muto';
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
      el.textContent = `A bordo di ${planeLabel(d)}, ${fmt0(pose.alt)} m${speed}, verso ${compass(pose.heading)}`;
    } else if (pose) {
      el.textContent = `A bordo di ${state.sats.get(r.id).name}, ${fmt0(pose.alt / 1000)} km di quota`;
    }
    return;
  }

  if (state.planeError && !state.planeFetchedAt) {
    el.textContent = state.planeNeedsProxy
      ? 'Aerei non disponibili: il browser blocca le fonti dirette. Configura il Worker gratuito in js/config.js (vedi README).'
      : 'Il Worker degli aerei non risponde. Riprovo tra pochi secondi.';
    return;
  }
  const n = state.planes.size;
  const age = state.planeFetchedAt ? Math.round((Date.now() - state.planeFetchedAt) / 1000) : null;
  let text = `${n === 1 ? '1 aereo' : `${n} aerei`} e ${state.sats.size} satelliti tracciati`;
  if (age !== null) text += `. Dati ${state.planeSource}, aggiornati ${age} s fa`;
  if (state.satError) text += '. Satelliti non disponibili ora';

  // Riga delle navi: sempre presente, così si capisce cosa sta succedendo
  const ns = state.ships.size;
  let ships;
  if (ns) ships = ns === 1 ? '1 nave sul mare' : `${ns} navi sul mare`;
  else if (state.shipError) ships = 'Navi non disponibili ora, riprovo tra 30 secondi';
  else if (!state.shipFetchedAt) ships = 'Navi in arrivo…';
  else ships = 'Nessuna nave ricevuta finora: in questa zona i ricevitori AIS sono pochi, continuo ad ascoltare';
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
}, 1000);

// ---------------------------------------------------------------- luogo
function saveHome(h) {
  try { localStorage.setItem(HOME_KEY, JSON.stringify({ lat: h.lat, lon: h.lon, name: h.name })); } catch { /* */ }
}

function readHome() {
  try { return JSON.parse(localStorage.getItem(HOME_KEY) || 'null'); } catch { return null; }
}

let started = false;

async function setHome(lat, lon, name) {
  $('intro-msg').textContent = 'Preparo il cielo sopra di te…';
  const ground = await sampleHeight(lat, lon).catch(() => 0);
  state.home = { lat, lon, name, ground };
  saveHome(state.home);
  $('place').textContent = name;

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
    complete: () => setMode('sky'),
    cancel: () => setMode('sky'),
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
    msg.textContent = 'Questo browser non condivide la posizione. Cerca un luogo per nome.';
    return openPlaceDialog();
  }
  msg.textContent = 'Chiedo la posizione al browser…';
  navigator.geolocation.getCurrentPosition(
    (p) => setHome(p.coords.latitude, p.coords.longitude, 'La tua posizione'),
    () => {
      msg.textContent = 'Posizione non disponibile. Cerca un luogo per nome.';
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
  list.innerHTML = '<li><p>Cerco…</p></li>';
  try {
    const results = await searchPlaces(q);
    if (!results.length) {
      list.innerHTML = '<li><p>Nessun luogo con questo nome. Prova con la città più vicina.</p></li>';
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
    list.innerHTML = '<li><p>La ricerca non risponde. Controlla la connessione e riprova.</p></li>';
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
  b.textContent = saved.name === 'La tua posizione' ? 'Torna dove eri' : `Torna a ${saved.name}`;
  b.addEventListener('click', () => setHome(saved.lat, saved.lon, saved.name));
}

// ---------------------------------------------------------------- aggiornamento automatico
startAutoUpdate(() => state.mode !== 'ride' && state.mode !== 'arriving', toast).then((v) => {
  if (v) $('app-version').textContent = `Versione ${v}.`;
});
