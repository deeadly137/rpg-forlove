import { TILE_SIZE } from "./assets.js";
import {
  EMPTY_LAYER_TILE_ID,
  VOID_COPY_TILE_ID,
  VOID_STANDARD_TILE_ID,
  createEmptyMap,
  toIndex,
  VOID_TILE_ID
} from "./map-format.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class WorldRuntime {
  constructor(config) {
    this.canvas = config.canvas;
    this.ctx = config.ctx || this.canvas.getContext("2d");
    this.assets = config.assets;

    this.map = createEmptyMap(40, 26);
    this.camera = { x: 0, y: 0 };
    this.player = { x: 0, y: 0, speed: 132, vx: 0, vy: 0 };

    this.zoom = 1;
    this.followPlayer = true;
    this.movementEnabled = true;
    this.cameraLookahead = 26;
    this.cameraLerp = 0.18;

    this.showCollisionOverlay = false;
    this.showSpawnMarker = false;
    this.showGrid = false;

    this.resetPlayerToSpawn();
  }

  getViewportSize() {
    return {
      width: this.canvas.width / this.zoom,
      height: this.canvas.height / this.zoom
    };
  }

  setMap(nextMap, options = {}) {
    if (!nextMap) {
      this.map = createEmptyMap(40, 26);
    } else {
      this.map = nextMap;
    }

    if (options.sanitize !== false) {
      this.sanitizeMapTiles();
    }
    if (options.resetPlayer !== false) {
      this.resetPlayerToSpawn();
    }
    this.clampCamera();
  }

  getFallbackVoidTileId() {
    if (this.assets.getTileMeta(VOID_TILE_ID)) {
      return VOID_TILE_ID;
    }
    for (const tile of this.assets.tiles) {
      if (Number.isInteger(tile.id) && tile.id > 0) {
        return tile.id;
      }
    }
    return VOID_TILE_ID;
  }

  sanitizeConfiguredVoidTileId(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (parsed === VOID_STANDARD_TILE_ID || parsed === VOID_COPY_TILE_ID) {
      return parsed;
    }
    if (Number.isInteger(parsed) && parsed > 0 && this.assets.getTileMeta(parsed)) {
      return parsed;
    }
    return VOID_COPY_TILE_ID;
  }

  resolveConfiguredVoidTileId(configuredVoidTileId = this.map.voidTileId) {
    if (configuredVoidTileId === VOID_STANDARD_TILE_ID) {
      return null;
    }
    if (configuredVoidTileId === VOID_COPY_TILE_ID) {
      return this.getFallbackVoidTileId();
    }
    if (Number.isInteger(configuredVoidTileId) && configuredVoidTileId > 0 && this.assets.getTileMeta(configuredVoidTileId)) {
      return configuredVoidTileId;
    }
    return this.getFallbackVoidTileId();
  }

  normalizeLayerArray(source, total, defaultTile) {
    const normalized = new Array(total).fill(defaultTile);
    if (!Array.isArray(source)) {
      return normalized;
    }

    for (let i = 0; i < total; i += 1) {
      const parsed = Number.parseInt(String(source[i]), 10);
      if (!Number.isInteger(parsed)) {
        normalized[i] = defaultTile;
        continue;
      }
      if (parsed === VOID_STANDARD_TILE_ID || parsed === VOID_COPY_TILE_ID || parsed === EMPTY_LAYER_TILE_ID) {
        normalized[i] = parsed;
        continue;
      }
      if (parsed >= 0 && this.assets.getTileMeta(parsed)) {
        normalized[i] = parsed;
        continue;
      }
      normalized[i] = defaultTile;
    }
    return normalized;
  }

  getLayerArrays() {
    const total = this.map.width * this.map.height;
    const rawLayers = this.map.layers && typeof this.map.layers === "object" ? this.map.layers : {};
    const rawBottom = Array.isArray(rawLayers.bottom)
      ? rawLayers.bottom
      : (Array.isArray(this.map.tiles) ? this.map.tiles : []);
    const rawMiddle = Array.isArray(rawLayers.middle) ? rawLayers.middle : [];
    const rawTop = Array.isArray(rawLayers.top) ? rawLayers.top : [];

    const bottom = this.normalizeLayerArray(rawBottom, total, VOID_STANDARD_TILE_ID);
    const middle = this.normalizeLayerArray(rawMiddle, total, EMPTY_LAYER_TILE_ID);
    const top = this.normalizeLayerArray(rawTop, total, EMPTY_LAYER_TILE_ID);
    return { bottom, middle, top };
  }

  resolveRenderableTileId(rawTileId) {
    if (rawTileId === EMPTY_LAYER_TILE_ID || rawTileId === VOID_STANDARD_TILE_ID) {
      return null;
    }
    if (rawTileId === VOID_COPY_TILE_ID) {
      return this.resolveConfiguredVoidTileId(this.map.voidTileId);
    }
    if (Number.isInteger(rawTileId) && rawTileId >= 0 && this.assets.getTileMeta(rawTileId)) {
      return rawTileId;
    }
    return null;
  }

  sanitizeMapTiles() {
    const total = this.map.width * this.map.height;
    this.map.voidTileId = this.sanitizeConfiguredVoidTileId(this.map.voidTileId);

    const layers = this.getLayerArrays();
    this.map.layers = layers;
    this.map.tiles = layers.bottom;

    if (!Array.isArray(this.map.collision) || this.map.collision.length !== total) {
      this.map.collision = new Array(total).fill(0);
    } else {
      for (let i = 0; i < total; i += 1) {
        this.map.collision[i] = this.map.collision[i] ? 1 : 0;
      }
    }

    if (!this.map.spawn || typeof this.map.spawn !== "object") {
      this.map.spawn = { x: 1, y: 1 };
    }
  }

  setZoom(zoom) {
    this.zoom = clamp(Number(zoom) || 1, 0.5, 4);
    this.clampCamera();
  }

  setFollowPlayer(value, instant = false) {
    this.followPlayer = Boolean(value);
    if (instant) {
      this.updateCamera(true);
    } else {
      this.clampCamera();
    }
  }

  setMovementEnabled(value) {
    this.movementEnabled = Boolean(value);
    if (!this.movementEnabled) {
      this.player.vx = 0;
      this.player.vy = 0;
    }
  }

  setOverlay(config = {}) {
    if (typeof config.showCollisionOverlay === "boolean") {
      this.showCollisionOverlay = config.showCollisionOverlay;
    }
    if (typeof config.showSpawnMarker === "boolean") {
      this.showSpawnMarker = config.showSpawnMarker;
    }
    if (typeof config.showGrid === "boolean") {
      this.showGrid = config.showGrid;
    }
  }

  setCameraTuning(config = {}) {
    if (typeof config.lookahead === "number") {
      this.cameraLookahead = clamp(config.lookahead, 0, 200);
    }
    if (typeof config.lerp === "number") {
      this.cameraLerp = clamp(config.lerp, 0.01, 1);
    }
  }

  findSafeSpawnTile() {
    const width = this.map.width;
    const height = this.map.height;
    const rawSpawn = this.map.spawn || {};
    const spawnX = clamp(Number.parseInt(String(rawSpawn.x), 10) || 0, 0, width - 1);
    const spawnY = clamp(Number.parseInt(String(rawSpawn.y), 10) || 0, 0, height - 1);
    const spawnIndex = toIndex(spawnX, spawnY, width);
    if (this.map.collision[spawnIndex] === 0) {
      return { x: spawnX, y: spawnY };
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = toIndex(x, y, width);
        if (this.map.collision[index] === 0) {
          return { x, y };
        }
      }
    }
    return { x: 0, y: 0 };
  }

  resetPlayerToSpawn() {
    const spawn = this.findSafeSpawnTile();
    this.map.spawn = spawn;
    this.player.x = spawn.x * TILE_SIZE + TILE_SIZE / 2;
    this.player.y = (spawn.y + 1) * TILE_SIZE;
    this.player.vx = 0;
    this.player.vy = 0;
    this.updateCamera(true);
  }

  clampCamera() {
    const viewport = this.getViewportSize();
    const maxX = Math.max(0, this.map.width * TILE_SIZE - viewport.width);
    const maxY = Math.max(0, this.map.height * TILE_SIZE - viewport.height);
    this.camera.x = clamp(this.camera.x, 0, maxX);
    this.camera.y = clamp(this.camera.y, 0, maxY);
  }

  updateCamera(instant = false) {
    if (!this.followPlayer) {
      this.clampCamera();
      return;
    }

    const viewport = this.getViewportSize();
    const maxX = Math.max(0, this.map.width * TILE_SIZE - viewport.width);
    const maxY = Math.max(0, this.map.height * TILE_SIZE - viewport.height);

    const targetX = clamp(
      this.player.x - viewport.width / 2 + this.player.vx * this.cameraLookahead,
      0,
      maxX
    );
    const targetY = clamp(
      this.player.y - viewport.height / 2 + this.player.vy * this.cameraLookahead,
      0,
      maxY
    );

    if (instant) {
      this.camera.x = targetX;
      this.camera.y = targetY;
      return;
    }

    this.camera.x += (targetX - this.camera.x) * this.cameraLerp;
    this.camera.y += (targetY - this.camera.y) * this.cameraLerp;
    this.camera.x = clamp(this.camera.x, 0, maxX);
    this.camera.y = clamp(this.camera.y, 0, maxY);
  }

  isBlockedAtPixel(px, py) {
    const mapWidthPx = this.map.width * TILE_SIZE;
    const mapHeightPx = this.map.height * TILE_SIZE;

    const left = px - 6;
    const right = px + 6;
    const top = py - 18;
    const bottom = py - 2;

    if (left < 0 || right >= mapWidthPx || top < 0 || bottom >= mapHeightPx) {
      return true;
    }

    const fromTileX = Math.floor(left / TILE_SIZE);
    const toTileX = Math.floor((right - 0.001) / TILE_SIZE);
    const fromTileY = Math.floor(top / TILE_SIZE);
    const toTileY = Math.floor((bottom - 0.001) / TILE_SIZE);

    for (let y = fromTileY; y <= toTileY; y += 1) {
      for (let x = fromTileX; x <= toTileX; x += 1) {
        const index = toIndex(x, y, this.map.width);
        if (this.map.collision[index] === 1) {
          return true;
        }
      }
    }
    return false;
  }

  update(input, dt) {
    if (this.movementEnabled) {
      let moveX = 0;
      let moveY = 0;
      if (input.left) {
        moveX -= 1;
      }
      if (input.right) {
        moveX += 1;
      }
      if (input.up) {
        moveY -= 1;
      }
      if (input.down) {
        moveY += 1;
      }

      if (moveX !== 0 || moveY !== 0) {
        const length = Math.hypot(moveX, moveY) || 1;
        moveX /= length;
        moveY /= length;
        this.player.vx = moveX;
        this.player.vy = moveY;

        const distance = this.player.speed * dt;
        const nextX = this.player.x + moveX * distance;
        if (!this.isBlockedAtPixel(nextX, this.player.y)) {
          this.player.x = nextX;
        }

        const nextY = this.player.y + moveY * distance;
        if (!this.isBlockedAtPixel(this.player.x, nextY)) {
          this.player.y = nextY;
        }
      } else {
        this.player.vx = 0;
        this.player.vy = 0;
      }
    } else {
      this.player.vx = 0;
      this.player.vy = 0;
    }

    this.updateCamera(false);
  }

  panBy(screenDeltaX, screenDeltaY) {
    this.camera.x -= screenDeltaX / this.zoom;
    this.camera.y -= screenDeltaY / this.zoom;
    this.clampCamera();
  }

  screenToWorld(screenX, screenY) {
    return {
      x: screenX / this.zoom + this.camera.x,
      y: screenY / this.zoom + this.camera.y
    };
  }

  screenToTile(screenX, screenY) {
    const world = this.screenToWorld(screenX, screenY);
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    if (tileX < 0 || tileY < 0 || tileX >= this.map.width || tileY >= this.map.height) {
      return null;
    }
    return { x: tileX, y: tileY };
  }

  getPlayerTilePosition() {
    return {
      x: Math.floor(this.player.x / TILE_SIZE),
      y: Math.floor((this.player.y - 1) / TILE_SIZE)
    };
  }

  drawGridLines(viewportWidth, viewportHeight, cameraX = this.camera.x, cameraY = this.camera.y) {
    const startX = Math.floor(cameraX / TILE_SIZE) * TILE_SIZE;
    const startY = Math.floor(cameraY / TILE_SIZE) * TILE_SIZE;
    const endX = cameraX + viewportWidth + TILE_SIZE;
    const endY = cameraY + viewportHeight + TILE_SIZE;

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (let worldX = startX; worldX <= endX; worldX += TILE_SIZE) {
      const screenX = Math.floor(worldX - cameraX) + 0.5;
      this.ctx.moveTo(screenX, 0);
      this.ctx.lineTo(screenX, viewportHeight);
    }
    for (let worldY = startY; worldY <= endY; worldY += TILE_SIZE) {
      const screenY = Math.floor(worldY - cameraY) + 0.5;
      this.ctx.moveTo(0, screenY);
      this.ctx.lineTo(viewportWidth, screenY);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawLayerRange(layerTiles, fromX, toX, fromY, toY, snapX, snapY) {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const rawTileId = layerTiles[toIndex(x, y, this.map.width)];
        const tileId = this.resolveRenderableTileId(rawTileId);
        if (tileId === null) {
          continue;
        }
        this.assets.drawTile(
          this.ctx,
          tileId,
          Math.floor(x * TILE_SIZE - snapX),
          Math.floor(y * TILE_SIZE - snapY),
          TILE_SIZE
        );
      }
    }
  }

  render(options = {}) {
    const backgroundColor = options.backgroundColor || "#0f1810";
    const showPlayer = options.showPlayer !== false;
    const showPlayerShadow = options.showPlayerShadow !== false;
    const playerAlpha = typeof options.playerAlpha === "number" ? options.playerAlpha : 1;
    const showCollisionOverlay = typeof options.showCollisionOverlay === "boolean"
      ? options.showCollisionOverlay
      : this.showCollisionOverlay;
    const showSpawnMarker = typeof options.showSpawnMarker === "boolean"
      ? options.showSpawnMarker
      : this.showSpawnMarker;
    const showGrid = typeof options.showGrid === "boolean" ? options.showGrid : this.showGrid;

    const viewport = this.getViewportSize();
    const viewportWidth = viewport.width;
    const viewportHeight = viewport.height;
    const snapX = Math.round(this.camera.x * this.zoom) / this.zoom;
    const snapY = Math.round(this.camera.y * this.zoom) / this.zoom;

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();
    if (this.zoom !== 1) {
      this.ctx.scale(this.zoom, this.zoom);
    }

    const fromX = Math.max(0, Math.floor(snapX / TILE_SIZE) - 1);
    const toX = Math.min(this.map.width - 1, Math.ceil((snapX + viewportWidth) / TILE_SIZE) + 1);
    const fromY = Math.max(0, Math.floor(snapY / TILE_SIZE) - 1);
    const toY = Math.min(this.map.height - 1, Math.ceil((snapY + viewportHeight) / TILE_SIZE) + 1);
    const bottomLayer = this.map.layers?.bottom || this.map.tiles;
    const middleLayer = this.map.layers?.middle || [];
    const topLayer = this.map.layers?.top || [];

    this.drawLayerRange(bottomLayer, fromX, toX, fromY, toY, snapX, snapY);
    this.drawLayerRange(middleLayer, fromX, toX, fromY, toY, snapX, snapY);

    if (showPlayer && showPlayerShadow) {
      this.ctx.save();
      this.ctx.fillStyle = "rgba(0,0,0,0.2)";
      this.ctx.beginPath();
      this.ctx.ellipse(
        Math.floor(this.player.x - snapX),
        Math.floor(this.player.y - snapY - 1),
        8,
        4,
        0,
        0,
        Math.PI * 2
      );
      this.ctx.fill();
      this.ctx.restore();
    }

    if (showPlayer && this.assets.playerImage) {
      const srcWidth = this.assets.playerImage.naturalWidth || this.assets.playerImage.width || TILE_SIZE;
      const srcHeight = this.assets.playerImage.naturalHeight || this.assets.playerImage.height || TILE_SIZE;
      const drawWidth = TILE_SIZE;
      const scale = drawWidth / Math.max(1, srcWidth);
      const drawHeight = Math.max(1, Math.round(srcHeight * scale));
      const drawX = Math.floor(this.player.x - snapX - drawWidth / 2);
      const drawY = Math.floor(this.player.y - snapY - drawHeight);
      this.ctx.save();
      this.ctx.globalAlpha = clamp(playerAlpha, 0, 1);
      this.ctx.drawImage(this.assets.playerImage, drawX, drawY, drawWidth, drawHeight);
      this.ctx.restore();
    }

    this.drawLayerRange(topLayer, fromX, toX, fromY, toY, snapX, snapY);

    if (showCollisionOverlay) {
      this.ctx.fillStyle = "rgba(198, 40, 40, 0.3)";
      for (let y = fromY; y <= toY; y += 1) {
        for (let x = fromX; x <= toX; x += 1) {
          const index = toIndex(x, y, this.map.width);
          if (this.map.collision[index] === 1) {
            this.ctx.fillRect(
              Math.floor(x * TILE_SIZE - snapX),
              Math.floor(y * TILE_SIZE - snapY),
              TILE_SIZE,
              TILE_SIZE
            );
          }
        }
      }
    }

    if (showSpawnMarker) {
      const spawnScreenX = Math.floor(this.map.spawn.x * TILE_SIZE + TILE_SIZE / 2 - snapX);
      const spawnScreenY = Math.floor(this.map.spawn.y * TILE_SIZE + TILE_SIZE / 2 - snapY);
      this.ctx.save();
      this.ctx.strokeStyle = "#ffeb3b";
      this.ctx.fillStyle = "rgba(255, 235, 59, 0.35)";
      this.ctx.beginPath();
      this.ctx.arc(spawnScreenX, spawnScreenY, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    }

    if (showGrid) {
      this.drawGridLines(viewportWidth, viewportHeight, snapX, snapY);
    }

    this.ctx.restore();
  }
}
