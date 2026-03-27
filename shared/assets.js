// noinspection JSUnusedGlobalSymbols

export const TILE_SIZE = 32;

export const PLAYER_SPRITE_PATH = "../Graphics/Characters/Sprite-0001.png";
export const TILESET_PATHS = [
  "../Graphics/Tilesets/Outside E.png",
  "../Graphics/Tilesets/Underwater.png",
  "../Graphics/Autotiles/Beach.png",
  "../Graphics/Autotiles/Deep water.png",
  "../Graphics/Autotiles/Flag animation left.png",
  "../Graphics/Autotiles/Flag animation right.png",
  "../Graphics/Autotiles/Flag animation.png",
  "../Graphics/Autotiles/Pink orange flower[10].png",
  "../Graphics/Autotiles/Rafts.png",
  "../Graphics/Autotiles/Sand shore1.png",
  "../Graphics/Autotiles/Seaweed dark.png",
  "../Graphics/Autotiles/Seaweed light.png",
  "../Graphics/Autotiles/Shaded water.png",
  "../Graphics/Autotiles/Standard flower[10].png",
  "../Graphics/Autotiles/Underwater dark.png",
  "../Graphics/Autotiles/Water current autotile.png",
  "../Graphics/Autotiles/Water current east.png",
  "../Graphics/Autotiles/Water current north.png",
  "../Graphics/Autotiles/Water current south.png",
  "../Graphics/Autotiles/Water current west.png",
  "../Graphics/Autotiles/Water rock.png",
  "../Graphics/Autotiles/Waterfall bottom.png",
  "../Graphics/Autotiles/Waterfall crest.png",
  "../Graphics/Autotiles/Waterfall.png",
  "../Graphics/Autotiles/Yellow blue small flower[10].png",
  "../Graphics/Autotiles/raft water tiles.png",
  "../Graphics/Autotiles/shallow autotile beach.png"
];

function inferRegion(path) {
  const lower = String(path).toLowerCase();
  if (lower.includes("/autotiles/")) {
    return "autotiles";
  }
  if (lower.includes("/tilesets/")) {
    return "tilesets";
  }
  return "other";
}

function fileNameFromPath(path) {
  return String(path).split("/").pop() || String(path);
}

async function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Falha ao carregar ${path}`));
    image.src = encodeURI(path);
  });
}

export class AssetStore {
  constructor() {
    this.playerImage = null;
    this.sheets = [];
    this.tiles = [];
    this.tileById = new Map();
  }

  async load() {
    const [playerImage, ...sheetImages] = await Promise.all([
      loadImage(PLAYER_SPRITE_PATH),
      ...TILESET_PATHS.map((path) => loadImage(path))
    ]);

    this.playerImage = playerImage;
    this.sheets = [];
    this.tiles = [];
    this.tileById.clear();

    let offset = 0;
    for (let sheetId = 0; sheetId < sheetImages.length; sheetId += 1) {
      const image = sheetImages[sheetId];
      const src = TILESET_PATHS[sheetId];
      const columns = Math.max(1, Math.floor(image.width / TILE_SIZE));
      const rows = Math.max(1, Math.floor(image.height / TILE_SIZE));
      const tileCount = columns * rows;

      const sheet = {
        id: sheetId,
        src,
        region: inferRegion(src),
        fileName: fileNameFromPath(src),
        image,
        columns,
        rows,
        tileCount,
        offset
      };
      this.sheets.push(sheet);

      for (let localIndex = 0; localIndex < tileCount; localIndex += 1) {
        const id = offset + localIndex;
        const sx = (localIndex % columns) * TILE_SIZE;
        const sy = Math.floor(localIndex / columns) * TILE_SIZE;

        const tile = {
          id,
          sheetId,
          sx,
          sy,
          region: sheet.region,
          fileName: sheet.fileName,
          src: sheet.src
        };
        this.tiles.push(tile);
        this.tileById.set(id, tile);
      }

      offset += tileCount;
    }
  }

  get totalTileCount() {
    return this.tiles.length;
  }

  getTileMeta(tileId) {
    return this.tileById.get(tileId) || null;
  }

  drawTile(ctx, tileId, dx, dy, size = TILE_SIZE) {
    const meta = this.getTileMeta(tileId);
    if (!meta) {
      return;
    }

    // Small source inset avoids atlas bleeding lines without creating per-tile canvases.
    const inset = 0.01;
    const sheet = this.sheets[meta.sheetId];
    ctx.drawImage(
      sheet.image,
      meta.sx + inset,
      meta.sy + inset,
      TILE_SIZE - inset * 2,
      TILE_SIZE - inset * 2,
      dx,
      dy,
      size,
      size
    );
  }

  getTileIds(filter = {}) {
    const regionFilter = String(filter.region || "all").toLowerCase();
    const fileFilter = String(filter.file || "all");
    return this.tiles
      .filter((tile) =>
        (regionFilter === "all" || tile.region === regionFilter)
        && (fileFilter === "all" || tile.fileName === fileFilter)
      )
      .map((tile) => tile.id);
  }

  getFileOptions(region = "all") {
    const regionFilter = String(region).toLowerCase();
    const files = this.tiles
      .filter((tile) => regionFilter === "all" || tile.region === regionFilter)
      .map((tile) => tile.fileName);
    return [...new Set(files)].sort((a, b) => a.localeCompare(b));
  }

  sanitizeTileId(tileId) {
    return this.tileById.has(tileId) ? tileId : -1;
  }
}

export function fileNameFromAssetPath(path) {
  return fileNameFromPath(path);
}
