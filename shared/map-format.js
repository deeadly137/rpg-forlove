import { TILE_SIZE } from "./assets.js";

const MIN_SIZE = 8;
const MAX_SIZE = 300;
export const VOID_TILE_ID = 311;
export const INDOOR_VOID_TILE_ID = -1;

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

export function createMap(width = 40, height = 26, options = {}) {
  const safeWidth = clamp(toInt(width, 40), MIN_SIZE, MAX_SIZE);
  const safeHeight = clamp(toInt(height, 26), MIN_SIZE, MAX_SIZE);
  const defaultTile = Number.isInteger(options.defaultTile) ? options.defaultTile : VOID_TILE_ID;
  const defaultCollision = options.defaultCollision ? 1 : 0;

  return {
    version: 1,
    tileSize: TILE_SIZE,
    width: safeWidth,
    height: safeHeight,
    tiles: new Array(safeWidth * safeHeight).fill(defaultTile),
    collision: new Array(safeWidth * safeHeight).fill(defaultCollision),
    spawn: { x: 1, y: 1 }
  };
}

export function createEmptyMap(width = 40, height = 26) {
  return createMap(width, height, { defaultTile: VOID_TILE_ID, defaultCollision: 0 });
}

export function cloneMap(map) {
  return {
    version: 1,
    tileSize: TILE_SIZE,
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
    collision: [...map.collision],
    spawn: { ...map.spawn }
  };
}

export function serializeMap(map) {
  return {
    version: 1,
    tileSize: TILE_SIZE,
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
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
  const defaultTile = Number.isInteger(options.defaultTile) ? options.defaultTile : VOID_TILE_ID;
  const defaultCollision = options.defaultCollision ? 1 : 0;

  const srcTiles = Array.isArray(raw.tiles) ? raw.tiles : [];
  const srcCollision = Array.isArray(raw.collision) ? raw.collision : [];
  const tiles = new Array(total).fill(defaultTile);
  const collision = new Array(total).fill(defaultCollision);

  for (let i = 0; i < total; i += 1) {
    const tile = Number(srcTiles[i]);
    const normalizedTile = Number.isFinite(tile) ? Math.floor(tile) : defaultTile;
    const isIndoorVoid = normalizedTile === INDOOR_VOID_TILE_ID;
    tiles[i] = normalizedTile >= 0 || isIndoorVoid ? normalizedTile : defaultTile;
    collision[i] = srcCollision[i] ? 1 : 0;
  }

  const rawSpawn = raw.spawn || {};
  const spawn = {
    x: clamp(toInt(rawSpawn.x, 1), 0, width - 1),
    y: clamp(toInt(rawSpawn.y, 1), 0, height - 1)
  };

  return {
    version: 1,
    tileSize: TILE_SIZE,
    width,
    height,
    tiles,
    collision,
    spawn
  };
}
