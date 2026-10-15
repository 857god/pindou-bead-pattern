/**
 * 两步工作流的唯一状态源。
 *
 * 只做源页面两个步骤里的事情：
 *   第一步 runStructureStage → 未匹配的结构网格
 *   第二步 runMatchStage     → 色卡匹配后的网格
 *
 * 没有 VIP / 编辑器 / 导出 / AI 生成 / 用量统计 / 历史拦截。
 */

import { computed, reactive } from 'vue';

import { decodeFile, sampleScene } from './algorithm/image.mjs';
import { listPalettes, loadPalette } from './algorithm/palette-source.mjs';
import { runMatchStage, runStructureStage } from './algorithm/stages.mjs';
import { paintGrid } from './render.mjs';
import { normalizePaletteColors, sortPaletteInfosByCode } from './palette-util.mjs';

/* ==================== 常量（照抄源页面 data()） ==================== */

/** 源页面 sizeOptions: [30, 52, 80, 104, 150] */
export const SIZE_OPTIONS = [30, 52, 80, 104, 150];
/** 源页面 maxPixelSize: 200（开源版不做 VIP 尺寸限制） */
export const MAX_PIXEL_SIZE = 200;
export const MIN_PIXEL_SIZE = 20;
export const DEFAULT_PIXEL_SIZE = 52;
/** 无头自检默认色卡 */
export const AUTOTEST_PALETTE_ID = 'synthetic:152';
/** 无头自检默认像素大小 */
export const AUTOTEST_PIXEL_SIZE = 52;

/** 源页面 slider 是 @change 防抖后重算；这里统一 300ms（饱和度 / 对比度照源页面 500ms）。 */
export const ADJUST_DEBOUNCE_MS = 300;
export const SATURATION_DEBOUNCE_MS = 500;

export const PIPELINE_MODES = [
  { value: 'new', label: '标准' },
  { value: 'legacy', label: '自定义' },
];

export const MATCH_MODES = [
  { value: 'standard', label: '标准' },
  { value: 'custom', label: '自定义' },
];

export const PALETTE_STRATEGIES = [
  { value: 'nearest', label: '最近色' },
  { value: 'family', label: '同色系' },
];

export const FAMILY_PRIORITIES = [
  { value: 'low', label: '弱' },
  { value: 'medium', label: '一般' },
  { value: 'high', label: '强' },
];

export const DITHERING_OPTIONS = [
  { value: 'none', label: '无' },
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
  { value: 'atkinson', label: 'Atkinson' },
];

/** 结构层自定义滑块（顺序即界面顺序） */
export const STRUCTURE_ADJUSTMENTS = [
  {
    key: 'backgroundClean',
    label: '背景简化',
    hint: '（让背景更干净，太高会损失细节）',
    min: 0,
    max: 10,
  },
  {
    key: 'colorClean',
    label: '颜色简化',
    hint: '（减少杂色，让颜色更统一；这是<em>较耗时</em>处理）',
    min: 0,
    max: 10,
  },
  {
    key: 'blockClarity',
    label: '色块清晰度',
    hint: '（越高色块越干净，插画感更强）',
    min: 0,
    max: 10,
  },
  {
    key: 'edgeKeep',
    label: '线条保留',
    hint: '（越高越保留轮廓和暗线，太高可能显脏）',
    min: 0,
    max: 10,
  },
  {
    key: 'noiseSmooth',
    label: '柔和降噪',
    hint: '（减少小噪点，太高可能变糊）',
    min: 0,
    max: 10,
  },
];

/** 匹配层自定义滑块（顺序即界面顺序，键名就是 runMatchStage 的 matchParams） */
export const MATCH_ADJUSTMENTS = [
  {
    key: 'paletteMergeLevel',
    label: '孤色清理',
    hint: '（清理不超过 N 格的小色块，太高会吃细节）',
    min: 0,
    max: 10,
    suffix: '格',
    scale: 1,
  },
  {
    key: 'blockUnityLevel',
    label: '块面统一',
    hint: '（让相邻区域倾向同一色号，越高大块越干净，太高会糊细节）',
    min: 0,
    max: 10,
    suffix: '',
    scale: 1,
  },
  {
    key: 'smoothNoiseLevel',
    label: '柔和降噪',
    hint: '（让局部跳色更少，太高会变糊）',
    min: 0,
    max: 10,
    suffix: '',
    scale: 1,
  },
  {
    key: 'saturationLevel',
    label: '色彩鲜艳度',
    hint: '（匹配前调整，最终仍是色卡色号）',
    min: 80,
    max: 120,
    suffix: '%',
    scale: 100,
    debounce: SATURATION_DEBOUNCE_MS,
  },
  {
    key: 'contrastLevel',
    label: '明暗层次',
    hint: '（匹配前调整，影响选亮色还是暗色）',
    min: 80,
    max: 120,
    suffix: '%',
    scale: 100,
    debounce: SATURATION_DEBOUNCE_MS,
  },
];

