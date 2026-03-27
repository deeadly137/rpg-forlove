import { AssetStore, TILE_SIZE, fileNameFromAssetPath } from "../shared/assets.js";
import { WorldRuntime } from "../shared/runtime.js";
import {
  EMPTY_LAYER_TILE_ID,
  LAYER_BOTTOM,
  LAYER_MIDDLE,
  LAYER_TOP,
  VOID_COPY_TILE_ID,
  VOID_STANDARD_TILE_ID,
  VOID_TILE_ID,
  createMap,
  getMapLayer,
  normalizeMap,
  serializeMap,
  toIndex
} from "../shared/map-format.js";

const PALETTE_CELL_SIZE = 40;
const PALETTE_COLUMNS = 8;
const EDITOR_DEFAULT_VOID_TILE_ID = VOID_COPY_TILE_ID;
const MIN_MAP_SIZE = 8;
const MAX_MAP_SIZE = 300;

const DIRECTION_KEYS = {
  a: "left",
  d: "right",
  w: "up",
  s: "down",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down"
};

const dom = {
  newFileBtn: document.getElementById("newFileBtn"),
  loadFileBtn: document.getElementById("loadFileBtn"),
  saveFileBtn: document.getElementById("saveFileBtn"),
  previewBtn: document.getElementById("previewBtn"),
  fileInput: document.getElementById("fileInput"),
  statusLine: document.getElementById("statusLine"),

  toolPaintBtn: document.getElementById("toolPaintBtn"),
  toolCollisionBtn: document.getElementById("toolCollisionBtn"),
  toolVoidBtn: document.getElementById("toolVoidBtn"),
  layerTopBtn: document.getElementById("layerTopBtn"),
  layerMiddleBtn: document.getElementById("layerMiddleBtn"),
  layerBottomBtn: document.getElementById("layerBottomBtn"),

  voidPickerBtn: document.getElementById("voidPickerBtn"),
  voidPickerLabel: document.getElementById("voidPickerLabel"),
  voidPreviewCanvas: document.getElementById("voidPreviewCanvas"),
  mapWidthInput: document.getElementById("mapWidthInput"),
  mapHeightInput: document.getElementById("mapHeightInput"),
  applyMapSizeBtn: document.getElementById("applyMapSizeBtn"),

  toggleSelectorBtn: document.getElementById("toggleSelectorBtn"),
  selectorPanel: document.getElementById("selectorPanel"),
  regionFilter: document.getElementById("regionFilter"),
  fileFilter: document.getElementById("fileFilter"),
  selectedTileLabel: document.getElementById("selectedTileLabel"),
  tilePaletteCanvas: document.getElementById("tilePaletteCanvas"),

  editorCanvas: document.getElementById("editorCanvas"),

  voidModal: document.getElementById("voidModal"),
  voidModalCloseBtn: document.getElementById("voidModalCloseBtn"),
  voidModalCanvas: document.getElementById("voidModalCanvas")
};

const paletteCtx = dom.tilePaletteCanvas.getContext("2d");
const voidPreviewCtx = dom.voidPreviewCanvas ? dom.voidPreviewCanvas.getContext("2d") : null;
const voidModalCtx = dom.voidModalCanvas ? dom.voidModalCanvas.getContext("2d") : null;

function createEditorDefaultMap(width = 40, height = 26) {
  return createMap(width, height, {
    defaultTile: VOID_COPY_TILE_ID,
    voidTileId: EDITOR_DEFAULT_VOID_TILE_ID,
    defaultCollision: 0
  });
}

const state = {
  assets: new AssetStore(),
  runtime: null,
  map: createEditorDefaultMap(40, 26),
  mapFileName: "novo-mapa.json",
  dirty: false,

  previewMode: false,
  selectorOpen: true,
  activeTool: "paint",
  activeLayer: LAYER_BOTTOM,

  selectedTileId: null,
  filteredTileIds: [],
  hoveredPaletteTileId: null,
  voidModal: {
    open: false,
    hoveredTileId: null,
    tileIds: []
  },

  keys: new Set(),
  pointer: {
    isPainting: false,
    isPanning: false,
    paintButton: 0,
    lastEditedIndex: -1,
    panLastX: 0,
    panLastY: 0
  },
  lastFrameTime: 0
};

