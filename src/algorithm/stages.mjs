/**
 * 两步成像：结构层（降采样）与匹配层（色卡匹配）分开调用。
 *
 * 拆分方式与源页面一致——源页面本身就是两步：
 *
 *   step 1  `generatePixelArt()` → `processImage()`   产出未匹配的像素网格（HEX）
 *   step 2  `matchColors()`                           在 step 1 的网格上做色卡匹配
 *
 * 所以这里把 `runFullPipeline` 里串起来的编排按源文件的两步拆开，每一步都保留
 * `chain.mjs`（从 .vue 机械抽取、逐行校验过）的原样调用顺序：
 *
 *   runStructureStage:
 *     applyStructureConfigFromAdjustments → shouldSkipFeatureAnalysis
 *     → processImage（canvas stub → simpleDownsampleRgb → rgbGridToHexGrid → basePixelCache
 *        → buildStructurePixelsFromBase → buildColorSimplifiedPixelsFromBase
 *        → applySamplingEnhancements → applyRegionMergingPipeline → structureCache）
 *
 *   runMatchStage:
 *     matchColors（灰度检测 → preparePaletteForMatching → preparePixelsForPaletteMatching
 *       → mapPixelsToColorPalette → findClosestColor → applyDithering → applyBlockUnity
 *       → applySmoothMode → cleanupPaletteNoise → finalResultCache）
 *     → calculateContentArea
 *
 * 两步共用 `chain.mjs` 里的同一个单例 `ctx`，所以必须按顺序、在同一页面会话里调用：
 * `runMatchStage` 依赖 `runStructureStage` 留在 `ctx.pixelData` 上的结构网格。
 *
 * 注意尺寸模型是**方板**：格数恒为 `pixelSize × pixelSize`，源图按比例缩放后居中，
 * 非等比区域在 `hexGrid` / `codes` 里是 `null`（渲染时补白）。
 */

import { createInitialState, ctx, resetChainState } from './chain.mjs';
import { deltaE2000, rgbToLab } from '../palette-matcher.js';

/** 主链内部大量 console.log；默认静音 log/warn，保留 error。 */
function silenceLogs() {
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  return () => {
    console.log = saved.log;
    console.warn = saved.warn;
  };
}

/** `#rrggbb`（小写），非字符串返回 null。 */
function normalizeHex(hex) {
  return typeof hex === 'string' ? hex.trim().toLowerCase() : null;
}