/* ==================== 小工具 ==================== */

const NO_PALETTE = '请先选择品牌';
const NO_BRAND = '请选择品牌';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** 带上限的结构层标准基线（与源页面 getStandardBaseline 同构；colorClean 在 pixelSize<=52 时为 2） */
function structureBaseline(pixelSize) {
  const side = Number(pixelSize) || DEFAULT_PIXEL_SIZE;
  let base;
  if (side < 64) {
    base = { backgroundClean: 2, colorClean: 2, blockClarity: 2, edgeKeep: 2, noiseSmooth: 1 };
  } else if (side < 104) {
    base = { backgroundClean: 1, colorClean: 0, blockClarity: 1, edgeKeep: 1, noiseSmooth: 1 };
  } else if (side < 150) {
    base = { backgroundClean: 0, colorClean: 0, blockClarity: 1, edgeKeep: 1, noiseSmooth: 0 };
  } else {
    base = { backgroundClean: 0, colorClean: 0, blockClarity: 0, edgeKeep: 0, noiseSmooth: 0 };
  }
  base.colorClean = side <= 52 ? 2 : 0;
  return base;
}

/** 匹配层标准基线（与源页面 getStandardMatchBaseline 同构） */
function matchBaseline(pixelSize) {
  const side = Number(pixelSize) || DEFAULT_PIXEL_SIZE;
  if (side < 64) {
    return { paletteMergeLevel: 1, smoothNoiseLevel: 1, blockUnityLevel: 2, saturationLevel: 1, contrastLevel: 1, enableSkinToneProtection: false };
  }
  if (side < 104) {
    return { paletteMergeLevel: 1, smoothNoiseLevel: 2, blockUnityLevel: 3, saturationLevel: 1, contrastLevel: 1, enableSkinToneProtection: false };
  }
  if (side < 150) {
    return { paletteMergeLevel: 3, smoothNoiseLevel: 3, blockUnityLevel: 4, saturationLevel: 1, contrastLevel: 1, enableSkinToneProtection: false };
  }
  return { paletteMergeLevel: 2, smoothNoiseLevel: 2, blockUnityLevel: 3, saturationLevel: 1, contrastLevel: 1, enableSkinToneProtection: false };
}

function waitNextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

function shortStack(error) {
  const stack = String((error && error.stack) || '');
  const lines = stack
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.startsWith('at '))
    .slice(0, 3);
  return (lines.length ? lines : [stack.split('\n')[0] || '']).join(' <- ');
}

/** 自检模式的内部轨迹：只有 ?autotest=1 / ?testdrive=1 时才记录，正常使用零开销。 */
function trace(message) {
  if (!store.autotestMode) return;
  store.diag.push(`${Date.now() % 1000000} ${message}`);
  if (store.diag.length > 200) store.diag.shift();
}

/* ==================== store ==================== */

export const store = reactive({
  /* 步骤 */
  step: 1,
  navTitle: '像素化处理',

  /* 源图 */
  source: null, // { width, height, data, name }
  sourceUrl: '', // 给 <img> 预览用
  dragging: false,

  /* 第一步参数 */
  pixelSize: DEFAULT_PIXEL_SIZE,
  hasSelectedPixelSize: false,
  customPixelSize: '',

  /* 第二步参数 */
  pipelineMode: 'new',
  customAdjustments: {
    backgroundClean: 0,
    colorClean: 0,
    blockClarity: 0,
    edgeKeep: 0,
    noiseSmooth: 0,
  },
  matchMode: 'standard',
  matchParams: {
    paletteMergeLevel: 0,
    smoothNoiseLevel: 2,
    blockUnityLevel: 0,
    saturationLevel: 1,
    contrastLevel: 1,
  },
  enableSkinToneProtection: false,
  hasCustomMatchConfig: false,
  paletteStrategy: 'nearest',
  familyPriority: 'medium',
  dithering: 'none',

  /* 色卡 */
  palettesLoading: false,
  palettesError: '',
  paletteInfos: [],
  selectedBrand: '',
  selectedPaletteId: '',
  selectedPalette: null,
  paletteColors: [],

  /* 结果 */
  structureResult: null,
  structureGrid: null,
  structureStale: true,
  matchResult: null,
  matchGrid: null,
  matchRunCount: 0,
  structureElapsed: 0,
  matchElapsed: 0,

  /* 画布 */
  canvasStructure: null,
  canvasMatch: null,
  paintToken: 0,
  painting: false,

  /* loading / 错误 */
  loading: false,
  loadingText: '',
  loadingPending: 0,
  error: '',
  globalError: '',

  /* 无头自检 */
  autotestMode: false,
  autotestStatus: '',
  autotestText: '',
  autotestLogs: '',
  diag: [],
});

/* ==================== 计算属性 ==================== */

