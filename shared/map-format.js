import { TILE_SIZE } from "./assets.js";

const MIN_SIZE = 8;
const MAX_SIZE = 300;
export const VOID_TILE_ID = 311;
export const VOID_STANDARD_TILE_ID = 0;
export const VOID_COPY_TILE_ID = -1;
export const EMPTY_LAYER_TILE_ID = -2;
export const DEFAULT_VOID_TILE_SELECTION_ID = VOID_COPY_TILE_ID;
export const LAYER_BOTTOM = "bottom";
export const LAYER_MIDDLE = "middle";
export const LAYER_TOP = "top";
export const LAYER_NAMES = [LAYER_BOTTOM, LAYER_MIDDLE, LAYER_TOP];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function toIndex(x, y, width) {
  return y * width + x;
}

function sanitizeConfiguredVoidTileId(value) {
  const parsed = toInt(value, DEFAULT_VOID_TILE_SELECTION_ID);
  if (parsed === VOID_STANDARD_TILE_ID || parsed === VOID_COPY_TILE_ID) {
    return parsed;
  }
  if (parsed === EMPTY_LAYER_TILE_ID) {
    return DEFAULT_VOID_TILE_SELECTION_ID;
  }
  if (parsed > 0) {
    return parsed;
  }
  return DEFAULT_VOID_TILE_SELECTION_ID;
}

function normalizeLayerTileId(value, defaultTile) {
  const parsed = toInt(value, defaultTile);
  if (parsed >= 0) {
    return parsed;
  }
  if (parsed === VOID_COPY_TILE_ID || parsed === EMPTY_LAYER_TILE_ID) {
    return parsed;
  }
  return defaultTile;
}

function createLayerArrays(width, height, defaultTile) {
  const total = width * height;
  const bottom = new Array(total).fill(defaultTile);
  const middle = new Array(total).fill(EMPTY_LAYER_TILE_ID);
  const top = new Array(total).fill(EMPTY_LAYER_TILE_ID);
  return { bottom, middle, top };
}

function normalizeLayerSource(rawLayer, total, defaultTile) {
  const source = Array.isArray(rawLayer) ? rawLayer : [];
  const normalized = new Array(total).fill(defaultTile);
  for (let i = 0; i < total; i += 1) {
    normalized[i] = normalizeLayerTileId(source[i], defaultTile);
  }
  return normalized;
}

function normalizeLayers(raw, width, height, defaultTile) {
  const total = width * height;
  if (raw && typeof raw === "object") {
    return {
      bottom: normalizeLayerSource(raw.bottom, total, defaultTile),
      middle: normalizeLayerSource(raw.middle, total, EMPTY_LAYER_TILE_ID),
      top: normalizeLayerSource(raw.top, total, EMPTY_LAYER_TILE_ID)
    };
  }

  // Backward compatibility with old single-layer `tiles`.
  const bottom = normalizeLayerSource(raw, total, defaultTile);
  const middle = new Array(total).fill(EMPTY_LAYER_TILE_ID);
  const top = new Array(total).fill(EMPTY_LAYER_TILE_ID);
  return { bottom, middle, top };
}

export function getMapLayer(map, layerName) {
  if (!map || !Array.isArray(map.layers?.[layerName])) {
    return null;
  }
  return map.layers[layerName];
}

export function createMap(width = 40, height = 26, options = {}) {
  const safeWidth = clamp(toInt(width, 40), MIN_SIZE, MAX_SIZE);
  const safeHeight = clamp(toInt(height, 26), MIN_SIZE, MAX_SIZE);
  const defaultTile = Number.isInteger(options.defaultTile) ? options.defaultTile : VOID_STANDARD_TILE_ID;
  const voidTileId = sanitizeConfiguredVoidTileId(options.voidTileId);
  const defaultCollision = options.defaultCollision ? 1 : 0;
  const layers = createLayerArrays(safeWidth, safeHeight, defaultTile);

  return {
    version: 2,
    tileSize: TILE_SIZE,
    width: safeWidth,
    height: safeHeight,
    voidTileId,
    layers,
    tiles: layers.bottom,
    collision: new Array(safeWidth * safeHeight).fill(defaultCollision),
    spawn: { x: 1, y: 1 }
  };
}

export function createEmptyMap(width = 40, height = 26) {
  return createMap(width, height, {
    defaultTile: VOID_COPY_TILE_ID,
    voidTileId: VOID_COPY_TILE_ID,
    defaultCollision: 0
  });
}

export function cloneMap(map) {
  const total = map.width * map.height;
  const normalizedLayers = normalizeLayers(map.layers || map.tiles, map.width, map.height, VOID_STANDARD_TILE_ID);
  if (!Array.isArray(normalizedLayers.bottom) || normalizedLayers.bottom.length !== total) {
    normalizedLayers.bottom = new Array(total).fill(VOID_STANDARD_TILE_ID);
  }

  return {
    version: 2,
    tileSize: TILE_SIZE,
    width: map.width,
    height: map.height,
    voidTileId: sanitizeConfiguredVoidTileId(map.voidTileId),
    layers: {
      bottom: [...normalizedLayers.bottom],
      middle: [...normalizedLayers.middle],
      top: [...normalizedLayers.top]
    },
    tiles: [...normalizedLayers.bottom],
    collision: [...map.collision],
    spawn: { ...map.spawn }
  };
}

export function serializeMap(map) {
  const width = clamp(toInt(map.width, 40), MIN_SIZE, MAX_SIZE);
  const height = clamp(toInt(map.height, 26), MIN_SIZE, MAX_SIZE);
  const layers = normalizeLayers(map.layers || map.tiles, width, height, VOID_STANDARD_TILE_ID);

  return {
    version: 2,
    tileSize: TILE_SIZE,
    width,
    height,
    voidTileId: sanitizeConfiguredVoidTileId(map.voidTileId),
    layers: {
      bottom: [...layers.bottom],
      middle: [...layers.middle],
      top: [...layers.top]
    },
    // Keep `tiles` for compatibility with older consumers.
    tiles: [...layers.bottom],
    collision: [...map.collision],
    spawn: { ...map.spawn }
  };
}

export function normalizeMap(raw, options = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const width = clamp(toInt(raw.width, 40), MIN_SIZE, MAX_SIZE);
  const height = clamp(toInt(raw.height, 26), MIN_SIZE, MAX_SIZE);
  const total = width * height;
  const defaultTile = Number.isInteger(options.defaultTile) ? options.defaultTile : VOID_STANDARD_TILE_ID;
  const voidTileId = sanitizeConfiguredVoidTileId(raw.voidTileId);
  const defaultCollision = options.defaultCollision ? 1 : 0;

  const layers = normalizeLayers(raw.layers || raw.tiles, width, height, defaultTile);
  const srcCollision = Array.isArray(raw.collision) ? raw.collision : [];
  const collision = new Array(total).fill(defaultCollision);

  for (let i = 0; i < total; i += 1) {
    collision[i] = srcCollision[i] ? 1 : 0;
  }

  const rawSpawn = raw.spawn || {};
  const spawn = {
    x: clamp(toInt(rawSpawn.x, 1), 0, width - 1),
    y: clamp(toInt(rawSpawn.y, 1), 0, height - 1)
  };

  return {
    version: 2,
    tileSize: TILE_SIZE,
    width,
    height,
    voidTileId,
    layers,
    tiles: layers.bottom,
    collision,
    spawn
  };
}
