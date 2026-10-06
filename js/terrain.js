// Rilievo 3D gratuito: Terrain Tiles di Mapzen ospitate su AWS Open Data.
// Nessuna chiave, nessun account. Le piastrelle sono PNG in codifica "Terrarium":
//   quota (m) = R * 256 + G + B / 256 - 32768
// Cesium usa una griglia geografica, quindi per ogni punto della griglia
// calcoliamo in quale piastrella Web Mercator cade e leggiamo la quota da lì.

const C = window.Cesium;
const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const MAX_Z = 13;        // ~15 m per pixel all'equatore, più che sufficiente dal finestrino
const GRID = 65;         // punti per lato di ogni piastrella Cesium
const CACHE_MAX = 160;   // piastrelle decodificate tenute in memoria

const cache = new Map(); // "z/x/y" -> Promise<Float32Array | null>

function getCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(256, 256);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  return c;
}

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key); cache.set(key, hit); // aggiorna l'ordine LRU
    return hit;
  }
  const p = (async () => {
    const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const ctx = getCanvas().getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const px = ctx.getImageData(0, 0, 256, 256).data;
    const h = new Float32Array(256 * 256);
    for (let i = 0; i < h.length; i++) {
      const j = i * 4;
      h[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
    }
    return h;
  })().catch(() => null);

  cache.set(key, p);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

/** Coordinate pixel globali Web Mercator per lat/lon a uno zoom dato. */
function mercator(lat, lon, z) {
  const n = 2 ** z * 256;
  const la = Math.max(-85.0511, Math.min(85.0511, lat));
  const s = Math.sin((la * Math.PI) / 180);
  let gx = ((lon + 180) / 360) * n;
  gx = ((gx % n) + n) % n;
  const gy = Math.min(n - 1e-6, Math.max(0, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n));
  const tx = Math.floor(gx / 256);
  const ty = Math.floor(gy / 256);
  return { tx, ty, px: gx - tx * 256 - 0.5, py: gy - ty * 256 - 0.5 };
}

function bilinear(h, px, py) {
  const x0 = Math.max(0, Math.min(255, Math.floor(px)));
  const y0 = Math.max(0, Math.min(255, Math.floor(py)));
  const x1 = Math.min(255, x0 + 1);
  const y1 = Math.min(255, y0 + 1);
  const fx = Math.max(0, Math.min(1, px - x0));
  const fy = Math.max(0, Math.min(1, py - y0));
  const a = h[y0 * 256 + x0], b = h[y0 * 256 + x1];
  const c = h[y1 * 256 + x0], d = h[y1 * 256 + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Quota del terreno in metri per un punto (0 sul mare). */
export async function sampleHeight(lat, lon, z = 12) {
  const m = mercator(lat, lon, z);
  const tile = await loadTile(z, m.tx, m.ty);
  return tile ? Math.max(0, bilinear(tile, m.px, m.py)) : 0;
}

/** Provider di rilievo per Cesium, completamente gratuito. */
export function createTerrainProvider() {
  const tilingScheme = new C.GeographicTilingScheme();
  return new C.CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme,
    credit: 'Rilievo: Terrain Tiles (Mapzen, AWS Open Data)',
    callback: async (x, y, level) => {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = C.Math.toDegrees(rect.west);
      const east = C.Math.toDegrees(rect.east);
      const north = C.Math.toDegrees(rect.north);
      const south = C.Math.toDegrees(rect.south);
      const z = Math.min(Math.max(level, 0), MAX_Z);

      // Prima passata: quali piastrelle servono
      const samples = new Array(GRID * GRID);
      const needed = new Map();
      for (let r = 0; r < GRID; r++) {
        const lat = north - (r / (GRID - 1)) * (north - south);
        for (let c = 0; c < GRID; c++) {
          const lon = west + (c / (GRID - 1)) * (east - west);
          const m = mercator(lat, lon, z);
          const key = `${m.tx}/${m.ty}`;
          if (!needed.has(key)) needed.set(key, loadTile(z, m.tx, m.ty));
          samples[r * GRID + c] = { key, px: m.px, py: m.py };
        }
      }
      const keys = [...needed.keys()];
      const tiles = await Promise.all(keys.map((k) => needed.get(k)));
      const byKey = new Map(keys.map((k, i) => [k, tiles[i]]));

      // Seconda passata: quote. Il mare resta a 0 m.
      const out = new Float32Array(GRID * GRID);
      for (let i = 0; i < out.length; i++) {
        const s = samples[i];
        const t = byKey.get(s.key);
        out[i] = t ? Math.max(0, bilinear(t, s.px, s.py)) : 0;
      }
      return out;
    },
  });
}