/** 两步预览画布都按 1 格 1 后备像素 + CSS 缩放，所以不需要算缩放比例。 */
export const previewLabel = computed(() => {
  const result = store.matchGrid ? store.matchResult : store.structureResult;
  if (!result) return '';

  const side = `${result.width} × ${result.height}`;
  const extra =
    store.matchGrid && store.matchResult
      ? ` · 色号 ${store.matchResult.ranked.length} 色 · 平均色差 ${store.matchResult.stats.mean.toFixed(1)}`
      : ` · 已铺 ${result.occupiedCells} 格 · 留空 ${result.emptyCells} 格`;
  return `${side}${extra}`;
});

export const canGenerate = computed(
  () => Boolean(store.source) && store.hasSelectedPixelSize && Boolean(store.selectedPalette),
);

export const brands = computed(() => {
  const list = [];
  for (const item of store.paletteInfos) {
    if (!list.includes(item.brand)) list.push(item.brand);
  }
  return list;
});

export const palettesOfBrand = computed(() =>
  sortPaletteInfosByCode(store.paletteInfos.filter((item) => item.brand === store.selectedBrand)),
);

export const wholePageLoading = computed(() => store.loading === true || store.loadingPending > 0);

/** 标准模式下界面显示的是标准基线值；自定义模式显示用户档位 */
export const structureDisplay = computed(() => {
  const base = structureBaseline(store.pixelSize);
  if (store.pipelineMode !== 'legacy') return base;
  const out = {};
  for (const key of Object.keys(base)) {
    out[key] = clamp((base[key] || 0) + (Number(store.customAdjustments[key]) || 0), 0, 10);
  }
  return out;
});

/** 匹配面板显示值：百分比档位换算成 80-120 的显示值 */
export const matchDisplay = computed(() => {
  const base = matchBaseline(store.pixelSize);
  const source = store.matchMode === 'custom' ? store.matchParams : base;
  return {
    paletteMergeLevel: clamp(Number(source.paletteMergeLevel) || 0, 0, 10),
    blockUnityLevel: clamp(Number(source.blockUnityLevel) || 0, 0, 10),
    smoothNoiseLevel: clamp(Number(source.smoothNoiseLevel) || 0, 0, 10),
    saturationLevel: Math.round(clamp(Number(source.saturationLevel) || 1, 0.8, 1.2) * 100),
    contrastLevel: Math.round(clamp(Number(source.contrastLevel) || 1, 0.8, 1.2) * 100),
    // 肤色保护不在 matchParams 里（源页面是独立的 data 字段），要读 store 顶层字段
    enableSkinToneProtection: store.matchMode === 'custom' ? store.enableSkinToneProtection : base.enableSkinToneProtection,
  };
});

/* ==================== 错误 / loading ==================== */

export function setError(message) {
  store.error = String((message && message.message) || message || '');
}

export function clearError() {
  store.error = '';
}

function beginLoading(text) {
  store.loadingPending += 1;
  store.loadingText = text || store.loadingText || '正在处理...';
  return store.loadingPending;
}

function endLoading(token) {
  if (typeof token === 'number' && token !== store.loadingPending) return false;
  store.loadingPending = Math.max(0, store.loadingPending - 1);
  return true;
}

/**
 * 跑一次重算：先让浏览器把 loading 画出来，再做几百 ms 的同步计算。
 * 保证调用前有提示、调用期间界面不假死。
 */
async function runHeavy(text, work) {
  const token = beginLoading(text);
  store.error = '';
  try {
    await waitNextFrame();
    return await work();
  } catch (error) {
    setError(error);
    return null;
  } finally {
    store.loading = false;
    endLoading(token);
  }
}

/** 解码图片 / 拉色卡这类不改算法的异步任务，同样给出 loading 反馈 */
async function runTask(text, work) {
  const token = beginLoading(text);
  store.error = '';
  try {
    return await work();
  } catch (error) {
    setError(error);
    return null;
  } finally {
    endLoading(token);
  }
}

/* ==================== 画布绘制 ==================== */

export function setCanvas(which, element) {
  if (which === 'structure') store.canvasStructure = element;
  else if (which === 'match') store.canvasMatch = element;
  schedulePaint();
}

function pickCanvas(force) {
  if (force === 'structure') return store.canvasStructure;
  if (force === 'match') return store.canvasMatch;
  if (store.step === 2 && store.matchGrid) return store.canvasMatch;
  if (store.canvasStructure && store.structureGrid) return store.canvasStructure;
  if (store.canvasMatch && store.matchGrid) return store.canvasMatch;
  return null;
}