function setStatus(message, type = "info") {
  dom.statusLine.textContent = message;
  dom.statusLine.dataset.type = type;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function getRequestedMapSize(fallbackWidth = 40, fallbackHeight = 26) {
  const width = clampInt(dom.mapWidthInput?.value, MIN_MAP_SIZE, MAX_MAP_SIZE, fallbackWidth);
  const height = clampInt(dom.mapHeightInput?.value, MIN_MAP_SIZE, MAX_MAP_SIZE, fallbackHeight);
  return { width, height };
}

function syncMapSizeInputs() {
  if (!state.map) {
    return;
  }
  if (dom.mapWidthInput) {
    dom.mapWidthInput.value = String(state.map.width);
  }
  if (dom.mapHeightInput) {
    dom.mapHeightInput.value = String(state.map.height);
  }
}

function resizeCurrentMap(nextWidth, nextHeight) {
  const width = clampInt(nextWidth, MIN_MAP_SIZE, MAX_MAP_SIZE, state.map.width);
  const height = clampInt(nextHeight, MIN_MAP_SIZE, MAX_MAP_SIZE, state.map.height);
  if (width === state.map.width && height === state.map.height) {
    syncMapSizeInputs();
    return false;
  }

  ensureMapLayers();
  const sourceMap = state.map;
  const configuredVoidTileId = getCurrentVoidTileId();
  const resizedMap = createMap(width, height, {
    defaultTile: configuredVoidTileId,
    voidTileId: configuredVoidTileId,
    defaultCollision: 0
  });

  const copyWidth = Math.min(sourceMap.width, width);
  const copyHeight = Math.min(sourceMap.height, height);
  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const sourceIndex = toIndex(x, y, sourceMap.width);
      const targetIndex = toIndex(x, y, width);
      resizedMap.layers.bottom[targetIndex] = sourceMap.layers.bottom[sourceIndex];
      resizedMap.layers.middle[targetIndex] = sourceMap.layers.middle[sourceIndex];
      resizedMap.layers.top[targetIndex] = sourceMap.layers.top[sourceIndex];
      resizedMap.collision[targetIndex] = sourceMap.collision[sourceIndex] ? 1 : 0;
    }
  }

  const rawSpawn = sourceMap.spawn || {};
  resizedMap.spawn.x = clampInt(rawSpawn.x, 0, width - 1, 1);
  resizedMap.spawn.y = clampInt(rawSpawn.y, 0, height - 1, 1);

  state.map = resizedMap;
  state.runtime.setMap(state.map, { sanitize: true, resetPlayer: true });
  state.map = state.runtime.map;
  ensureMapLayers();
  if (state.previewMode) {
    applyGamePreviewMode();
  } else {
    applyEditorMode();
  }
  state.pointer.lastEditedIndex = -1;
  state.dirty = true;
  syncMapSizeInputs();
  setStatus(`Mapa redimensionado para ${state.map.width}x${state.map.height}.`, "ok");
  return true;
}

function applyMapResizeFromUi() {
  const fallbackWidth = state.map?.width || 40;
  const fallbackHeight = state.map?.height || 26;
  const requested = getRequestedMapSize(fallbackWidth, fallbackHeight);
  if (!state.runtime) {
    state.map = createEditorDefaultMap(requested.width, requested.height);
    ensureMapLayers();
    syncMapSizeInputs();
    return;
  }
  resizeCurrentMap(requested.width, requested.height);
}

