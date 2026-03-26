import { AssetStore } from "../shared/assets.js";
import { createEmptyMap, normalizeMap, VOID_TILE_ID } from "../shared/map-format.js";
import { WorldRuntime } from "../shared/runtime.js";

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
  loadMapBtn: document.getElementById("loadMapBtn"),
  clearMapBtn: document.getElementById("clearMapBtn"),
  mapFileInput: document.getElementById("mapFileInput"),
  statusLine: document.getElementById("statusLine"),
  gameCanvas: document.getElementById("gameCanvas")
};

const state = {
  assets: new AssetStore(),
  runtime: null,
  keys: new Set(),
  hasMapFile: false,
  mapName: "(nenhum)",
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

function setVoidMapState() {
  const voidMap = createEmptyMap(40, 26);
  state.runtime.setMap(voidMap, { sanitize: false, resetPlayer: true });
  state.hasMapFile = false;
  state.mapName = "(nenhum)";
  setStatus(`Sem mapa carregado: vazio em Tile #${VOID_TILE_ID} (Outside E.png).`, "info");
}

async function loadMapFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const map = normalizeMap(parsed, { defaultCollision: 0 });
  if (!map) {
    throw new Error("JSON de mapa invalido.");
  }
  state.runtime.setMap(map, { sanitize: true, resetPlayer: true });
  state.hasMapFile = true;
  state.mapName = file.name;
  setStatus(`Mapa carregado: ${file.name} (${map.width}x${map.height}).`, "ok");
}

function drawHud() {
  const ctx = state.runtime.ctx;
  const playerTile = state.runtime.getPlayerTilePosition();

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(10, 10, 500, 84);
  ctx.fillStyle = "#f0f0f0";
  ctx.font = "bold 13px monospace";
  ctx.fillText(`Mapa: ${state.mapName}`, 20, 31);
  ctx.fillText(`Posicao jogador: x=${playerTile.x}, y=${playerTile.y}`, 20, 52);

  if (!state.hasMapFile) {
    ctx.fillStyle = "#d6f0ff";
    ctx.fillText(`Sem arquivo: void padrao em Tile #${VOID_TILE_ID}.`, 20, 72);
  }
  ctx.restore();
}

function render() {
  state.runtime.render({
    backgroundColor: "#0a0a0a",
    showCollisionOverlay: false,
    showSpawnMarker: false,
    showGrid: false,
    showPlayer: true,
    showPlayerShadow: true,
    playerAlpha: 1
  });
  drawHud();
}

function tick(timestamp) {
  if (state.lastFrameTime === 0) {
    state.lastFrameTime = timestamp;
  }
  const dt = Math.min((timestamp - state.lastFrameTime) / 1000, 0.05);
  state.lastFrameTime = timestamp;

  state.runtime.update(getInputState(), dt);
  render();
  requestAnimationFrame(tick);
}

function bindUi() {
  dom.loadMapBtn.addEventListener("click", () => {
    dom.mapFileInput.click();
  });

  dom.mapFileInput.addEventListener("change", async () => {
    const file = dom.mapFileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      await loadMapFromFile(file);
    } catch (_error) {
      setStatus("Falha ao carregar arquivo de mapa.", "error");
    } finally {
      dom.mapFileInput.value = "";
    }
  });

  dom.clearMapBtn.addEventListener("click", () => {
    setVoidMapState();
  });

  window.addEventListener("keydown", (event) => {
    if (isFormElement(event.target)) {
      return;
    }
    const direction = directionFromEvent(event);
    if (!direction) {
      return;
    }
    state.keys.add(direction);
    event.preventDefault();
  });

  window.addEventListener("keyup", (event) => {
    const direction = directionFromEvent(event);
    if (!direction) {
      return;
    }
    state.keys.delete(direction);
    event.preventDefault();
  });

  window.addEventListener("blur", () => {
    state.keys.clear();
  });
}

async function init() {
  bindUi();
  setStatus("Carregando assets do jogo...", "info");

  try {
    await state.assets.load();
    state.runtime = new WorldRuntime({
      canvas: dom.gameCanvas,
      assets: state.assets
    });
    state.runtime.setZoom(1.75);
    state.runtime.setMovementEnabled(true);
    state.runtime.setFollowPlayer(true, true);
    state.runtime.setOverlay({
      showCollisionOverlay: false,
      showSpawnMarker: false,
      showGrid: false
    });
    state.runtime.setCameraTuning({ lookahead: 26, lerp: 0.18 });
    setVoidMapState();
    render();
    requestAnimationFrame(tick);
  } catch (_error) {
    setStatus("Falha ao carregar sprites/tilesets.", "error");
  }
}

init();