/** 画布可能还没挂载 / 刚被替换，所以延到下一帧再画，避免画到已经卸载的元素上。 */
export function schedulePaint(force) {
  const token = ++store.paintToken;
  if (typeof requestAnimationFrame !== 'function') return;

  requestAnimationFrame(() => {
    if (token !== store.paintToken || store.painting) return;
    const canvas = pickCanvas(force);
    const grid = canvas && canvas === store.canvasMatch ? store.matchGrid : store.structureGrid;
    if (!canvas || !grid) return;

    store.painting = true;
    try {
      paintGrid(canvas, { rgba: grid.rgba, width: grid.width, height: grid.height });
    } catch (error) {
      setError(error);
    } finally {
      store.painting = false;
    }
  });
}

/* ==================== 源图 ==================== */

function resetResults() {
  store.structureResult = null;
  store.structureGrid = null;
  store.structureStale = true;
  store.matchResult = null;
  store.matchGrid = null;
  store.structureElapsed = 0;
  store.matchElapsed = 0;
}

async function applySource(source) {
  store.source = source;
  store.sourceUrl = '';
  store.dragging = false;
  store.hasSelectedPixelSize = false;
  store.customPixelSize = '';
  store.step = 1;
  resetResults();

  try {
    store.sourceUrl = toDataUrl(source);
  } catch {
    store.sourceUrl = '';
  }
}