function isFormElement(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

function directionFromEvent(event) {
  const key = String(event.key || "").toLowerCase();
  return DIRECTION_KEYS[key] || null;
}

function getInputState() {
  return {
    left: state.keys.has("left"),
    right: state.keys.has("right"),
    up: state.keys.has("up"),
    down: state.keys.has("down")
  };
}

function getCurrentVoidTileId() {
  const raw = Number.parseInt(String(state.map?.voidTileId), 10);
  if (raw === VOID_STANDARD_TILE_ID || raw === VOID_COPY_TILE_ID) {
    return raw;
  }
  if (Number.isInteger(raw) && raw > 0 && state.assets.getTileMeta(raw)) {
    return raw;
  }
  return EDITOR_DEFAULT_VOID_TILE_ID;
}

function getResolvedVoidTileId(configuredVoidTileId = getCurrentVoidTileId()) {
  if (configuredVoidTileId === VOID_STANDARD_TILE_ID) {
    return null;
  }
  if (configuredVoidTileId === VOID_COPY_TILE_ID) {
    if (state.assets.getTileMeta(VOID_TILE_ID)) {
      return VOID_TILE_ID;
    }
    const fallback = state.assets.tiles.find((tile) => Number.isInteger(tile.id) && tile.id > 0);
    return fallback ? fallback.id : null;
  }
  if (Number.isInteger(configuredVoidTileId) && configuredVoidTileId > 0 && state.assets.getTileMeta(configuredVoidTileId)) {
    return configuredVoidTileId;
  }
  if (state.assets.getTileMeta(VOID_TILE_ID)) {
    return VOID_TILE_ID;
  }
  const fallback = state.assets.tiles.find((tile) => Number.isInteger(tile.id) && tile.id > 0);
  return fallback ? fallback.id : null;
}

function setActiveTool(toolName) {
  if (!["paint", "collision", "void"].includes(toolName)) {
    return;
  }
  state.activeTool = toolName;
  renderActiveToolButtons();
}

function renderActiveToolButtons() {
  const buttons = [dom.toolPaintBtn, dom.toolCollisionBtn, dom.toolVoidBtn];
  buttons.forEach((button) => {
    if (!button) {
      return;
    }
    button.classList.toggle("is-active", button.dataset.tool === state.activeTool);
  });
}

function ensureMapLayers() {
  if (!state.map || typeof state.map !== "object") {
    return;
  }
  const total = state.map.width * state.map.height;
  if (!state.map.layers || typeof state.map.layers !== "object") {
    state.map.layers = {};
  }

  const fallbackBottom = Array.isArray(state.map.tiles) ? state.map.tiles : [];
  const normalizeLayer = (source, fallback) => {
    const layer = new Array(total).fill(fallback);
    if (Array.isArray(source)) {
      for (let i = 0; i < total; i += 1) {
        const parsed = Number.parseInt(String(source[i]), 10);
        layer[i] = Number.isInteger(parsed) ? parsed : fallback;
      }
    }
    return layer;
  };

  const bottom = normalizeLayer(state.map.layers.bottom || fallbackBottom, VOID_STANDARD_TILE_ID);
  const middle = normalizeLayer(state.map.layers.middle, EMPTY_LAYER_TILE_ID);
  const top = normalizeLayer(state.map.layers.top, EMPTY_LAYER_TILE_ID);
  state.map.layers = { bottom, middle, top };
  state.map.tiles = bottom;
}

function setActiveLayer(layerName) {
  if (![LAYER_TOP, LAYER_MIDDLE, LAYER_BOTTOM].includes(layerName)) {
    return;
  }
  state.activeLayer = layerName;
  renderActiveLayerButtons();
}

function renderActiveLayerButtons() {
  const buttons = [dom.layerTopBtn, dom.layerMiddleBtn, dom.layerBottomBtn];
  buttons.forEach((button) => {
    if (!button) {
      return;
    }
    button.classList.toggle("is-active", button.dataset.layer === state.activeLayer);
  });
}

function getActiveLayerTiles() {
  ensureMapLayers();
  return getMapLayer(state.map, state.activeLayer) || state.map.tiles;
}

function resolveTileForPreview(tileId) {
  if (tileId === EMPTY_LAYER_TILE_ID || tileId === VOID_STANDARD_TILE_ID) {
    return null;
  }
  if (tileId === VOID_COPY_TILE_ID) {
    return getResolvedVoidTileId(getCurrentVoidTileId());
  }
  if (Number.isInteger(tileId) && tileId > 0 && state.assets.getTileMeta(tileId)) {
    return tileId;
  }
  return null;
}

function drawTileChip(ctx, tileId, size = TILE_SIZE, dx = 0, dy = 0) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(dx, dy, size, size);

  const drawTileId = resolveTileForPreview(tileId);
  if (drawTileId === null) {
    return;
  }
  state.assets.drawTile(ctx, drawTileId, dx, dy, size);

  if (tileId === VOID_STANDARD_TILE_ID || tileId === VOID_COPY_TILE_ID) {
    ctx.save();
    ctx.strokeStyle = tileId === VOID_STANDARD_TILE_ID ? "#67d9ff" : "#ffd670";
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, size - 1, size - 1);
    ctx.restore();
  }
}

function updateVoidPickerPreview() {
  const voidTileId = getCurrentVoidTileId();
  if (voidPreviewCtx && dom.voidPreviewCanvas) {
    drawTileChip(voidPreviewCtx, voidTileId, dom.voidPreviewCanvas.width);
  }
  if (dom.voidPickerLabel) {
    dom.voidPickerLabel.textContent = `Tile #${voidTileId}`;
  }
}

function refreshVoidModalTileIds() {
  const allTileIds = state.assets.getTileIds({ region: "all", file: "all" });
  state.voidModal.tileIds = [VOID_COPY_TILE_ID, VOID_STANDARD_TILE_ID];
  for (const tileId of allTileIds) {
    if (tileId <= 0) {
      continue;
    }
    if (!state.voidModal.tileIds.includes(tileId)) {
      state.voidModal.tileIds.push(tileId);
    }
  }
}

