import { AssetStore, TILE_SIZE, fileNameFromAssetPath } from "../shared/assets.js";
import { WorldRuntime } from "../shared/runtime.js";
import {
  INDOOR_VOID_TILE_ID,
  VOID_TILE_ID,
  createEmptyMap,
  normalizeMap,
  serializeMap,
  toIndex
} from "../shared/map-format.js";

const PALETTE_CELL_SIZE = 40;
const PALETTE_COLUMNS = 8;

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

  toggleSelectorBtn: document.getElementById("toggleSelectorBtn"),
  selectorPanel: document.getElementById("selectorPanel"),
  regionFilter: document.getElementById("regionFilter"),
  fileFilter: document.getElementById("fileFilter"),
  selectedTileLabel: document.getElementById("selectedTileLabel"),
  tilePaletteCanvas: document.getElementById("tilePaletteCanvas"),

  editorCanvas: document.getElementById("editorCanvas")
};

const paletteCtx = dom.tilePaletteCanvas.getContext("2d");

const state = {
  assets: new AssetStore(),
  runtime: null,
  map: createEmptyMap(40, 26),
  mapFileName: "novo-mapa.json",
  dirty: false,

  previewMode: false,
  selectorOpen: true,

  selectedTileId: null,
  filteredTileIds: [],
  hoveredPaletteTileId: null,

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
  state.runtime.setCameraTuning({ lookahead: 26, lerp: 0.18 });
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
  state.mapFileName = fileName || "mapa-rpg.json";
  state.dirty = false;
  state.runtime.setMap(state.map, { sanitize: true, resetPlayer: true });
  if (state.previewMode) {
    applyGamePreviewMode();
  } else {
    applyEditorMode();
  }
  setStatus(statusMessage, "ok");
}

function createNewMap() {
  const freshMap = createEmptyMap(40, 26);
  replaceMap(freshMap, "novo-mapa.json", "Novo mapa criado.");
}

async function loadMapFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const map = normalizeMap(parsed, { defaultCollision: 0 });
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

function refreshFilteredTiles() {
  const assetTileIds = state.assets.getTileIds({
    region: dom.regionFilter.value,
    file: dom.fileFilter.value
  });

  state.filteredTileIds = [];
  state.filteredTileIds.push(VOID_TILE_ID);
  for (const tileId of assetTileIds) {
    if (!state.filteredTileIds.includes(tileId)) {
      state.filteredTileIds.push(tileId);
    }
  }
  state.filteredTileIds.push(INDOOR_VOID_TILE_ID);

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

  if (state.selectedTileId === INDOOR_VOID_TILE_ID) {
    dom.selectedTileLabel.textContent = `Tile #${INDOOR_VOID_TILE_ID} | Indoor Void (Preto)`;
    return;
  }

  const meta = state.assets.getTileMeta(state.selectedTileId);
  if (!meta) {
    dom.selectedTileLabel.textContent = "Tile selecionado: invalido";
    return;
  }

  dom.selectedTileLabel.textContent = `Tile #${state.selectedTileId} | ${fileNameFromAssetPath(meta.src)}`;
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
    if (tileId === INDOOR_VOID_TILE_ID) {
      paletteCtx.fillStyle = "#000000";
      paletteCtx.fillRect(x + 4, y + 4, TILE_SIZE, TILE_SIZE);
      paletteCtx.strokeStyle = "#585858";
      paletteCtx.lineWidth = 1;
      paletteCtx.strokeRect(x + 4.5, y + 4.5, TILE_SIZE - 1, TILE_SIZE - 1);
    } else {
      state.assets.drawTile(paletteCtx, tileId, x + 4, y + 4, TILE_SIZE);
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

function tileIdFromPaletteEvent(event) {
  const pixel = getCanvasPixelPosition(event, dom.tilePaletteCanvas);
  if (!pixel) {
    return null;
  }

  const col = Math.floor(pixel.x / PALETTE_CELL_SIZE);
  const row = Math.floor(pixel.y / PALETTE_CELL_SIZE);
  if (col < 0 || row < 0 || col >= PALETTE_COLUMNS) {
    return null;
  }

  const index = row * PALETTE_COLUMNS + col;
  const tileId = state.filteredTileIds[index];
  return typeof tileId === "number" ? tileId : null;
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
  } else if (event.shiftKey) {
    const nextCollision = state.pointer.paintButton === 2 ? 0 : 1;
    changed = state.map.collision[index] !== nextCollision;
    state.map.collision[index] = nextCollision;
  } else if (state.pointer.paintButton === 2) {
    changed = state.map.tiles[index] !== VOID_TILE_ID || state.map.collision[index] !== 0;
    state.map.tiles[index] = VOID_TILE_ID;
    state.map.collision[index] = 0;
  } else if (state.selectedTileId !== null) {
    changed = state.map.tiles[index] !== state.selectedTileId;
    state.map.tiles[index] = state.selectedTileId;
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
  ctx.fillRect(10, 10, 430, 62);
  ctx.fillStyle = "#efefef";
  ctx.font = "bold 13px monospace";
  ctx.fillText(state.previewMode ? "MODO PREVIEW" : "MODO EDICAO", 20, 31);
  if (state.previewMode) {
    ctx.fillText(getPreviewPositionText(), 20, 52);
  } else {
    const suffix = state.dirty ? " (nao salvo)" : "";
    ctx.fillText(`Arquivo: ${state.mapFileName}${suffix}`, 20, 52);
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
    applyEditorMode();

    refreshFileFilterOptions();
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