function toDataUrl(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(source.data), source.width, source.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export async function useFile(file) {
  if (!file) return null;
  if (file.type && !file.type.startsWith('image/')) {
    setError('请选择图片文件');
    return null;
  }

  const source = await runTask('正在读取图片...', () => decodeFile(file));
  if (!source) return null;
  await applySource(source);
  return source;
}

export async function useSample() {
  const source = await runTask('正在读取示例场景...', async () => sampleScene());
  if (!source) return null;
  await applySource(source);
  return source;
}

export function resetImage() {
  store.source = null;
  store.sourceUrl = '';
  store.hasSelectedPixelSize = false;
  store.customPixelSize = '';
  store.step = 1;
  resetResults();
}

/* ==================== 色卡 ==================== */

/** 默认选中第一张可用色卡（外部品牌色卡按前缀排序，其次内置合成色卡）。 */
async function selectDefaultPalette() {
  const target = store.paletteInfos[0];
  if (!target) {
    setError('没有可用色卡');
    return;
  }
  await selectPaletteById(target.id);
}

export async function loadPaletteInfos() {
  if (store.paletteInfos.length || store.palettesLoading) return store.paletteInfos;

  store.palettesLoading = true;
  const data = await runTask('正在加载色卡...', () => listPalettes());
  store.palettesLoading = false;
  if (!data) return [];

  store.paletteInfos = data.all || [];
  if (!store.paletteInfos.length) setError('没有可用色卡');
  return store.paletteInfos;
}

export function selectBrand(brand) {
  if (brand === NO_BRAND || !brand) {
    store.selectedBrand = '';
    store.selectedPaletteId = '';
    store.selectedPalette = null;
    store.paletteColors = [];
    return;
  }
  store.selectedBrand = brand;
  const first = palettesOfBrand.value[0];
  if (first) selectPaletteById(first.id);
}

export async function selectPaletteById(id) {
  const info = store.paletteInfos.find((item) => item.id === id);
  if (!info) return null;

  const loaded = await runTask('正在加载色卡颜色...', () => loadPalette(id));
  if (!loaded) return null;

  store.selectedBrand = info.brand;
  store.selectedPaletteId = info.id;
  store.selectedPalette = info;
  store.paletteColors = normalizePaletteColors(loaded.colors);
  store.structureStale = true;

  if (!store.paletteColors.length) setError('色卡没有颜色数据');
  return store.paletteColors;
}

/* ==================== 第一步参数 ==================== */

export function setPixelSize(size) {
  const value = clamp(Math.round(Number(size) || 0), MIN_PIXEL_SIZE, MAX_PIXEL_SIZE);
  if (!value) return false;

  const changed = store.pixelSize !== value;
  store.pixelSize = value;
  store.hasSelectedPixelSize = true;
  store.customPixelSize = '';
  if (changed) {
    store.structureStale = true;
    store.matchGrid = null;
    store.matchResult = null;
  }
  return changed;
}

export function applyCustomSize() {
  const value = Number.parseInt(store.customPixelSize, 10);
  if (!value || value < MIN_PIXEL_SIZE || value > MAX_PIXEL_SIZE) {
    setError(`请输入 ${MIN_PIXEL_SIZE}-${MAX_PIXEL_SIZE} 之间的数值`);
    store.customPixelSize = '';
    return false;
  }
  setPixelSize(value);
  store.customPixelSize = String(store.pixelSize);
  return true;
}

/* ==================== 第二步参数 ==================== */

function setMatchParam(key, value) {
  store.matchParams[key] = value;
  store.hasCustomMatchConfig = true;
}

/* ==================== 重算调度 ==================== */

let adjustTimer = null;
let scheduleToken = 0;

function clearAdjustTimer() {
  if (adjustTimer) {
    clearTimeout(adjustTimer);
    adjustTimer = null;
  }
}

/** 切步骤 / 开始新流程时，把还没落地的防抖回调掐掉，避免过期的重算把结果覆盖回去。 */
export function cancelPendingWork() {
  clearAdjustTimer();
  scheduleToken += 1;
}

/** 重算前统一清掉未落地的防抖，保证「最后一次操作」赢。 */
function resetSchedules() {
  clearAdjustTimer();
  scheduleToken += 1;
  return scheduleToken;
}

function scheduleRecompute(delay) {
  clearAdjustTimer();
  const token = ++scheduleToken;
  trace(`scheduleRecompute delay=${delay} token=${token} step=${store.step}`);
  adjustTimer = setTimeout(() => {
    adjustTimer = null;
    trace(`fire token=${token} now=${scheduleToken}`);
    if (token !== scheduleToken) return;
    if (store.step === 2) runStage2();
    else runStage1();
  }, delay);
}

export function setPipelineMode(mode) {
  if (store.pipelineMode === mode) return;
  trace(`setPipelineMode ${mode}`);
  store.pipelineMode = mode;
  store.structureStale = true;
  const step = store.step;
  resetSchedules();
  if (step === 2) runStage2();
  else if (store.source && store.hasSelectedPixelSize) runStage1();
}

export function setMatchMode(mode) {
  if (store.matchMode === mode) return;
  if (mode === 'custom' && !store.hasCustomMatchConfig) {
    const base = matchBaseline(store.pixelSize);
    store.matchParams.paletteMergeLevel = base.paletteMergeLevel;
    store.matchParams.smoothNoiseLevel = base.smoothNoiseLevel;
    store.matchParams.blockUnityLevel = base.blockUnityLevel;
    store.matchParams.saturationLevel = base.saturationLevel;
    store.matchParams.contrastLevel = base.contrastLevel;
    store.enableSkinToneProtection = base.enableSkinToneProtection;
    store.hasCustomMatchConfig = true;
  }
  store.matchMode = mode;
  trace(`setMatchMode ${mode}`);
  scheduleRecompute(ADJUST_DEBOUNCE_MS);
}

/** 肤色保护：只有自定义模式下能改；标准模式显示基线值（只读） */
export function setSkinToneProtection(enabled) {
  if (store.matchMode !== 'custom') return;
  store.enableSkinToneProtection = Boolean(enabled);
  store.hasCustomMatchConfig = true;
  scheduleRecompute(ADJUST_DEBOUNCE_MS);
}

export function setPaletteStrategy(strategy) {
  if (store.paletteStrategy === strategy) return;
  store.paletteStrategy = strategy;
  scheduleRecompute(ADJUST_DEBOUNCE_MS);
}

export function setFamilyPriority(priority) {
  if (store.familyPriority === priority) return;
  store.familyPriority = priority;
  scheduleRecompute(ADJUST_DEBOUNCE_MS);
}

export function setDithering(mode) {
  if (store.dithering === mode) return;
  store.dithering = mode;
  scheduleRecompute(ADJUST_DEBOUNCE_MS);
}

/** 第一步滑块：input 只改数字，change 才防抖重算 */
export function onStructureAdjustInput(key, value) {
  if (!(key in store.customAdjustments)) return;
  store.customAdjustments[key] = Number(value);
}

export function onStructureAdjustChange(key, value) {
  if (!(key in store.customAdjustments)) return;
  store.customAdjustments[key] = Number(value);
  scheduleRecompute(ADJUST_DEBOUNCE_MS);
}

/** 第二步滑块：input 只改数字，change 才防抖重算 */
export function onMatchAdjustInput(key, value) {
  if (!(key in store.matchParams)) return;
  const item = MATCH_ADJUSTMENTS.find((entry) => entry.key === key);
  store.matchParams[key] = Number(value) / (item ? item.scale : 1);
  store.hasCustomMatchConfig = true;
}

export function onMatchAdjustChange(key, value) {
  const item = MATCH_ADJUSTMENTS.find((entry) => entry.key === key);
  onMatchAdjustInput(key, value);
  scheduleRecompute((item && item.debounce) || ADJUST_DEBOUNCE_MS);
}

/* ==================== 第一步：结构层 ==================== */

function normalizePalette() {
  return store.paletteColors.map((color) => ({ code: color.code, hex: color.hex }));
}

function structureInputs() {
  return {
    source: store.source,
    pixelSize: store.pixelSize,
    palette: normalizePalette(),
    pipelineMode: store.pipelineMode,
    customAdjustments: { ...store.customAdjustments },
    selectedPalette: store.selectedPalette
      ? { brand: store.selectedPalette.brand, palette_code: store.selectedPalette.paletteCode }
      : null,
  };
}

async function runStructureStageInner() {
  if (!store.source) return null;
  if (!store.hasSelectedPixelSize) {
    setError('请先选择板子大小');
    return null;
  }
  if (!store.paletteColors.length) {
    setError('请先选择色卡');
    return null;
  }

  const inputs = structureInputs();
  const result = await runHeavy('正在生成像素图...', () => runStructureStage(inputs));
  if (!result) return null;

  store.structureResult = result;
  store.structureGrid = result;
  store.structureStale = false;
  store.structureElapsed = result.elapsed;
  if (store.step === 1) {
    // 第一步的预览要立刻切回未匹配的结构网格
    store.matchGrid = null;
    store.matchResult = null;
    schedulePaint('structure');
  }
  return result;
}

/** 只跑第一步（第一步界面里的参数变化走这里；当前在第二步则顺带重跑匹配层） */
export async function runStage1() {
  const step = store.step;
  const token = resetSchedules();
  const result = await runStructureStageInner();
  if (!result || token !== scheduleToken) return result;
  if (step === 2) await runStage2();
  return result;
}

/**
 * 第一步参数变了、当前在第二步：先重跑结构层，再重跑匹配层。
 *
 * 每段 await 之后都要确认 `scheduleToken` 没被新的调度 / 切步骤作废——
 * 否则用户点了「上一步」，几百毫秒前排队的那次重算还会把步骤推回第二步。
 */
async function runStage2() {
  const token = resetSchedules();
  if (!store.source || !store.hasSelectedPixelSize) return null;

  if (store.structureStale || !store.structureResult) {
    const resulted = await runStructureStageInner();
    if (!resulted || token !== scheduleToken) return null;
  }
  if (token !== scheduleToken) return null;
  return runMatchStageInner(token);
}

/* ==================== 第二步：匹配层 ==================== */

function matchInputs() {
  // 色卡匹配策略 / 色系优先程度在源页面里与「匹配模式」平级，标准和自定义两种模式下都要生效，
  // 所以这两个键始终传下去（算法把它们挂到 ctx.autoConfig 上）。
  const inputs = {
    palette: normalizePalette(),
    matchMode: store.matchMode,
    dithering: store.dithering,
    matchParams: {
      paletteStrategy: store.paletteStrategy,
      familyPriority: store.familyPriority,
    },
  };

  if (store.matchMode === 'custom') {
    Object.assign(inputs.matchParams, {
      paletteMergeLevel: store.matchParams.paletteMergeLevel,
      smoothNoiseLevel: store.matchParams.smoothNoiseLevel,
      blockUnityLevel: store.matchParams.blockUnityLevel,
      saturationLevel: store.matchParams.saturationLevel,
      contrastLevel: store.matchParams.contrastLevel,
      enableSkinToneProtection: store.enableSkinToneProtection,
    });
  }

  return inputs;
}

async function runMatchStageInner(token) {
  if (!store.structureResult) {
    setError('匹配层需要先跑结构层');
    return null;
  }

  const inputs = matchInputs();
  trace(`match start mode=${store.matchMode} strategy=${store.paletteStrategy} step=${store.step}`);
  const result = await runHeavy('正在匹配色卡颜色...', () => runMatchStage(inputs));
  trace(`match done ok=${Boolean(result)} err=${store.error || '-'}`);
  if (!result) return null;
  if (typeof token === 'number' && token !== scheduleToken) return null;

  store.matchResult = result;
  store.matchGrid = result;
  store.matchElapsed = result.elapsed;
  store.matchRunCount += 1;
  schedulePaint('match');
  return result;
}

/** 进入第二步：结构层已就绪就只跑匹配层 */
export async function enterStep2() {
  if (!store.source) return null;
  if (!store.paletteColors.length) {
    setError('请先选择色卡');
    return null;
  }

  resetSchedules();
  if (store.structureStale || !store.structureResult) {
    const resulted = await runStructureStageInner();
    if (!resulted) return null;
  }

  const matched = await runMatchStageInner();
  if (!matched) return null;

  store.step = 2;
  store.navTitle = '色号匹配';
  return matched;
}

/** 回到第一步：把预览切回未匹配的结构网格 */
export function backToStep1() {
  resetSchedules();
  store.step = 1;
  store.navTitle = '像素化处理';
  schedulePaint('structure');
}

export function startStructurePreview() {
  return runStage1();
}

/* ==================== 无头自检模式 ==================== */

export function isAutotest() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('autotest') === '1';
  } catch {
    return false;
  }
}