function drawVoidModalPalette() {
  if (!dom.voidModalCanvas || !voidModalCtx) {
    return;
  }

  const rows = Math.max(1, Math.ceil(state.voidModal.tileIds.length / PALETTE_COLUMNS));
  dom.voidModalCanvas.width = PALETTE_COLUMNS * PALETTE_CELL_SIZE;
  dom.voidModalCanvas.height = rows * PALETTE_CELL_SIZE;

  voidModalCtx.imageSmoothingEnabled = false;
  voidModalCtx.fillStyle = "#0d0d0d";
  voidModalCtx.fillRect(0, 0, dom.voidModalCanvas.width, dom.voidModalCanvas.height);

  const currentVoid = getCurrentVoidTileId();
  for (let index = 0; index < state.voidModal.tileIds.length; index += 1) {
    const tileId = state.voidModal.tileIds[index];
    const x = (index % PALETTE_COLUMNS) * PALETTE_CELL_SIZE;
    const y = Math.floor(index / PALETTE_COLUMNS) * PALETTE_CELL_SIZE;

    voidModalCtx.fillStyle = "#1a1a1a";
    voidModalCtx.fillRect(x + 1, y + 1, PALETTE_CELL_SIZE - 2, PALETTE_CELL_SIZE - 2);

    drawTileChip(voidModalCtx, tileId, TILE_SIZE, x + 4, y + 4);

    if (tileId === VOID_STANDARD_TILE_ID || tileId === VOID_COPY_TILE_ID) {
      voidModalCtx.save();
      voidModalCtx.fillStyle = "rgba(0,0,0,0.55)";
      voidModalCtx.fillRect(x + 4, y + 24, TILE_SIZE, 12);
      voidModalCtx.fillStyle = "#f5f5f5";
      voidModalCtx.font = "bold 10px monospace";
      voidModalCtx.fillText(tileId === VOID_STANDARD_TILE_ID ? "#0" : "#-1", x + 7, y + 33);
      voidModalCtx.restore();
    }

    if (tileId === currentVoid) {
      voidModalCtx.strokeStyle = "#7dff7d";
      voidModalCtx.lineWidth = 2;
      voidModalCtx.strokeRect(x + 1, y + 1, PALETTE_CELL_SIZE - 3, PALETTE_CELL_SIZE - 3);
    } else if (tileId === state.voidModal.hoveredTileId) {
      voidModalCtx.strokeStyle = "#ffe082";
      voidModalCtx.lineWidth = 2;
      voidModalCtx.strokeRect(x + 1, y + 1, PALETTE_CELL_SIZE - 3, PALETTE_CELL_SIZE - 3);
    }
  }
}

function openVoidModal() {
  if (!dom.voidModal) {
    return;
  }
  refreshVoidModalTileIds();
  state.voidModal.open = true;
  state.voidModal.hoveredTileId = null;
  dom.voidModal.classList.remove("is-hidden");
  dom.voidModal.setAttribute("aria-hidden", "false");
  drawVoidModalPalette();
}

function closeVoidModal() {
  if (!dom.voidModal) {
    return;
  }
  state.voidModal.open = false;
  state.voidModal.hoveredTileId = null;
  dom.voidModal.classList.add("is-hidden");
  dom.voidModal.setAttribute("aria-hidden", "true");
}

function getCanvasPixelPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  return {
    x: Math.floor((event.clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.floor((event.clientY - rect.top) * (canvas.height / rect.height))
  };
}

function downloadMapFile(fileName, map) {
  const json = JSON.stringify(serializeMap(map), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "mapa-rpg.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function applyGamePreviewMode() {
  state.runtime.setZoom(1.75);
  state.runtime.setMovementEnabled(true);
  state.runtime.setFollowPlayer(true, true);
  state.runtime.setCameraTuning({ lookahead: 0, lerp: 1 });
  state.runtime.setOverlay({
    showCollisionOverlay: false,
    showSpawnMarker: false,
    showGrid: false
  });
}

function applyEditorMode() {
  state.runtime.setZoom(1);
  state.runtime.setMovementEnabled(false);
  state.runtime.setFollowPlayer(false, false);
  state.runtime.setOverlay({
    showCollisionOverlay: true,
    showSpawnMarker: true,
    showGrid: true
  });
}

function setPreviewMode(enabled) {
  state.previewMode = Boolean(enabled);
  closeVoidModal();
  state.pointer.isPainting = false;
  state.pointer.isPanning = false;
  state.pointer.lastEditedIndex = -1;
  state.keys.clear();

  if (state.previewMode) {
    applyGamePreviewMode();
    state.runtime.resetPlayerToSpawn();
    dom.previewBtn.textContent = "Preview: ON";
    setStatus("Preview ON: simulacao do jogo sem alterar o arquivo.", "ok");
  } else {
    applyEditorMode();
    dom.previewBtn.textContent = "Preview: OFF";
    setStatus("Preview OFF: edicao ativa.", "info");
  }
}

function replaceMap(nextMap, fileName, statusMessage) {
  state.map = nextMap;
  if (!Number.isInteger(state.map.voidTileId) || state.map.voidTileId === EMPTY_LAYER_TILE_ID) {
    state.map.voidTileId = EDITOR_DEFAULT_VOID_TILE_ID;
  }
  ensureMapLayers();
  state.mapFileName = fileName || "mapa-rpg.json";
  state.dirty = false;
  state.runtime.setMap(state.map, { sanitize: true, resetPlayer: true });
  state.map = state.runtime.map;
  ensureMapLayers();
  if (state.previewMode) {
    applyGamePreviewMode();
  } else {
    applyEditorMode();
  }
  updateVoidPickerPreview();
  drawVoidModalPalette();
  syncMapSizeInputs();
  setStatus(statusMessage, "ok");
}

function createNewMap() {
  const requested = getRequestedMapSize(40, 26);
  const freshMap = createEditorDefaultMap(requested.width, requested.height);
  replaceMap(freshMap, "novo-mapa.json", "Novo mapa criado.");
}

async function loadMapFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const map = normalizeMap(parsed, { defaultTile: VOID_STANDARD_TILE_ID, defaultCollision: 0 });
  if (!map) {
    throw new Error("Mapa invalido.");
  }
  replaceMap(map, file.name, `Arquivo carregado: ${file.name}`);
}

function saveMapToFile() {
  const fileName = state.mapFileName || "mapa-rpg.json";
  downloadMapFile(fileName, state.map);
  state.dirty = false;
  setStatus(`Arquivo salvo: ${fileName}`, "ok");
}

function refreshFileFilterOptions() {
  const region = dom.regionFilter.value;
  const current = dom.fileFilter.value;
  const files = state.assets.getFileOptions(region);

  dom.fileFilter.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Todos";
  dom.fileFilter.append(allOption);

  files.forEach((fileName) => {
    const option = document.createElement("option");
    option.value = fileName;
    option.textContent = fileName;
    dom.fileFilter.append(option);
  });

  if (files.includes(current)) {
    dom.fileFilter.value = current;
  } else {
    dom.fileFilter.value = "all";
  }
}

function formatTileLabel(tileId) {
  if (tileId === VOID_STANDARD_TILE_ID) {
    return "Tile #0 | Transparente (padrao)";
  }
  if (tileId === VOID_COPY_TILE_ID) {
    return "Tile #-1 | Void padrao (inicial)";
  }
  if (tileId === EMPTY_LAYER_TILE_ID) {
    return "Tile #-2 | Transparente";
  }
  const meta = state.assets.getTileMeta(tileId);
  if (meta) {
    return `Tile #${tileId} | ${fileNameFromAssetPath(meta.src)}`;
  }
  return `Tile #${tileId}`;
}

function refreshFilteredTiles() {
  const assetTileIds = state.assets.getTileIds({
    region: dom.regionFilter.value,
    file: dom.fileFilter.value
  });

  state.filteredTileIds = [];
  state.filteredTileIds.push(VOID_STANDARD_TILE_ID);
  state.filteredTileIds.push(VOID_COPY_TILE_ID);
  for (const tileId of assetTileIds) {
    if (tileId === VOID_STANDARD_TILE_ID || tileId === VOID_COPY_TILE_ID || tileId === EMPTY_LAYER_TILE_ID) {
      continue;
    }
    if (!state.filteredTileIds.includes(tileId)) {
      state.filteredTileIds.push(tileId);
    }
  }

  if (state.filteredTileIds.length === 0) {
    state.selectedTileId = null;
  } else if (!state.filteredTileIds.includes(state.selectedTileId)) {
    state.selectedTileId = state.filteredTileIds[0];
  }

  drawTilePalette();
  updateSelectedTileLabel();
}

function updateSelectedTileLabel() {
  if (state.selectedTileId === null) {
    dom.selectedTileLabel.textContent = "Tile selecionado: nenhum";
    return;
  }
  dom.selectedTileLabel.textContent = formatTileLabel(state.selectedTileId);
}

function drawTilePalette() {
  const rows = Math.max(1, Math.ceil(state.filteredTileIds.length / PALETTE_COLUMNS));
  dom.tilePaletteCanvas.width = PALETTE_COLUMNS * PALETTE_CELL_SIZE;
  dom.tilePaletteCanvas.height = rows * PALETTE_CELL_SIZE;

  paletteCtx.imageSmoothingEnabled = false;
  paletteCtx.fillStyle = "#0d0d0d";
  paletteCtx.fillRect(0, 0, dom.tilePaletteCanvas.width, dom.tilePaletteCanvas.height);

  for (let index = 0; index < state.filteredTileIds.length; index += 1) {
    const tileId = state.filteredTileIds[index];
    const x = (index % PALETTE_COLUMNS) * PALETTE_CELL_SIZE;
    const y = Math.floor(index / PALETTE_COLUMNS) * PALETTE_CELL_SIZE;

    paletteCtx.fillStyle = "#1a1a1a";
    paletteCtx.fillRect(x + 1, y + 1, PALETTE_CELL_SIZE - 2, PALETTE_CELL_SIZE - 2);
    drawTileChip(paletteCtx, tileId, TILE_SIZE, x + 4, y + 4);

    if (tileId === VOID_STANDARD_TILE_ID || tileId === VOID_COPY_TILE_ID) {
      paletteCtx.save();
      paletteCtx.fillStyle = "rgba(0,0,0,0.5)";
      paletteCtx.fillRect(x + 4, y + 24, TILE_SIZE, 12);
      paletteCtx.fillStyle = "#f5f5f5";
      paletteCtx.font = "bold 10px monospace";
      paletteCtx.fillText(tileId === VOID_STANDARD_TILE_ID ? "#0" : "#-1", x + 7, y + 33);
      paletteCtx.restore();
    }

    if (tileId === state.selectedTileId) {
      paletteCtx.strokeStyle = "#7dff7d";
      paletteCtx.lineWidth = 2;
      paletteCtx.strokeRect(x + 1, y + 1, PALETTE_CELL_SIZE - 3, PALETTE_CELL_SIZE - 3);
    } else if (tileId === state.hoveredPaletteTileId) {
      paletteCtx.strokeStyle = "#ffe082";
      paletteCtx.lineWidth = 2;
      paletteCtx.strokeRect(x + 1, y + 1, PALETTE_CELL_SIZE - 3, PALETTE_CELL_SIZE - 3);
    }
  }
}

function tileIdFromGridEvent(event, canvas, tileIds) {
  const pixel = getCanvasPixelPosition(event, canvas);
  if (!pixel) {
    return null;
  }

  const col = Math.floor(pixel.x / PALETTE_CELL_SIZE);
  const row = Math.floor(pixel.y / PALETTE_CELL_SIZE);
  if (col < 0 || row < 0 || col >= PALETTE_COLUMNS) {
    return null;
  }

  const index = row * PALETTE_COLUMNS + col;
  const tileId = tileIds[index];
  return typeof tileId === "number" ? tileId : null;
}

function tileIdFromPaletteEvent(event) {
  return tileIdFromGridEvent(event, dom.tilePaletteCanvas, state.filteredTileIds);
}

function tileIdFromVoidModalEvent(event) {
  return tileIdFromGridEvent(event, dom.voidModalCanvas, state.voidModal.tileIds);
}

function cycleSelectedTile(delta) {
  if (state.filteredTileIds.length === 0) {
    return;
  }

  let index = state.filteredTileIds.indexOf(state.selectedTileId);
  if (index < 0) {
    index = 0;
  }

  index = (index + delta + state.filteredTileIds.length) % state.filteredTileIds.length;
  state.selectedTileId = state.filteredTileIds[index];
  updateSelectedTileLabel();
  drawTilePalette();
}

function toggleSelectorPanel() {
  state.selectorOpen = !state.selectorOpen;
  dom.selectorPanel.classList.toggle("is-hidden", !state.selectorOpen);
}

function applyPaintFromEvent(event) {
  const pixel = getCanvasPixelPosition(event, dom.editorCanvas);
  if (!pixel) {
    return;
  }
  const tile = state.runtime.screenToTile(pixel.x, pixel.y);
  if (!tile) {
    return;
  }

  const index = toIndex(tile.x, tile.y, state.map.width);
  if (index === state.pointer.lastEditedIndex) {
    return;
  }
  state.pointer.lastEditedIndex = index;

  let changed = false;
  if (event.ctrlKey) {
    const prevX = state.map.spawn.x;
    const prevY = state.map.spawn.y;
    state.map.spawn.x = tile.x;
    state.map.spawn.y = tile.y;
    changed = prevX !== tile.x || prevY !== tile.y;
  } else {
    const activeLayerTiles = getActiveLayerTiles();
    let tool = state.activeTool;
    if (event.shiftKey) {
      tool = "collision";
    }

    if (tool === "collision") {
      const nextCollision = state.pointer.paintButton === 2 ? 0 : 1;
      changed = state.map.collision[index] !== nextCollision;
      state.map.collision[index] = nextCollision;
    } else if (tool === "void") {
      const configuredVoidTileId = getCurrentVoidTileId();
      changed = activeLayerTiles[index] !== configuredVoidTileId || state.map.collision[index] !== 0;
      activeLayerTiles[index] = configuredVoidTileId;
      state.map.collision[index] = 0;
    } else if (state.selectedTileId !== null) {
      let paintTileId = state.selectedTileId;
      if (state.pointer.paintButton === 2 && state.activeLayer !== LAYER_BOTTOM) {
        paintTileId = EMPTY_LAYER_TILE_ID;
      }
      changed = activeLayerTiles[index] !== paintTileId;
      activeLayerTiles[index] = paintTileId;
    }
  }

  if (changed) {
    state.dirty = true;
  }
}

function getPreviewPositionText() {
  const pos = state.runtime.getPlayerTilePosition();
  return `Posicao jogador: x=${pos.x} y=${pos.y}`;
}

function drawCanvasHud() {
  const ctx = state.runtime.ctx;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.66)";
  ctx.fillRect(10, 10, 460, 78);
  ctx.fillStyle = "#efefef";
  ctx.font = "bold 13px monospace";
  ctx.fillText(state.previewMode ? "MODO PREVIEW" : "MODO EDICAO", 20, 31);
  if (state.previewMode) {
    ctx.fillText(getPreviewPositionText(), 20, 52);
    ctx.fillText(`Layer ativa: ${state.activeLayer}`, 20, 70);
  } else {
    const suffix = state.dirty ? " (nao salvo)" : "";
    ctx.fillText(`Arquivo: ${state.mapFileName}${suffix}`, 20, 52);
    ctx.fillText(`Layer ativa: ${state.activeLayer}`, 20, 70);
  }
  ctx.restore();
}

