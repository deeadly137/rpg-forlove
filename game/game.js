import { AssetStore } from "../shared/assets.js";
import { cloneMap, createEmptyMap, normalizeMap, sanitizeRoomName, VOID_TILE_ID } from "../shared/map-format.js";
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
  roomsByName: new Map(),
  currentRoomName: "",
  hasMapFile: false,
  mapName: "(nenhum)",
  interactRequested: false,
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

function consumeInteractRequest() {
  const requested = state.interactRequested;
  state.interactRequested = false;
  return requested;
}

function getBaseFileName(fileName) {
  const text = String(fileName || "");
  const dot = text.lastIndexOf(".");
  if (dot <= 0) {
    return text || "sala";
  }
  return text.slice(0, dot);
}

function setVoidMapState() {
  const voidMap = createEmptyMap(40, 26);
  state.runtime.setMap(voidMap, { sanitize: true, resetPlayer: true });
  state.roomsByName.clear();
  state.currentRoomName = "";
  state.hasMapFile = false;
  state.mapName = "(nenhum)";
  setStatus(`Sem mapa carregado: vazio em Tile #${VOID_TILE_ID} (Outside E.png).`, "info");
}

function activateRoom(roomName, statusMessage = "") {
  const safeRoomName = String(roomName || "").trim();
  if (!safeRoomName) {
    return false;
  }
  const entry = state.roomsByName.get(safeRoomName);
  if (!entry) {
    return false;
  }

  state.runtime.setMap(cloneMap(entry.map), { sanitize: true, resetPlayer: true });
  state.hasMapFile = true;
  state.currentRoomName = entry.roomName;
  state.mapName = `${entry.roomName} (${entry.fileName})`;
  if (statusMessage) {
    setStatus(statusMessage, "ok");
  }
  return true;
}

async function loadMapsFromFiles(fileList) {
  const files = Array.isArray(fileList) ? fileList : [];
  if (files.length === 0) {
    return;
  }

  const parsedRooms = [];
  for (const file of files) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const fallbackRoom = sanitizeRoomName(getBaseFileName(file.name), "sala");
    const map = normalizeMap(parsed, { roomName: fallbackRoom, defaultCollision: 0 });
    if (!map) {
      throw new Error(`JSON de mapa invalido em ${file.name}.`);
    }
    map.roomName = sanitizeRoomName(map.roomName, fallbackRoom);
    parsedRooms.push({
      roomName: map.roomName,
      fileName: file.name,
      map
    });
  }

  state.roomsByName.clear();
  parsedRooms.forEach((entry) => {
    state.roomsByName.set(entry.roomName, entry);
  });

  const firstRoom = parsedRooms[0];
  activateRoom(firstRoom.roomName);
  setStatus(`Mapas carregados: ${parsedRooms.length}. Sala atual: "${firstRoom.roomName}".`, "ok");
}

function drawHud() {
  const ctx = state.runtime.ctx;
  const playerTile = state.runtime.getPlayerTilePosition();

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(10, 10, 620, 106);
  ctx.fillStyle = "#f0f0f0";
  ctx.font = "bold 13px monospace";
  ctx.fillText(`Mapa: ${state.mapName}`, 20, 31);
  ctx.fillText(`Posicao jogador: x=${playerTile.x}, y=${playerTile.y}`, 20, 52);

  if (!state.hasMapFile) {
    ctx.fillStyle = "#d6f0ff";
    ctx.fillText(`Sem arquivo: void padrao em Tile #${VOID_TILE_ID}.`, 20, 73);
  } else {
    ctx.fillStyle = "#d6f0ff";
    ctx.fillText(`Sala atual: ${state.currentRoomName} | E = INTERACT`, 20, 73);
    ctx.fillText("DOOR ativa ao pisar no tile configurado.", 20, 94);
  }
  ctx.restore();
}

function render() {
  state.runtime.render({
    backgroundColor: "#0a0a0a",
    showCollisionOverlay: false,
    showSpawnMarker: false,
    showGrid: false,
    showEventMarkers: false,
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

  state.runtime.update(getInputState(), dt, { interact: consumeInteractRequest() });
  render();
  requestAnimationFrame(tick);
}

function bindUi() {
  dom.loadMapBtn.addEventListener("click", () => {
    dom.mapFileInput.click();
  });

  dom.mapFileInput.addEventListener("change", async () => {
    const files = Array.from(dom.mapFileInput.files || []);
    if (files.length === 0) {
      return;
    }

    try {
      await loadMapsFromFiles(files);
    } catch (_error) {
      setStatus("Falha ao carregar arquivo(s) de mapa.", "error");
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

    const key = String(event.key || "").toLowerCase();
    if (key === "e") {
      state.interactRequested = true;
      event.preventDefault();
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
    state.interactRequested = false;
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
    state.runtime.setEventHandlers({
      onInteract: ({ roomName, tileX, tileY, action }) => {
        const actionText = action || "sem ação";
        setStatus(`INTERACT em "${roomName}" x=${tileX}, y=${tileY} | ação: ${actionText}. TBA.`, "ok");
      },
      onDoorEnter: ({ roomName, tileX, tileY, targetRoom }) => {
        if (activateRoom(targetRoom)) {
          setStatus(`DOOR: "${roomName}" (${tileX},${tileY}) -> "${targetRoom}".`, "ok");
          return;
        }
        setStatus(`DOOR para "${targetRoom}" nao encontrada. Carregue esta sala no jogo.`, "error");
      }
    });
    state.runtime.setZoom(1.75);
    state.runtime.setMovementEnabled(true);
    state.runtime.setFollowPlayer(true, true);
    state.runtime.setOverlay({
      showCollisionOverlay: false,
      showSpawnMarker: false,
      showGrid: false,
      showEventMarkers: false
    });
    state.runtime.setCameraTuning({ lookahead: 0, lerp: 1 });
    setVoidMapState();
    render();
    requestAnimationFrame(tick);
  } catch (_error) {
    setStatus("Falha ao carregar sprites/tilesets.", "error");
  }
}

init();