function writeAutotest(status, text) {
  store.autotestMode = true;
  store.autotestStatus = status;
  store.autotestText = text;
  applyAutotestDom(status, text);
}

/** 同时写属性和文本，避免依赖 Vue 的重渲染时机（自检脚本可能立刻读 DOM）。 */
function applyAutotestDom(status, text) {
  if (typeof document === 'undefined') return;
  const node = document.getElementById('autotest');
  if (!node) return;
  node.setAttribute('data-status', status);
  node.textContent = text;
}

/** 未捕获错误也要渲染到页面上，方便 --dump-dom 抓取 */
export function reportGlobalError(message, detail) {
  const text = [String(message || '未知错误'), detail ? `at ${detail}` : ''].filter(Boolean).join('\n');
  store.globalError = text;

  // 自检模式下改状态但保留已经写好的实测数字，避免把结果顶掉
  if (store.autotestMode) {
    store.autotestStatus = 'error';
    applyAutotestDom(
      'error',
      store.autotestText && !store.autotestText.startsWith('error=')
        ? `${store.autotestText}\nglobalError=${text}`
        : `error=${text}`,
    );
  }
}

export async function runAutotest() {
  store.autotestMode = true;
  const started = Date.now();

  try {
    const { colors } = await loadPalette(AUTOTEST_PALETTE_ID);
    const palette = normalizePaletteColors(colors);

    store.source = null;
    store.sourceUrl = '';
    store.paletteInfos = [
      {
        id: AUTOTEST_PALETTE_ID,
        label: `${AUTOTEST_PALETTE_ID} · 自检用合成色卡`,
        brand: '内置合成色卡',
        paletteCode: 'synthetic-152',
        colorCount: palette.length,
        kind: 'synthetic',
        display: 'synthetic-152',
      },
    ];
    store.selectedBrand = '内置合成色卡';
    store.selectedPaletteId = AUTOTEST_PALETTE_ID;
    store.selectedPalette = store.paletteInfos[0];
    store.paletteColors = palette;

    store.hasSelectedPixelSize = true;
    store.pixelSize = AUTOTEST_PIXEL_SIZE;
    resetResults();

    const source = sampleScene();
    store.source = { width: source.width, height: source.height, data: source.data, name: source.name };
    store.sourceUrl = toDataUrl(store.source);

    await waitNextFrame();

    const structure = await runStructureStage(structureInputs());
    store.structureResult = structure;
    store.structureGrid = structure;
    store.structureStale = false;
    schedulePaint();

    const matched = await runMatchStage(matchInputs());
    store.matchResult = matched;
    store.matchGrid = matched;
    store.step = 2;
    store.navTitle = '色号匹配';
    schedulePaint();

    const lines = [
      'mode=autotest',
      `palette=${AUTOTEST_PALETTE_ID}(${palette.length}色)`,
      `pixelSize=${AUTOTEST_PIXEL_SIZE}`,
      `structure=${structure.width}x${structure.height}`,
      `occupied=${structure.occupiedCells}`,
      `empty=${structure.emptyCells}`,
      `structureElapsedMs=${structure.elapsed}`,
      `match=${matched.width}x${matched.height}`,
      `colors=${matched.ranked.length}`,
      `mean=${matched.stats.mean.toFixed(2)}`,
      `median=${matched.stats.median.toFixed(2)}`,
      `max=${matched.stats.max.toFixed(2)}`,
      `isolated=${matched.isolatedCells}`,
      `matchElapsedMs=${matched.elapsed}`,
      `elapsedMs=${Date.now() - started}`,
    ];

    writeAutotest('ok', lines.join('\n'));
    return lines.join('\n');
  } catch (error) {
    const message = (error && error.message) || String(error);
    const lines = [
      'mode=autotest',
      `palette=${AUTOTEST_PALETTE_ID}`,
      `error=${message}`,
      `stack=${shortStack(error)}`,
      `elapsedMs=${Date.now() - started}`,
    ];
    writeAutotest('error', lines.join('\n'));
    return lines.join('\n');
  } finally {
    store.loading = false;
    store.loadingPending = 0;
  }
}