function render() {
  state.runtime.render({
    backgroundColor: "#0a0a0a",
    showCollisionOverlay: !state.previewMode,
    showSpawnMarker: !state.previewMode,
    showGrid: !state.previewMode,
    showPlayer: true,
    showPlayerShadow: state.previewMode,
    playerAlpha: state.previewMode ? 1 : 0.72
  });
  drawCanvasHud();
}

function tick(timestamp) {
  if (state.lastFrameTime === 0) {
    state.lastFrameTime = timestamp;
  }
  const dt = Math.min((timestamp - state.lastFrameTime) / 1000, 0.05);
  state.lastFrameTime = timestamp;

  if (state.previewMode) {
    state.runtime.update(getInputState(), dt);
  } else {
    state.runtime.update({ left: false, right: false, up: false, down: false }, dt);
  }
  render();
  requestAnimationFrame(tick);
}

function bindUi() {
  dom.newFileBtn.addEventListener("click", () => {
    createNewMap();
  });

  dom.loadFileBtn.addEventListener("click", () => {
    dom.fileInput.click();
  });

  dom.fileInput.addEventListener("change", async () => {
    const file = dom.fileInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      await loadMapFromFile(file);
    } catch (_error) {
      setStatus("Falha ao carregar arquivo de mapa.", "error");
    } finally {
      dom.fileInput.value = "";
    }
  });

  dom.saveFileBtn.addEventListener("click", () => {
    saveMapToFile();
  });

  dom.previewBtn.addEventListener("click", () => {
    setPreviewMode(!state.previewMode);
  });

  dom.applyMapSizeBtn?.addEventListener("click", () => {
    applyMapResizeFromUi();
  });
  dom.mapWidthInput?.addEventListener("change", () => {
    applyMapResizeFromUi();
  });
  dom.mapHeightInput?.addEventListener("change", () => {
    applyMapResizeFromUi();
  });
  [dom.mapWidthInput, dom.mapHeightInput].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyMapResizeFromUi();
      }
    });
  });

  dom.toolPaintBtn?.addEventListener("click", () => {
    setActiveTool("paint");
  });
  dom.toolCollisionBtn?.addEventListener("click", () => {
    setActiveTool("collision");
  });
  dom.toolVoidBtn?.addEventListener("click", () => {
    setActiveTool("void");
  });
  dom.layerTopBtn?.addEventListener("click", () => {
    setActiveLayer(LAYER_TOP);
  });
  dom.layerMiddleBtn?.addEventListener("click", () => {
    setActiveLayer(LAYER_MIDDLE);
  });
  dom.layerBottomBtn?.addEventListener("click", () => {
    setActiveLayer(LAYER_BOTTOM);
  });

  dom.voidPickerBtn?.addEventListener("click", () => {
    openVoidModal();
  });
  dom.voidModalCloseBtn?.addEventListener("click", () => {
    closeVoidModal();
  });
  dom.voidModal?.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target === dom.voidModal || target.dataset.close === "void-modal") {
      closeVoidModal();
    }
  });
  dom.voidModalCanvas?.addEventListener("mousemove", (event) => {
    const tileId = tileIdFromVoidModalEvent(event);
    state.voidModal.hoveredTileId = typeof tileId === "number" ? tileId : null;
    drawVoidModalPalette();
  });
  dom.voidModalCanvas?.addEventListener("mouseleave", () => {
    state.voidModal.hoveredTileId = null;
    drawVoidModalPalette();
  });
  dom.voidModalCanvas?.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const tileId = tileIdFromVoidModalEvent(event);
    if (typeof tileId !== "number") {
      return;
    }
    const previous = getCurrentVoidTileId();
    if (tileId !== previous) {
      state.map.voidTileId = tileId;
      state.dirty = true;
      updateVoidPickerPreview();
      drawTilePalette();
      updateSelectedTileLabel();
      setStatus(`Tile void definido para #${tileId}.`, "ok");
    }
    closeVoidModal();
  });

  dom.toggleSelectorBtn.addEventListener("click", () => {
    toggleSelectorPanel();
  });

  dom.regionFilter.addEventListener("change", () => {
    refreshFileFilterOptions();
    refreshFilteredTiles();
  });

  dom.fileFilter.addEventListener("change", () => {
    refreshFilteredTiles();
  });

  dom.tilePaletteCanvas.addEventListener("mousemove", (event) => {
    const tileId = tileIdFromPaletteEvent(event);
    state.hoveredPaletteTileId = typeof tileId === "number" ? tileId : null;
    drawTilePalette();
  });

  dom.tilePaletteCanvas.addEventListener("mouseleave", () => {
    state.hoveredPaletteTileId = null;
    drawTilePalette();
  });

  dom.tilePaletteCanvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const tileId = tileIdFromPaletteEvent(event);
    if (typeof tileId !== "number") {
      return;
    }
    state.selectedTileId = tileId;
    updateSelectedTileLabel();
    drawTilePalette();
  });

  dom.editorCanvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  dom.editorCanvas.addEventListener("mousedown", (event) => {
    if (state.previewMode) {
      return;
    }

    if (event.button === 1) {
      state.pointer.isPanning = true;
      state.pointer.panLastX = event.clientX;
      state.pointer.panLastY = event.clientY;
      return;
    }

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    state.pointer.isPainting = true;
    state.pointer.paintButton = event.button;
    state.pointer.lastEditedIndex = -1;
    applyPaintFromEvent(event);
  });

  dom.editorCanvas.addEventListener("mousemove", (event) => {
    if (state.previewMode) {
      return;
    }

    if (state.pointer.isPanning) {
      const deltaX = event.clientX - state.pointer.panLastX;
      const deltaY = event.clientY - state.pointer.panLastY;
      state.pointer.panLastX = event.clientX;
      state.pointer.panLastY = event.clientY;
      state.runtime.panBy(deltaX, deltaY);
      return;
    }

    if (state.pointer.isPainting) {
      applyPaintFromEvent(event);
    }
  });

  window.addEventListener("mouseup", () => {
    state.pointer.isPainting = false;
    state.pointer.isPanning = false;
    state.pointer.lastEditedIndex = -1;
  });

  window.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();

    if (key === "escape" && state.voidModal.open) {
      closeVoidModal();
      event.preventDefault();
      return;
    }

    if (key === "m") {
      toggleSelectorPanel();
      event.preventDefault();
      return;
    }

    if (key === "p") {
      setPreviewMode(!state.previewMode);
      event.preventDefault();
      return;
    }

    if (!state.previewMode && !isFormElement(event.target)) {
      if (key === "1") {
        setActiveTool("paint");
        event.preventDefault();
        return;
      }
      if (key === "2") {
        setActiveTool("collision");
        event.preventDefault();
        return;
      }
      if (key === "3") {
        setActiveTool("void");
        event.preventDefault();
        return;
      }
      if (key === "7") {
        setActiveLayer(LAYER_TOP);
        event.preventDefault();
        return;
      }
      if (key === "8") {
        setActiveLayer(LAYER_MIDDLE);
        event.preventDefault();
        return;
      }
      if (key === "9") {
        setActiveLayer(LAYER_BOTTOM);
        event.preventDefault();
        return;
      }
      if (key === "q") {
        cycleSelectedTile(-1);
        event.preventDefault();
        return;
      }
      if (key === "e") {
        cycleSelectedTile(1);
        event.preventDefault();
        return;
      }
    }

    if (!state.previewMode) {
      return;
    }

    const direction = directionFromEvent(event);
    if (direction) {
      state.keys.add(direction);
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (!state.previewMode) {
      return;
    }
    const direction = directionFromEvent(event);
    if (direction) {
      state.keys.delete(direction);
      event.preventDefault();
    }
  });

  window.addEventListener("blur", () => {
    state.keys.clear();
    state.pointer.isPainting = false;
    state.pointer.isPanning = false;
  });
}

async function init() {
  bindUi();
  setStatus("Carregando assets do editor...", "info");

  try {
    await state.assets.load();
    state.runtime = new WorldRuntime({
      canvas: dom.editorCanvas,
      assets: state.assets
    });
    state.runtime.setMap(state.map, { sanitize: true, resetPlayer: true });
    state.map = state.runtime.map;
    ensureMapLayers();
    syncMapSizeInputs();
    applyEditorMode();

    refreshFileFilterOptions();
    refreshVoidModalTileIds();
    setActiveTool(state.activeTool);
    setActiveLayer(state.activeLayer);
    updateVoidPickerPreview();
    refreshFilteredTiles();
    if (state.selectedTileId === null && state.filteredTileIds.length > 0) {
      state.selectedTileId = state.filteredTileIds[0];
      updateSelectedTileLabel();
      drawTilePalette();
    }

    setStatus("Editor pronto.", "ok");
    render();
    requestAnimationFrame(tick);
  } catch (_error) {
    setStatus("Falha ao carregar sprites/tilesets.", "error");
  }
}

init();
