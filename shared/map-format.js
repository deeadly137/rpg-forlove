import { TILE_SIZE } from "./assets.js";

const MIN_SIZE = 8;
const MAX_SIZE = 300;
const MAX_ROOM_NAME_LENGTH = 64;
const DEFAULT_ROOM_NAME = "sala";
const INTERACT_ACTION_MAX_LENGTH = 64;
export const VOID_TILE_ID = 311;
export const VOID_STANDARD_TILE_ID = 0;
export const VOID_COPY_TILE_ID = -1;
export const EMPTY_LAYER_TILE_ID = -2;
export const DEFAULT_VOID_TILE_SELECTION_ID = VOID_COPY_TILE_ID;
export const LAYER_BOTTOM = "bottom";
export const LAYER_MIDDLE = "middle";
export const LAYER_TOP = "top";
export const LAYER_NAMES = [LAYER_BOTTOM, LAYER_MIDDLE, LAYER_TOP];
export const INTERACT_EVENT_TILE_ID = -10;
export const DOOR_EVENT_TILE_ID = -11;
export const INTERACT_ACTION_TEXTBOX_TBA = "textbox_tba";
export const INTERACT_ACTION_INVENTORY_TBA = "inventory_tba";
export const INTERACT_ACTION_OPTIONS = [
  INTERACT_ACTION_TEXTBOX_TBA,
  INTERACT_ACTION_INVENTORY_TBA
];

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

export function sanitizeRoomName(value, fallback = DEFAULT_ROOM_NAME) {
  const raw = String(value ?? "").trim();
  if (raw) {
    return raw.slice(0, MAX_ROOM_NAME_LENGTH);
  }
  const fallbackRaw = String(fallback ?? "").trim();
  if (fallbackRaw) {
    return fallbackRaw.slice(0, MAX_ROOM_NAME_LENGTH);
  }
  return DEFAULT_ROOM_NAME;
}

export function sanitizeInteractAction(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().slice(0, INTERACT_ACTION_MAX_LENGTH);
  if (!normalized) {
    return null;
  }
  return INTERACT_ACTION_OPTIONS.includes(normalized) ? normalized : null;
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

function normalizeInteractSource(raw, total) {
  const source = Array.isArray(raw) ? raw : [];
  const normalized = new Array(total).fill(0);
  for (let i = 0; i < total; i += 1) {
    normalized[i] = source[i] ? 1 : 0;
  }
  return normalized;
}

function normalizeDoorTarget(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_ROOM_NAME_LENGTH);
}

function normalizeDoorSource(raw, total) {
  const source = Array.isArray(raw) ? raw : [];
  const normalized = new Array(total).fill(null);
  for (let i = 0; i < total; i += 1) {
    normalized[i] = normalizeDoorTarget(source[i]);
  }
  return normalized;
}

function normalizeInteractActionSource(raw, interact, total) {
  const source = Array.isArray(raw) ? raw : [];
  const normalized = new Array(total).fill(null);
  for (let i = 0; i < total; i += 1) {
    if (interact[i] !== 1) {
      normalized[i] = null;
      continue;
    }
    normalized[i] = sanitizeInteractAction(source[i]);
  }
  return normalized;
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
  const roomName = sanitizeRoomName(options.roomName, DEFAULT_ROOM_NAME);
  const layers = createLayerArrays(safeWidth, safeHeight, defaultTile);
  const total = safeWidth * safeHeight;

  return {
    version: 4,
    tileSize: TILE_SIZE,
    width: safeWidth,
    height: safeHeight,
    roomName,
    voidTileId,
    layers,
    tiles: layers.bottom,
    collision: new Array(total).fill(defaultCollision),
    interact: new Array(total).fill(0),
    interactActions: new Array(total).fill(null),
    doors: new Array(total).fill(null),
    spawn: { x: 1, y: 1 }
  };
}