/* ==================== 启动 ==================== */

export async function initWorkflow() {
  store.autotestMode = isAutotest();

  if (store.autotestMode) {
    await runAutotest();
    return;
  }

  await loadPaletteInfos();
  if (store.paletteInfos.length) await selectDefaultPalette();

  if (isTestDrive()) await runTestDrive();
}

/* ==================== 无头交互自检（?testdrive=1） ==================== */

export function isTestDrive() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('testdrive') === '1';
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitUntil(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`等待超时：${label}`));
        return;
      }
      setTimeout(tick, 30);
    };
    tick();
  });
}

function writeTestDrive(status, text) {
  store.autotestMode = true;
  store.autotestStatus = status;
  store.autotestText = text;
  applyAutotestDom(status, text);
}

/**
 * 交互自检：在真实 DOM 上走一遍「选图 → 第一步滑块 → 生成 → 第二步滑块 / 分级控件 → 上一步」，
 * 每次操作后都断言重算确实发生了（而不是假控件）。仅 `?testdrive=1` 时运行。
 */
async function runTestDrive() {
  const lines = [];
  const started = Date.now();

  const record = (label, value) => lines.push(`${label}=${value}`);

  const slider = (id) => document.getElementById(id);
  const setRange = async (id, value) => {
    const el = slider(id);
    if (!el) throw new Error(`找不到滑块 #${id}`);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  try {
    await useSample();
    if (!store.source) throw new Error('示例场景没有加载成功');
    record('source', `${store.source.width}x${store.source.height}`);
    record('palette', store.selectedPaletteId || 'none');
    record('paletteColors', store.paletteColors.length);

    // 第一步：选尺寸 → 结构层重算
    const before1 = store.structureElapsed;
    setPixelSize(80);
    await runStage1();
    if (store.structureElapsed === before1 && store.structureResult.width !== 80) {
      throw new Error('切换像素大小后结构层没有重算');
    }
    record('step1_size80', `${store.structureResult.width}x${store.structureResult.height}`);

    // 第一步：自定义模式 + 滑块 → 结构层重算
    const structureRunsBefore = store.structureElapsed;
    setPipelineMode('legacy');
    await waitUntil(() => store.structureResult && store.pipelineMode === 'legacy', 20000, '自定义模式结构层重算');
    record('step1_legacy', `ok elapsed=${store.structureElapsed}(${structureRunsBefore})`);

    const structureBefore = `${store.structureResult.width}x${store.structureResult.height}`;
    await setRange('structure-colorClean', 6);
    await waitUntil(() => !store.loading && !store.loadingPending, 15000, '颜色简化重算');
    record('step1_colorClean', `value=${store.customAdjustments.colorClean} grid=${structureBefore}`);

    // 生成 → 第二步
    await enterStep2();
    if (store.step !== 2 || !store.matchResult) throw new Error('进入第二步失败');
    record('step2', `${store.matchResult.width}x${store.matchResult.height}`);
    record('step2_colors', store.matchResult.ranked.length);

    // 第二步：标准模式下改「色卡匹配策略」也应重算
    const matchRunsBeforeStrategy = store.matchRunCount;
    setPaletteStrategy('family');
    await waitUntil(() => store.matchRunCount > matchRunsBeforeStrategy, 20000, '色卡匹配策略重算');
    record('step2_strategy_family', `runs=${store.matchRunCount}`);

    // 第二步：切自定义 → 基线档位（要看到匹配层真的重算了一次）
    const runsBeforeCustom = store.matchRunCount;
    setMatchMode('custom');
    await waitUntil(() => store.matchRunCount > runsBeforeCustom, 20000, '自定义匹配重算');
    record('step2_custom', `merge=${store.matchParams.paletteMergeLevel} smooth=${store.matchParams.smoothNoiseLevel}`);

    // 第二步：5 个滑块 + 肤色开关，每个都要真的触发重算
    for (const item of MATCH_ADJUSTMENTS) {
      const runs = store.matchRunCount;
      const probe = item.key === 'saturationLevel' || item.key === 'contrastLevel' ? 118 : 8;
      await setRange(`match-${item.key}`, probe);
      await waitUntil(() => store.matchRunCount > runs, 20000, `滑块 ${item.label} 重算`);
      record(`slider_${item.key}`, `runs=${store.matchRunCount} value=${store.matchParams[item.key]}`);
    }

    const runsBeforeSkin = store.matchRunCount;
    setSkinToneProtection(true);
    await waitUntil(() => store.matchRunCount > runsBeforeSkin, 20000, '肤色保护重算');
    record('switch_skinTone', `runs=${store.matchRunCount} on=${store.enableSkinToneProtection}`);

    // 第二步：抖动下拉
    const runsBeforeDither = store.matchRunCount;
    setDithering('floyd-steinberg');
    await waitUntil(() => store.matchRunCount > runsBeforeDither, 20000, '抖动重算');
    record('select_dithering', `runs=${store.matchRunCount} mode=${store.dithering}`);

    // 第二步改第一步参数：应重跑结构层 + 匹配层
    const runsBeforeCross = store.matchRunCount;
    setPixelSize(104);
    await runStage1();
    await waitUntil(() => store.matchRunCount > runsBeforeCross, 25000, '跨步骤重算');
    record('cross_step_regenerate', `runs=${store.matchRunCount} size=${store.pixelSize}`);

    // 上一步
    backToStep1();
    if (store.step !== 1) throw new Error('上一步没有回到第一步');
    record('back_to_step1', 'ok');

    const vueError = window.__pwVueError;
    if (vueError) throw new Error(`Vue 报错：${vueError.message} @ ${vueError.where}`);

    record('elapsedMs', Date.now() - started);
    writeTestDrive('ok', lines.join('\n'));
    return lines.join('\n');
  } catch (error) {
    const message = (error && error.message) || String(error);
    const logs = (window.__pwConsoleLog || []).filter((line) => line.startsWith('error') || line.startsWith('warn'));
    writeTestDrive(
      'error',
      [
        ...lines,
        `error=${message}`,
        `stack=${shortStack(error)}`,
        logs.length ? `logs=${logs.slice(-3).join(' | ')}` : '',
        '--- diag ---',
        ...store.diag.slice(-30),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return message;
  }
}