/** 把 HEX 网格（含 null 空位）铺成 RGBA；空位补白。 */
function gridToRgba(grid, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = grid[y] || [];
    for (let x = 0; x < width; x += 1) {
      const hex = row[x];
      const o = (y * width + x) * 4;
      if (!hex) {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      out[o] = parseInt(hex.slice(1, 3), 16);
      out[o + 1] = parseInt(hex.slice(3, 5), 16);
      out[o + 2] = parseInt(hex.slice(5, 7), 16);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 统计非空格数、孤立豆与色差指标（留空格不算，否则会把平均值稀释一半）。 */
function measure(grid, codes, baseRgba, matchedRgba, width, height) {
  const cells = width * height;
  const gaps = [];
  let emptyCells = 0;

  for (let i = 0; i < cells; i += 1) {
    if (!codes[i]) {
      emptyCells += 1;
      continue;
    }
    gaps.push(
      deltaE2000(
        rgbToLab({ r: baseRgba[i * 4], g: baseRgba[i * 4 + 1], b: baseRgba[i * 4 + 2] }),
        rgbToLab({ r: matchedRgba[i * 4], g: matchedRgba[i * 4 + 1], b: matchedRgba[i * 4 + 2] }),
      ),
    );
  }

  const sorted = gaps.sort((a, b) => a - b);
  const occupied = sorted.length;

  let isolated = 0;
  const at = (x, y) => codes[y * width + x];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const code = at(x, y);
      if (!code) continue;
      const neighbors = [
        x > 0 ? at(x - 1, y) : code,
        x < width - 1 ? at(x + 1, y) : code,
        y > 0 ? at(x, y - 1) : code,
        y < height - 1 ? at(x, y + 1) : code,
      ];
      if (neighbors.every((neighbor) => neighbor !== code)) isolated += 1;
    }
  }

  return {
    cells,
    occupiedCells: occupied,
    emptyCells,
    isolatedCells: isolated,
    isolated: occupied ? isolated / occupied : 0,
    stats: {
      mean: occupied ? sorted.reduce((sum, v) => sum + v, 0) / occupied : 0,
      median: occupied ? sorted[occupied >> 1] : 0,
      max: occupied ? sorted[occupied - 1] : 0,
    },
  };
}

function assertSource(source) {
  if (!source || !source.data || !source.data.length) throw new TypeError('缺少源图像数据（需要 { width, height, data }）');
}

function assertPalette(palette) {
  if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('色卡为空');
}

/**
 * 「标准」档位预览：界面在标准模式下要显示智能推荐**实际**取了什么值，
 * 不用先跑一遍整条主链。只读，不会留下副作用。
 *
 * @param {number} pixelSize 板子边长（格）
 * @returns {{ pixelSize: number, sizeTier: string, structure: object, match: object }}
 */
export function previewStandardSettings(pixelSize) {
  const size = Math.max(1, Math.round(Number(pixelSize) || 52));
  const previous = ctx.pixelSize;
  ctx.pixelSize = size;
  try {
    return {
      pixelSize: size,
      sizeTier: ctx.getSizeTier(size),
      structure: ctx.getEffectiveStructureSettings(),
      match: ctx.getStandardMatchBaseline(),
    };
  } finally {
    ctx.pixelSize = previous;
  }
}

/**
 * 第一步：结构层（降采样 + 区域合并 + 色彩简化 + 平滑）。
 *
 * @param {object} input
 * @param {{width: number, height: number, data: Uint8ClampedArray}} input.source 源图（RGBA）
 * @param {number} input.pixelSize 像素大小（板子边长，格）——方板，格数 = pixelSize²
 * @param {Array<{code: string, hex: string}>} input.palette 色卡（step 1 就要选好，与源页面一致）
 * @param {'new'|'legacy'} [input.pipelineMode] `new` = 标准（智能推荐），`legacy` = 自定义
 * @param {object} [input.customAdjustments] `legacy` 模式的 5 个滑块（增量叠加在标准基线上）
 * @param {object} [input.selectedPalette] 影响缓存 key，可传 `{ brand, palette_code }`
 * @param {boolean} [input.quiet] 默认 true
 */
export async function runStructureStage({
  source,
  pixelSize,
  palette,
  pipelineMode = 'new',
  customAdjustments = {},
  selectedPalette = null,
  quiet = true,
} = {}) {
  assertSource(source);
  assertPalette(palette);

  const board = Math.max(1, Math.round(Number(pixelSize) || 52));
  const started = Date.now();
  const restoreLogs = quiet ? silenceLogs() : () => {};

  try {
    // 复位到 data() 默认值 + 本次输入（originalImage 用 { width, height, data }，
    // 供 canvas stub 的 drawImage / getImageInfo 使用）
    const defaults = createInitialState();
    resetChainState({
      pixelSize: board,
      hasSelectedPixelSize: true,
      originalImage: source,
      originalImageWidth: source.width,
      originalImageHeight: source.height,
      paletteColors: palette,
      selectedPalette: selectedPalette || { brand: '', palette_code: 'studio' },
      pipelineMode,
      customAdjustments: Object.assign({}, defaults.customAdjustments, customAdjustments),
      step: 1,
    });

    ctx.loading = true;
    ctx.startPerformanceTrace('generate');
    ctx.applyStructureConfigFromAdjustments();

    if (ctx.shouldSkipFeatureAnalysis()) {
      // 默认路径：enableSkinToneProtection=false，不做图片/色卡特征分析
      ctx.imageFeatures = null;
      ctx.paletteFeatures = null;
    } else {
      ctx.imageFeatures = await ctx.analyzeImage();
      ctx.paletteFeatures = ctx.analyzePalette();
    }

    const token = ++ctx.activeGenerateToken;
    await ctx.processImage(token);
    if (token !== ctx.activeGenerateToken) throw new Error('结构层已被新的生成请求取代');
    ctx.hasPreviewGenerated = true;

    const hexGrid = ctx.pixelData;
    if (!Array.isArray(hexGrid) || hexGrid.length === 0) throw new Error('结构层没有产出像素网格');

    const height = hexGrid.length;
    const width = hexGrid[0] ? hexGrid[0].length : 0;
    const rgba = gridToRgba(hexGrid, width, height);

    let occupiedCells = 0;
    for (const row of hexGrid) for (const hex of row) if (hex) occupiedCells += 1;

    return {
      width,
      height,
      cells: width * height,
      occupiedCells,
      emptyCells: width * height - occupiedCells,
      hexGrid,
      rgba,
      settings: ctx.getEffectiveStructureSettings(),
      sizeTier: ctx.getSizeTier(),
      elapsed: Date.now() - started,
    };
  } finally {
    ctx.loading = false;
    restoreLogs();
  }
}

/**
 * 第二步：色卡匹配。必须在 `runStructureStage` 之后、同一次会话里调用。
 *
 * @param {object} input
 * @param {Array<{code: string, hex: string}>} input.palette 色卡（与结构层同一份）
 * @param {'standard'|'custom'} [input.matchMode] `standard` = 智能推荐基线，`custom` = 用下面的档位
 * @param {object} [input.matchParams] `custom` 时的档位：`paletteMergeLevel` / `smoothNoiseLevel` /
 *   `blockUnityLevel` / `saturationLevel` / `contrastLevel` / `enableSkinToneProtection`
 * @param {'none'|'floyd-steinberg'|'atkinson'} [input.dithering] 抖动，默认 none
 * @param {boolean} [input.quiet] 默认 true
 */
export async function runMatchStage({
  palette,
  matchMode = 'standard',
  matchParams = {},
  dithering = 'none',
  quiet = true,
} = {}) {
  assertPalette(palette);

  const baseGrid = ctx.pixelData;
  if (!Array.isArray(baseGrid) || baseGrid.length === 0) {
    throw new Error('匹配层需要先跑结构层（ctx.pixelData 为空）');
  }

  const started = Date.now();
  const restoreLogs = quiet ? silenceLogs() : () => {};

  try {
    ctx.paletteColors = palette;
    ctx.matchMode = matchMode;

    // 色卡匹配策略（最近色 / 同色系）在源页面里就存在 `autoConfig` 上，
    // 算法也只读 `ctx.autoConfig.paletteStrategy`——挂到 ctx 顶层不会生效（会变成假控件）。
    const { paletteStrategy, familyPriority, ...levelParams } = matchParams;
    ctx.autoConfig = Object.assign({}, ctx.autoConfig, { dithering });
    if (paletteStrategy) ctx.autoConfig.paletteStrategy = paletteStrategy;
    if (familyPriority) ctx.autoConfig.familyPriority = familyPriority;

    for (const [key, value] of Object.entries(levelParams)) {
      if (value !== undefined && value !== null) ctx[key] = value;
    }

    const token = ++ctx.activeGenerateToken;
    const ok = await ctx.matchColors(token);
    if (!ok || token !== ctx.activeGenerateToken) throw new Error('匹配层没有产出结果');

    ctx.calculateContentArea();
    ctx.step = 2;

    const matchedGrid = ctx.resultPixelData;
    if (!Array.isArray(matchedGrid) || matchedGrid.length === 0) throw new Error('匹配结果为空格');

    const height = matchedGrid.length;
    const width = matchedGrid[0] ? matchedGrid[0].length : 0;
    if (baseGrid.length !== height || (baseGrid[0] || []).length !== width) {
      throw new Error('结构层与匹配层网格尺寸不一致');
    }

    const codeHex = new Map(palette.map((p) => [p.code ?? p.hex, p.hex]));
    const hexToCode = new Map(palette.map((p) => [normalizeHex(p.hex), p.code ?? p.hex]));
    const cells = width * height;
    const codes = new Array(cells);
    for (let y = 0; y < height; y += 1) {
      const row = matchedGrid[y] || [];
      for (let x = 0; x < width; x += 1) {
        const hex = normalizeHex(row[x]);
        codes[y * width + x] = hex ? hexToCode.get(hex) ?? hex : null;
      }
    }

    const baseRgba = gridToRgba(baseGrid, width, height);
    const matchedRgba = gridToRgba(matchedGrid, width, height);

    const usage = new Map();
    for (const code of codes) if (code) usage.set(code, (usage.get(code) ?? 0) + 1);

    return {
      width,
      height,
      ...measure(matchedGrid, codes, baseRgba, matchedRgba, width, height),
      base: baseRgba,
      rgba: matchedRgba,
      hexGrid: matchedGrid,
      codes,
      codeHex,
      usage,
      ranked: [...usage.entries()].sort((a, b) => b[1] - a[1]),
      paletteSize: palette.length,
      elapsed: Date.now() - started,
    };
  } finally {
    ctx.loading = false;
    restoreLogs();
  }
}