export function createEmptyMap(width = 40, height = 26) {
  return createMap(width, height, {
    defaultTile: VOID_COPY_TILE_ID,
    voidTileId: VOID_COPY_TILE_ID,
    roomName: DEFAULT_ROOM_NAME,
    defaultCollision: 0
  });
}

export function cloneMap(map) {
  const total = map.width * map.height;
  const normalizedLayers = normalizeLayers(map.layers || map.tiles, map.width, map.height, VOID_STANDARD_TILE_ID);
  const interact = normalizeInteractSource(map.interact, total);
  const interactActions = normalizeInteractActionSource(map.interactActions, interact, total);
  const doors = normalizeDoorSource(map.doors, total);
  if (!Array.isArray(normalizedLayers.bottom) || normalizedLayers.bottom.length !== total) {
    normalizedLayers.bottom = new Array(total).fill(VOID_STANDARD_TILE_ID);
  }

  return {
    version: 4,
    tileSize: TILE_SIZE,
    width: map.width,
    height: map.height,
    roomName: sanitizeRoomName(map.roomName, DEFAULT_ROOM_NAME),
    voidTileId: sanitizeConfiguredVoidTileId(map.voidTileId),
    layers: {
      bottom: [...normalizedLayers.bottom],
      middle: [...normalizedLayers.middle],
      top: [...normalizedLayers.top]
    },
    tiles: [...normalizedLayers.bottom],
    collision: [...map.collision],
    interact,
    interactActions,
    doors,
    spawn: { ...map.spawn }
  };
}

export function serializeMap(map) {
  const width = clamp(toInt(map.width, 40), MIN_SIZE, MAX_SIZE);
  const height = clamp(toInt(map.height, 26), MIN_SIZE, MAX_SIZE);
  const total = width * height;
  const layers = normalizeLayers(map.layers || map.tiles, width, height, VOID_STANDARD_TILE_ID);
  const interact = normalizeInteractSource(map.interact, total);
  const interactActions = normalizeInteractActionSource(map.interactActions, interact, total);
  const doors = normalizeDoorSource(map.doors, total);

  return {
    version: 4,
    tileSize: TILE_SIZE,
    width,
    height,
    roomName: sanitizeRoomName(map.roomName, DEFAULT_ROOM_NAME),
    voidTileId: sanitizeConfiguredVoidTileId(map.voidTileId),
    layers: {
      bottom: [...layers.bottom],
      middle: [...layers.middle],
      top: [...layers.top]
    },
    // Keep `tiles` for compatibility with older consumers.
    tiles: [...layers.bottom],
    collision: [...map.collision],
    interact,
    interactActions,
    doors,
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
  const defaultRoomName = sanitizeRoomName(options.roomName, DEFAULT_ROOM_NAME);
  const voidTileId = sanitizeConfiguredVoidTileId(raw.voidTileId);
  const roomName = sanitizeRoomName(raw.roomName, defaultRoomName);
  const defaultCollision = options.defaultCollision ? 1 : 0;

  const layers = normalizeLayers(raw.layers || raw.tiles, width, height, defaultTile);
  const srcCollision = Array.isArray(raw.collision) ? raw.collision : [];
  const collision = new Array(total).fill(defaultCollision);
  const interact = normalizeInteractSource(raw.interact, total);
  const interactActions = normalizeInteractActionSource(raw.interactActions, interact, total);
  const doors = normalizeDoorSource(raw.doors, total);

  for (let i = 0; i < total; i += 1) {
    collision[i] = srcCollision[i] ? 1 : 0;
  }

  const rawSpawn = raw.spawn || {};
  const spawn = {
    x: clamp(toInt(rawSpawn.x, 1), 0, width - 1),
    y: clamp(toInt(rawSpawn.y, 1), 0, height - 1)
  };

  return {
    version: 4,
    tileSize: TILE_SIZE,
    width,
    height,
    roomName,
    voidTileId,
    layers,
    tiles: layers.bottom,
    collision,
    interact,
    interactActions,
    doors,
    spawn
  };
}
