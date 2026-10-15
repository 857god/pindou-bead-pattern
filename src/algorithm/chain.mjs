/**
 * 拼豆图纸算法主链 —— 从 uni-app 页面机械抽取的纯计算版本（Node / 浏览器通用 ESM，零依赖）。
 *
 * - **来源**：`D:/desktop/pindou/pixel-new/pages/smart-pixel-generator/smart-pixel-generator.vue`
 *   （5977 行，Vue Options API。只读引用，未修改源项目任何文件）。
 * - **抽取方式**：由 `demo/full/_extract-chain.mjs` 按行号区间逐行剪切（**不是手抄**）。
 *   每个函数上方保留 `// src: smart-pixel-generator.vue:<start>-<end>`，行号 1-based 闭区间。
 * - **唯一改写**：整块去掉 4 个空格缩进；`this.` → `ctx.`。
 *   没有重命名变量、没有调整逻辑、没有改数值常量、没有重排语句。
 * - **ctx 是什么**：原来的 Vue 实例。所有函数原本就是同一个实例上的 methods / computed，
 *   所以 `this` 就是实例；这里把「data() 默认状态 + computed 取值器 + methods」组装成对象 `ctx`。
 *   computed 以 `get xxx()` 形式搬过来（只有签名前多了 `get `，函数体一字未动）。
 *   `this.` 之外的裸 `this`（`uni.createCanvasContext('tempCanvas', this)`）保持原样：
 *   函数以 `ctx.fn()` 调用时它仍然指向实例。
 *
 * ## 平台 stub（全部是本文件的代码，不属于抽取范围）
 *
 * - `uni.*`：`processImage` 的算法路径依赖 canvas（把源图缩放画进临时画布 → 读回 ImageData）。
 *   这里用纯 JS 离屏画布等价实现 clearRect / drawImage(双线性缩放) / fillRect / draw，
 *   并用 `canvasGetImageData` 返回 `{width, height, data}`。canvas 上下文用 Proxy 代理到 `ctx` 本身，
 *   因此源文件里本来就存在的局部变量名 `ctx`（line 2273 / 4258）不会挡住实例状态，
 *   抽取出来的函数体得以完全保留原样。详见 PORTING-NOTES.md。
 * - `imageAnalyzer`（源文件 `@/utils/image-analyzer.js`）：未随主链搬运。默认 new 管线
 *   `enableSkinToneProtection === false` → `shouldSkipFeatureAnalysis()` 为 true，不会调用它。
 * - `ctx.precisionMatcher`：包装本仓库 `src/palette-matcher.js` 的 `PaletteMatcher`（剪枝 bug 已修），
 *   方法名/返回字段按调用方期望映射：`findNearestPrecise` 返回色卡条目对象，`deltaE` = `deltaE2000`。
 * - 各种缓存（`basePixelCache` 等）用与源文件一致的 Map / 普通对象，不改变读写顺序。
 *
 * 生成命令：`node demo/full/_extract-chain.mjs`
 */

import {
  PaletteMatcher,
  deltaE2000,
  hexToRgb,
  rgbToHex,
  rgbToLab,
  weightedRgbDistance,
} from '../../src/palette-matcher.js';

// ==================== 平台 stub（内联自 _runtime-preamble.js） ====================


// ==================== 平台 stub ====================

/** 离屏画布存储：canvasId -> { width, height, data: Uint8ClampedArray }。 */
const canvasStore = new Map();

/** 双线性采样：按比例把源图读到一个目标矩形里（等价于 canvas drawImage 的缩放绘制）。 */
function blitScaled(source, dst, dstWidth, dx, dy, dw, dh) {
  const srcWidth = source.width;
  const srcHeight = source.height;
  const data = source.data;
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(dstWidth, Math.ceil(dx + dw));
  const y1 = Math.min(dst.length / 4 / dstWidth, Math.ceil(dy + dh));
  for (let y = y0; y < y1; y += 1) {
    const v = ((y + 0.5 - dy) / dh) * srcHeight - 0.5;
    const vy = Math.max(0, Math.min(srcHeight - 1, v));
    const y0i = Math.floor(vy);
    const y1i = Math.min(srcHeight - 1, y0i + 1);
    const fy = vy - y0i;
    for (let x = x0; x < x1; x += 1) {
      const u = ((x + 0.5 - dx) / dw) * srcWidth - 0.5;
      const vx = Math.max(0, Math.min(srcWidth - 1, u));
      const x0i = Math.floor(vx);
      const x1i = Math.min(srcWidth - 1, x0i + 1);
      const fx = vx - x0i;
      const i00 = (y0i * srcWidth + x0i) * 4;
      const i10 = (y0i * srcWidth + x1i) * 4;
      const i01 = (y1i * srcWidth + x0i) * 4;
      const i11 = (y1i * srcWidth + x1i) * 4;
      const o = (y * dstWidth + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const bottom = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        dst[o + c] = top + (bottom - top) * fy;
      }
    }
  }
}

/** 保证画布缓冲区足够大（保持已有内容，新增区域透明）。 */
function ensureCanvas(canvasId, width, height) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  let canvas = canvasStore.get(canvasId);
  if (!canvas) {
    canvas = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    canvasStore.set(canvasId, canvas);
    return canvas;
  }
  if (canvas.width >= w && canvas.height >= h) return canvas;
  const nextWidth = Math.max(canvas.width, w);
  const nextHeight = Math.max(canvas.height, h);
  const next = new Uint8ClampedArray(nextWidth * nextHeight * 4);
  for (let y = 0; y < canvas.height; y += 1) {
    next.set(canvas.data.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), y * nextWidth * 4);
  }
  canvasStore.set(canvasId, { width: nextWidth, height: nextHeight, data: next });
  return canvasStore.get(canvasId);
}

/** 解析 `#rrggbb`（stub 内部用，失败返回黑色）。 */
function parseHexColor(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 0, g: 0, b: 0 };
}

/**
 * 纯 JS 的 canvas 2d 上下文 stub。
 * 用 Proxy 代理到 owner（即链上下文 ctx）：
 *   - 读：canvas API 优先，其余落到 owner（这样源文件里名为 `ctx` 的局部变量不会挡住实例状态）；
 *   - 写：非 canvas 属性写回 owner（`this.pixelData = ...` 这类赋值因此照常生效）。
 */
function createCanvasContextStub(canvasId, owner) {
  const api = {
    fillStyle: '#000000',
    clearRect(x, y, w, h) {
      const canvas = ensureCanvas(canvasId, w, h);
      for (let row = Math.max(0, Math.floor(y)); row < Math.min(canvas.height, Math.ceil(y + h)); row += 1) {
        canvas.data.fill(0, row * canvas.width * 4, (row + 1) * canvas.width * 4);
      }
    },
    drawImage(source, ...args) {
      if (!source || !source.data || !source.width || !source.height) return;
      let dx = 0;
      let dy = 0;
      let dw = source.width;
      let dh = source.height;
      if (args.length >= 4) {
        dx = args[0];
        dy = args[1];
        dw = args[2];
        dh = args[3];
      } else if (args.length === 2) {
        dx = args[0];
        dy = args[1];
      }
      const canvas = ensureCanvas(canvasId, dx + dw, dy + dh);
      blitScaled(source, canvas.data, canvas.width, dx, dy, dw, dh);
    },
    fillRect(x, y, w, h) {
      const color = parseHexColor(api.fillStyle);
      const canvas = ensureCanvas(canvasId, x + w, y + h);
      for (let row = Math.max(0, Math.floor(y)); row < Math.min(canvas.height, Math.ceil(y + h)); row += 1) {
        for (let col = Math.max(0, Math.floor(x)); col < Math.min(canvas.width, Math.ceil(x + w)); col += 1) {
          const o = (row * canvas.width + col) * 4;
          canvas.data[o] = color.r;
          canvas.data[o + 1] = color.g;
          canvas.data[o + 2] = color.b;
          canvas.data[o + 3] = 255;
        }
      }
    },
    draw(reserve, callback) {
      // uni 的 ctx.draw(reserve, callback)：绘制完成（异步）后回调
      if (typeof callback === 'function') setTimeout(callback, 0);
    },
  };
  return new Proxy(owner, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(api, prop)) return api[prop];
      return target[prop];
    },
    set(target, prop, value) {
      if (prop === 'fillStyle') {
        api.fillStyle = value;
        return true;
      }
      target[prop] = value;
      return true;
    },
  });
}

/**
 * uni-app API stub。
 * 主链只用到 createCanvasContext / canvasGetImageData / getImageInfo / showToast，
 * 其余是 UI 路径的占位实现（源文件里 preparePaletteForMatching 之外还会调用，但不在主链上）。
 */
const uni = {
  createCanvasContext(canvasId, owner) {
    return createCanvasContextStub(canvasId, owner || ctx);
  },
  canvasGetImageData(options, owner) {
    const canvas = canvasStore.get(options.canvasId);
    const { x = 0, y = 0, width, height } = options;
    if (!canvas || x + width > canvas.width || y + height > canvas.height) {
      if (typeof options.fail === 'function') options.fail(new Error('canvas stub: 区域超出画布'));
      return;
    }
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const from = ((y + row) * canvas.width + x) * 4;
      data.set(canvas.data.subarray(from, from + width * 4), row * width * 4);
    }
    if (typeof options.success === 'function') options.success({ width, height, data });
  },
  getImageInfo(options) {
    const source = options && options.src;
    if (source && source.width && source.height) {
      if (typeof options.success === 'function') options.success({ width: source.width, height: source.height });
      return;
    }
    if (typeof options.fail === 'function') options.fail(new Error('canvas stub: 只有 { width, height, data } 形式的源图可以取尺寸'));
  },
  showToast() {},
  showLoading() {},
  hideLoading() {},
  getStorageSync() {
    return '';
  },
  setStorageSync() {},
  removeStorageSync() {},
  createSelectorQuery() {
    const query = {
      in() {
        return query;
      },
      select() {
        return query;
      },
      boundingClientRect(callback) {
        if (typeof callback === 'function') callback({ width: 0, height: 0, left: 0, top: 0 });
        return query;
      },
      exec() {},
    };
    return query;
  },
};

/**
 * 源文件 `@/utils/image-analyzer.js` 的 stub：**未随主链搬运**。
 * 默认 new 管线 `enableSkinToneProtection === false` → `shouldSkipFeatureAnalysis()` 为 true，
 * 不会调用这两个方法；显式开启肤色保护时返回 null（见 PORTING-NOTES.md）。
 */
const imageAnalyzer = {
  async analyzeImageFeatures() {
    return null;
  },
  analyzePaletteFeatures() {
    return null;
  },
};

/**
 * `ctx.precisionMatcher`：包装本仓库修好剪枝 bug 的 `PaletteMatcher`。
 * 方法名与返回值按原调用方期望对齐（见 .vue 的 preparePaletteForMatching / findClosestColor）。
 */
export function createPrecisionMatcher() {
  return {
    /** 原实现解析失败返回黑色，这里保持一致 */
    hexToRgb(hex) {
      try {
        return hexToRgb(hex);
      } catch (error) {
        return { r: 0, g: 0, b: 0 };
      }
    },
    rgbToHex(rgb) {
      return rgbToHex(rgb);
    },
    rgbToLab(rgb) {
      return rgbToLab(rgb);
    },
    /** 原方法的 CIEDE2000 实现里色相角未归一化；这里用本仓库验证过的 deltaE2000 */
    deltaE(lab1, lab2) {
      return deltaE2000(lab1, lab2);
    },
    /**
     * 原实现会原地给色卡对象写 `.lab` 并 sort 入参；本匹配器不改写入参。
     * @returns {{ matcher: PaletteMatcher, colors: object[] } | null}
     */
    buildPrecisionKDTree(colors) {
      if (!colors || colors.length === 0) return null;
      return { matcher: new PaletteMatcher(colors), colors };
    },
    /** 原实现返回命中节点（色卡条目对象，含 hex/lab）；这里映射回同一个条目对象。 */
    findNearestPrecise(targetLab, tree) {
      if (!tree || !tree.matcher) return null;
      const found = tree.matcher.nearestByLab(targetLab);
      return found ? found.entry : null;
    },
    /** 加权 RGB（redmean）线性扫描，返回色号 hex，与像素匹配算法一致。 */
    findClosestColorWeighted(targetColor, palette) {
      const target = this.hexToRgb(targetColor);
      let minDistance = Infinity;
      let closestColor = palette[0].hex;
      for (const color of palette) {
        const rgb = this.hexToRgb(color.hex);
        const distance = weightedRgbDistance(target, rgb);
        if (distance < minDistance) {
          minDistance = distance;
          closestColor = color.hex;
          if (distance === 0) break;
        }
      }
      return closestColor;
    },
    /** 便捷入口：按给定色卡做一次精确最近色，返回 { entry, hex, distance, lab } */
    findClosest(color, palette) {
      return new PaletteMatcher(palette).nearest(color);
    },
  };
}

/** 主链上下文状态默认值：逐字来自 .vue 的 data()（见下方 src 标注）。 */
export function createInitialState(overrides = {}) {
  const state = {
    // 步骤控制
    step: 1,
    loading: false,
    loadingText: '处理中...',
    progress: 0,
    // 图片相关
    originalImage: '',
    originalImageWidth: 0,
    originalImageHeight: 0,
    pixelSize: 52, // 默认52
    customPixelSize: '', // 自定义像素大小
    hasSelectedPixelSize: false,
    hasPreviewGenerated: false,
    maxPixelSize: 200,
    sizeOptions: [30, 52, 80, 104, 150],
    pendingAutoPick: false,
    defaultImportPixelSize: 104,
    pixelData: null,
    resultPixelData: null,
    _editorSessionActive: false,
    _editorSessionSnapshot: null,
    _suppressPopstateUntil: 0,
    _editorRestorePending: false,
    // #ifdef H5
    historyInterceptorActive: false, // iOS Safari history拦截器激活状态
    // #endif
    regionMergeLevel: 2,
    combinedStrength: 2,
    colorMergeLevel: 0,
    baseColorCount: 0,
    pipelineMode: 'new',
    customAdjustments: {
      backgroundClean: 0,
      colorClean: 0,
      blockClarity: 0,
      edgeKeep: 0,
      noiseSmooth: 0
    },
    basePixelCache: null,
    colorSimplifyCache: new Map(),
    structureCache: new Map(),
    finalResultCache: new Map(),
    activeGenerateToken: 0,
    customAdjustTimer: null,
    committedLoadingState: null,
    _previewInFlight: false,
    loadingCancelSnapshot: null,
    // 色卡相关
    brands: ['请选择品牌'],
    brandIndex: 0,
    palettes: [{ display: '请先选择品牌' }],
    paletteIndex: 0,
    selectedBrand: '',
    selectedPalette: null,
    paletteColors: [],
    paletteInfoList: [],
    // 智能配置（自动推荐）
    autoConfig: {
      algorithm: 'lab',           // 'weighted' | 'lab'
      dithering: 'none',          // 'floyd-steinberg' | 'atkinson' | 'none' - 默认关闭
      smoothMode: 'light',        // 'none' | 'light' | 'medium' - 默认轻度
      pixelMode: 'default',       // 'default' | 'preserve-edge' | 'smooth' - 边缘处理
      pixelizeMode: 'smart',      // 'smart' | 'smooth' | 'sharp' - 像素化算法
      paletteStrategy: 'nearest', // 'nearest' | 'family' - 色卡匹配策略
      familyPriority: 'medium'    // 'low' | 'medium' | 'high' - 色系优先程度
    },
    // 是否已经做过结构层的自定义配置（第二步或预设/高级结构选项）
    hasCustomStructureConfig: false,
    // 分析结果
    imageFeatures: null,
    paletteFeatures: null,
    analysisResult: '',
    cleanDetailMode: 'balanced',
    matchMode: 'standard',
    hasCustomMatchConfig: false,
    paletteMergeLevel: 0,
    smoothNoiseLevel: 2,
    blockUnityLevel: 0,
    // 调整参数（用于微调）
    saturationLevel: 1.0,
    contrastLevel: 1.0,
    // 画布尺寸
    canvasWidth: 300,
    canvasHeight: 300,
    statusBarHeight: 0,
    navigationBarHeight: 0,
    windowHeight: 667,
    canvasSize: 600,
    // 固定隐藏 canvas 尺寸，避免 App 端动态 resize 未同步导致取到旧画布内容。
    tempCanvasWidth: 640,
    tempCanvasHeight: 640,
    contentPixelWidth: 50,
    contentPixelHeight: 50,
    // 核心工具（复用老算法）
    precisionMatcher: null,
    labKDTree: null,
    paletteColorsLab: [],
    currentPalette: [],
    palettePreparationCache: new Map(),
    colorCache: new Map(),
    matchColorMapCache: new Map(),
    baseMatchResultCache: new Map(),
    skinToneCache: new Map(),  // 肤色检测缓存（性能优化）
    // 性能统计
    matchStats: {
      totalPixels: 0,
      cacheHits: 0,
      matchTime: 0
    },
    performanceTrace: null,
    lastPerformanceReport: null,
    // 横屏检测
    isLandscape: false,
    // 上次选择的色卡
    lastPaletteSelection: null,
    // 防抖定时器
    saturationTimer: null,
    contrastTimer: null,
    // 肤色保护
    enableSkinToneProtection: false,
    // 当前预设类型（默认为智能推荐）
    currentPresetType: 'default',
    // 智能推荐文本（基于特征的配置详情）
    // 预设模式选项（智能推荐作为第一项）
    presetModeOptions: [
      { value: 'default', label: '默认配置' },
      { value: 'portrait-high', label: '特写人像' },
      { value: 'portrait-medium', label: '远景人像' },
      { value: 'photo', label: '普通照片' },
      { value: 'illustration-character', label: '插画人物' },
      { value: 'illustration', label: '插画/动漫' },
      { value: 'icon', label: '图标/Logo' }
    ]
  };
  // 以下成员不是 data() 字段，而是本移植层补的 stub（见文件头说明）
  state.precisionMatcher = createPrecisionMatcher();
  /**
   * `doDrawResult` 的 stub（源文件 4246-4301）——**唯一一个无法逐字搬运的主链函数**。
   * 原因：它函数体里 `const ctx = uni.createCanvasContext(canvasId, this)`（4258）与实例 `ctx` 同名、
   * 且在同一个函数作用域内，逐字搬运后前面的 `ctx.canvasWidth` 会落在 TDZ 上。
   * 它是纯 UI 绘制（把匹配结果画到 canvas），不影响主链结果，这里用等价绘制实现（画到 stub 画布，无 DOM 副作用）。
   */
  state.doDrawResult = function doDrawResult(canvasId) {
    const id = canvasId || (ctx.step === 1 ? 'previewCanvas' : 'matchedCanvas');
    console.log('执行实际绘制...（stub）');
    const grid = ctx.resultPixelData;
    if (!grid || !Array.isArray(grid) || grid.length === 0) {
      console.error('doDrawResult: resultPixelData 无效');
      return;
    }
    const cellWidth = ctx.canvasWidth / ctx.contentPixelWidth;
    const cellHeight = ctx.canvasHeight / ctx.contentPixelHeight;
    const canvasCtx = createCanvasContextStub(id, ctx);
    canvasCtx.clearRect(0, 0, ctx.canvasWidth, ctx.canvasHeight);
    for (let y = 0; y < grid.length; y += 1) {
      if (!grid[y]) continue;
      for (let x = 0; x < grid[y].length; x += 1) {
        const color = grid[y][x];
        if (color === null || color === undefined) continue;
        canvasCtx.fillStyle = color;
        canvasCtx.fillRect(Math.floor(x * cellWidth), Math.floor(y * cellHeight), Math.ceil(cellWidth + 0.5), Math.ceil(cellHeight + 0.5));
      }
    }
    canvasCtx.draw(false, () => {
      console.log('canvas 绘制完成');
    });
  };
  return Object.assign(state, overrides);
}

// ==================== 外部算法模块（.vue 里 import 的纯计算依赖） ====================

// src: utils/color-quantizer.js:9-14
function colorDistance(c1, c2) {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// src: utils/color-quantizer.js:23-77
function kMeansClustering(colors, k, maxIterations = 10) {
  if (colors.length <= k) return colors;
  
  // 初始化聚类中心（随机选择）
  const centers = [];
  const step = Math.floor(colors.length / k);
  for (let i = 0; i < k; i++) {
centers.push({ ...colors[i * step] });
  }
  
  for (let iter = 0; iter < maxIterations; iter++) {
// 分配每个颜色到最近的聚类中心
const clusters = Array.from({ length: k }, () => []);

for (const color of colors) {
  let minDist = Infinity;
  let bestCluster = 0;
  
  for (let i = 0; i < k; i++) {
    const dist = colorDistance(color, centers[i]);
    if (dist < minDist) {
      minDist = dist;
      bestCluster = i;
    }
  }
  
  clusters[bestCluster].push(color);
}

// 更新聚类中心
let changed = false;
for (let i = 0; i < k; i++) {
  if (clusters[i].length === 0) continue;
  
  const avgR = clusters[i].reduce((sum, c) => sum + c.r, 0) / clusters[i].length;
  const avgG = clusters[i].reduce((sum, c) => sum + c.g, 0) / clusters[i].length;
  const avgB = clusters[i].reduce((sum, c) => sum + c.b, 0) / clusters[i].length;
  
  const newCenter = {
    r: Math.round(avgR),
    g: Math.round(avgG),
    b: Math.round(avgB)
  };
  
  if (colorDistance(centers[i], newCenter) > 1) {
    centers[i] = newCenter;
    changed = true;
  }
}

if (!changed) break;
  }
  
  return centers;
}

// src: utils/color-quantizer.js:85-163
export function quantizeColors(pixelData, maxColors = 64) {
  console.log('开始色彩量化，目标颜色数:', maxColors);
  
  // 收集所有非空颜色
  const colorMap = new Map();
  const colorList = [];
  
  for (let y = 0; y < pixelData.length; y++) {
for (let x = 0; x < pixelData[y].length; x++) {
  const hex = pixelData[y][x];
  if (!hex) continue;
  
  if (!colorMap.has(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const color = { r, g, b, hex };
    colorMap.set(hex, color);
    colorList.push(color);
  }
}
  }
  
  console.log('原始颜色数:', colorList.length);
  
  // 如果颜色数已经少于目标，直接返回
  if (colorList.length <= maxColors) {
console.log('颜色数已满足要求，跳过量化');
return pixelData;
  }
  
  // K-means聚类
  const centers = kMeansClustering(colorList, maxColors);
  console.log('聚类完成，聚类中心数:', centers.length);
  
  // 构建颜色映射表
  const colorMapping = new Map();
  for (const [hex, color] of colorMap) {
let minDist = Infinity;
let bestCenter = centers[0];

for (const center of centers) {
  const dist = colorDistance(color, center);
  if (dist < minDist) {
    minDist = dist;
    bestCenter = center;
  }
}

const newHex = '#' + ((1 << 24) + (bestCenter.r << 16) + (bestCenter.g << 8) + bestCenter.b).toString(16).slice(1).toUpperCase();
colorMapping.set(hex, newHex);
  }
  
  // 应用颜色映射
  const result = [];
  for (let y = 0; y < pixelData.length; y++) {
const row = [];
for (let x = 0; x < pixelData[y].length; x++) {
  const hex = pixelData[y][x];
  if (!hex) {
    row.push(null);
  } else {
    row.push(colorMapping.get(hex) || hex);
  }
}
result.push(row);
  }
  
  // 统计最终颜色数
  const finalColors = new Set();
  for (const row of result) {
for (const hex of row) {
  if (hex) finalColors.add(hex);
}
  }
  console.log('量化后颜色数:', finalColors.size);
  
  return result;
}

/** 原始 Vue 实例上的全部方法（methods + computed），逐字抽取。 */
export const chainMethods = {
  // src: smart-pixel-generator.vue:579-587（computed）
  get previewDisplayMax() {
    const h = ctx.windowHeight || 667;
    const nav = ctx.navigationBarHeight || 88;
    const cardPadding = 20;
    if (ctx.isLandscape) {
      return Math.max(88, Math.floor(h * 0.5 - nav - cardPadding));
    }
    return Math.max(120, Math.floor(h * 0.32 - nav - cardPadding));
  },

  // src: smart-pixel-generator.vue:619-622（computed）
  get tempCanvasSize() {
    const size = ctx.pixelSize || 52;
    return Math.max(240, Math.min(600, size * 6));
  },

  // src: smart-pixel-generator.vue:645-647（computed）
  get activePaletteMergeLevel() {
    return ctx.matchMode === 'custom' ? ctx.paletteMergeLevel : ctx.getStandardMatchBaseline().paletteMergeLevel;
  },

  // src: smart-pixel-generator.vue:649-651（computed）
  get activeSmoothNoiseLevel() {
    return ctx.matchMode === 'custom' ? ctx.smoothNoiseLevel : ctx.getStandardMatchBaseline().smoothNoiseLevel;
  },

  // src: smart-pixel-generator.vue:653-655（computed）
  get activeBlockUnityLevel() {
    return ctx.matchMode === 'custom' ? ctx.blockUnityLevel : ctx.getStandardMatchBaseline().blockUnityLevel;
  },

  // src: smart-pixel-generator.vue:662-664（computed）
  get activeSaturationLevel() {
    return ctx.matchMode === 'custom' ? ctx.saturationLevel : ctx.getStandardMatchBaseline().saturationLevel;
  },

  // src: smart-pixel-generator.vue:666-668（computed）
  get activeContrastLevel() {
    return ctx.matchMode === 'custom' ? ctx.contrastLevel : ctx.getStandardMatchBaseline().contrastLevel;
  },

  // src: smart-pixel-generator.vue:670-672（computed）
  get activeSkinToneProtection() {
    return ctx.matchMode === 'custom' ? ctx.enableSkinToneProtection : ctx.getStandardMatchBaseline().enableSkinToneProtection;
  },

  // src: smart-pixel-generator.vue:1052-1058
  getSizeTier(size = ctx.pixelSize) {
    const maxSide = Number(size) || 52;
    if (maxSide < 64) return 'small';
    if (maxSide < 104) return 'medium';
    if (maxSide < 150) return 'large';
    return 'xlarge';
  },

  // src: smart-pixel-generator.vue:1060-1098
  getStandardBaseline(size = ctx.pixelSize) {
    const maxSide = Number(size) || 52;
    const tier = ctx.getSizeTier(size);
    const baselines = {
      small: {
        backgroundClean: 2,
        colorClean: 2,
        blockClarity: 2,
        edgeKeep: 2,
        noiseSmooth: 1
      },
      medium: {
        backgroundClean: 1,
        colorClean: 0,
        blockClarity: 1,
        edgeKeep: 1,
        noiseSmooth: 1
      },
      large: {
        backgroundClean: 0,
        colorClean: 0,
        blockClarity: 1,
        edgeKeep: 1,
        noiseSmooth: 0
      },
      xlarge: {
        backgroundClean: 0,
        colorClean: 0,
        blockClarity: 0,
        edgeKeep: 0,
        noiseSmooth: 0
      }
    };

    const baseline = { ...(baselines[tier] || baselines.medium) };
    // 标准模式：颜色简化仅 52 及以下默认开启（等级 2），更大尺寸默认关闭
    baseline.colorClean = maxSide <= 52 ? 2 : 0;
    return baseline;
  },

  // src: smart-pixel-generator.vue:1100-1122
  getEffectiveStructureSettings() {
    const base = ctx.getStandardBaseline();
    const custom = ctx.pipelineMode === 'legacy' ? (ctx.customAdjustments || {}) : {};
    const add = (key) => Math.max(0, Math.min(10, (base[key] || 0) + (custom[key] || 0)));
    const backgroundClean = add('backgroundClean');
    const colorClean = add('colorClean');
    const blockClarity = add('blockClarity');
    const edgeKeep = add('edgeKeep');
    const noiseSmooth = add('noiseSmooth');

    return {
      backgroundClean,
      colorClean,
      blockClarity,
      edgeKeep,
      noiseSmooth,
      regionMergeLevel: ctx.mapBackgroundCleanToRegionLevel(backgroundClean),
      colorMergeLevel: ctx.mapColorCleanToMergeLevel(colorClean),
      blockClarityRatio: blockClarity / 10,
      edgeKeepRatio: edgeKeep / 10,
      smoothIterations: ctx.mapNoiseSmoothToIterations(noiseSmooth)
    };
  },

  // src: smart-pixel-generator.vue:1124-1132
  applyStructureConfigFromAdjustments() {
    const settings = ctx.getEffectiveStructureSettings();
    ctx.regionMergeLevel = settings.regionMergeLevel;
    ctx.colorMergeLevel = settings.colorMergeLevel;
    ctx.combinedStrength = settings.backgroundClean;
    ctx.autoConfig.smoothMode = settings.noiseSmooth >= 7 ? 'medium' : (settings.noiseSmooth > 0 ? 'light' : 'none');
    console.log('结构配置:', settings);
    return settings;
  },

  // src: smart-pixel-generator.vue:1134-1137
  mapBackgroundCleanToRegionLevel(value) {
    if (value <= 0) return 0;
    return Math.max(1, Math.min(20, Math.round(value * 1.2)));
  },

  // src: smart-pixel-generator.vue:1139-1149
  mapColorCleanToMergeLevel(value) {
    const tier = ctx.getSizeTier();
    const maxByTier = {
      small: 10,
      medium: 8,
      large: 5,
      xlarge: 3
    };
    const maxLevel = maxByTier[tier] || 5;
    return Math.max(0, Math.min(maxLevel, Math.round(value)));
  },

  // src: smart-pixel-generator.vue:1151-1155
  mapNoiseSmoothToIterations(value) {
    if (value >= 7) return 2;
    if (value >= 3) return 1;
    return 0;
  },

  // src: smart-pixel-generator.vue:1157-1164
  getCacheLimitForSize(size = ctx.pixelSize) {
    const maxSide = Number(size) || 52;
    if (maxSide < 64) return 5;
    if (maxSide < 104) return 4;
    if (maxSide < 150) return 3;
    if (maxSide < 200) return 2;
    return 1;
  },

  // src: smart-pixel-generator.vue:1166-1172
  getMatchColorCacheLimitForSize(size = ctx.pixelSize) {
    const maxSide = Number(size) || 52;
    if (maxSide < 64) return 30000;
    if (maxSide < 104) return 50000;
    if (maxSide < 150) return 40000;
    return 25000;
  },

  // src: smart-pixel-generator.vue:1174-1177
  clonePixelGrid(pixelData) {
    if (!pixelData || !Array.isArray(pixelData)) return null;
    return pixelData.map(row => Array.isArray(row) ? row.slice() : row);
  },

  // src: smart-pixel-generator.vue:1179-1189
  getBaseCacheKey() {
    const dims = ctx.getTargetPixelDimensions();
    return [
      ctx.originalImage || '',
      ctx.originalImageWidth || 0,
      ctx.originalImageHeight || 0,
      dims.width,
      dims.height,
      ctx.pixelSize || 0
    ].join('|');
  },

  // src: smart-pixel-generator.vue:1191-1201
  getStructureCacheKey(settings = ctx.getEffectiveStructureSettings()) {
    return [
      ctx.getBaseCacheKey(),
      ctx.pipelineMode,
      settings.regionMergeLevel,
      settings.colorMergeLevel,
      settings.blockClarity,
      settings.edgeKeep,
      settings.noiseSmooth
    ].join('|');
  },

  // src: smart-pixel-generator.vue:1203-1210
  getColorSimplifyCacheKey(settings = ctx.getEffectiveStructureSettings()) {
    return [
      ctx.getBaseCacheKey(),
      ctx.pipelineMode,
      'color-v1',
      settings.colorMergeLevel || 0
    ].join('|');
  },

  // src: smart-pixel-generator.vue:1212-1249
  getStandardMatchBaseline() {
    const tier = ctx.getSizeTier();
    const baseline = {
      small: {
        paletteMergeLevel: 1,
        smoothNoiseLevel: 1,
        blockUnityLevel: 2,
        saturationLevel: 1.0,
        contrastLevel: 1.0,
        enableSkinToneProtection: false
      },
      medium: {
        paletteMergeLevel: 1,
        smoothNoiseLevel: 2,
        blockUnityLevel: 3,
        saturationLevel: 1.0,
        contrastLevel: 1.0,
        enableSkinToneProtection: false
      },
      large: {
        paletteMergeLevel: 3,
        smoothNoiseLevel: 3,
        blockUnityLevel: 4,
        saturationLevel: 1.0,
        contrastLevel: 1.0,
        enableSkinToneProtection: false
      },
      xlarge: {
        paletteMergeLevel: 2,
        smoothNoiseLevel: 2,
        blockUnityLevel: 3,
        saturationLevel: 1.0,
        contrastLevel: 1.0,
        enableSkinToneProtection: false
      }
    };
    return baseline[tier] || baseline.medium;
  },

  // src: smart-pixel-generator.vue:1261-1278
  getFinalCacheKey() {
    return [
      ctx.getStructureCacheKey(),
      ctx.selectedBrand || '',
      ctx.selectedPalette ? ctx.selectedPalette.palette_code : '',
      ctx.matchMode,
      ctx.autoConfig.paletteStrategy,
      ctx.autoConfig.familyPriority,
      ctx.autoConfig.algorithm,
      ctx.autoConfig.dithering,
      ctx.activeSmoothNoiseLevel,
      ctx.activeBlockUnityLevel,
      ctx.activePaletteMergeLevel,
      ctx.activeSaturationLevel,
      ctx.activeContrastLevel,
      ctx.activeSkinToneProtection ? 1 : 0
    ].join('|');
  },

  // src: smart-pixel-generator.vue:1280-1294
  getBaseMatchCacheKey(palette, pixels = ctx.pixelData) {
    const dims = pixels && pixels.length ? `${pixels[0] ? pixels[0].length : 0}x${pixels.length}` : '0x0';
    return [
      ctx.getStructureCacheKey(),
      dims,
      ctx.getPaletteCacheKey(palette),
      ctx.autoConfig.paletteStrategy,
      ctx.autoConfig.familyPriority,
      ctx.autoConfig.algorithm,
      ctx.activeSaturationLevel,
      ctx.activeContrastLevel,
      ctx.activeSkinToneProtection ? 1 : 0,
      ctx.shouldUseFastPaletteCache() ? 'fast' : 'exact'
    ].join('|');
  },

  // src: smart-pixel-generator.vue:1296-1304
  setLimitedCache(cache, key, value, limit = ctx.getCacheLimitForSize()) {
    if (!cache || !key) return;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  },

  // src: smart-pixel-generator.vue:1306-1320
  startPerformanceTrace(type = 'generate') {
    const dims = ctx.getTargetPixelDimensions();
    ctx.performanceTrace = {
      type,
      startedAt: Date.now(),
      size: ctx.pixelSize || 0,
      target: `${dims.width}x${dims.height}`,
      original: `${ctx.originalImageWidth || 0}x${ctx.originalImageHeight || 0}`,
      mode: ctx.pipelineMode,
      tier: ctx.getSizeTier(),
      palette: ctx.selectedPalette ? ctx.selectedPalette.palette_code : '',
      stages: {},
      notes: []
    };
  },

  // src: smart-pixel-generator.vue:1322-1333
  recordPerformanceStage(name, duration, extra = null) {
    if (!ctx.performanceTrace || !name) return;
    const value = Math.max(0, Math.round(duration || 0));
    const stage = ctx.performanceTrace.stages[name] || { total: 0, count: 0 };
    stage.total += value;
    stage.count += 1;
    stage.last = value;
    if (extra) {
      stage.extra = extra;
    }
    ctx.performanceTrace.stages[name] = stage;
  },

  // src: smart-pixel-generator.vue:1335-1338
  addPerformanceNote(note, data = null) {
    if (!ctx.performanceTrace || !note) return;
    ctx.performanceTrace.notes.push(data ? { note, data } : note);
  },

  // src: smart-pixel-generator.vue:1340-1348
  updatePerformanceTraceImageMeta() {
    if (!ctx.performanceTrace) return;
    const dims = ctx.getTargetPixelDimensions();
    ctx.performanceTrace.size = ctx.pixelSize || 0;
    ctx.performanceTrace.target = `${dims.width}x${dims.height}`;
    ctx.performanceTrace.original = `${ctx.originalImageWidth || 0}x${ctx.originalImageHeight || 0}`;
    ctx.performanceTrace.mode = ctx.pipelineMode;
    ctx.performanceTrace.tier = ctx.getSizeTier();
  },

  // src: smart-pixel-generator.vue:1350-1377
  finishPerformanceTrace() {
    if (!ctx.performanceTrace) return;
    const slowStages = Object.keys(ctx.performanceTrace.stages)
      .map(name => ({
        name,
        total: ctx.performanceTrace.stages[name].total,
        count: ctx.performanceTrace.stages[name].count
      }))
      .filter(stage => stage.total >= 300)
      .sort((a, b) => b.total - a.total);
    const report = {
      ...ctx.performanceTrace,
      total: Date.now() - ctx.performanceTrace.startedAt,
      slowStages,
      caches: {
        colorSimplify: ctx.colorSimplifyCache.size,
        structure: ctx.structureCache.size,
        final: ctx.finalResultCache.size,
        baseMatch: ctx.baseMatchResultCache.size,
        colorMaps: ctx.matchColorMapCache.size,
        currentColorMap: ctx.colorCache ? ctx.colorCache.size : 0
      }
    };

    ctx.lastPerformanceReport = report;
    console.log('像素生成性能报告:', report);
    ctx.performanceTrace = null;
  },

  // src: smart-pixel-generator.vue:1687-1707
  ensureOriginalImageInfo() {
    if (!ctx.originalImage || (ctx.originalImageWidth && ctx.originalImageHeight)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      uni.getImageInfo({
        src: ctx.originalImage,
        success: (info) => {
          ctx.originalImageWidth = info.width;
          ctx.originalImageHeight = info.height;
          console.log('图片尺寸:', info.width, 'x', info.height);
          resolve();
        },
        fail: (e) => {
          console.warn('获取图片尺寸失败，使用 canvas 尺寸兜底:', e);
          resolve();
        }
      });
    });
  },

  // src: smart-pixel-generator.vue:1709-1716
  getTargetPixelDimensions() {
    const board = ctx.pixelSize || 52;
    // 方板：最长边铺满 board，短边居中留空（processImage letterbox → null）
    return {
      width: board,
      height: board
    };
  },

  // src: smart-pixel-generator.vue:1718-1746
  getCanvasImageDataWithRetry(canvasId, width, height, maxRetries = 3) {
    const read = (attempt) => new Promise((resolve, reject) => {
      uni.canvasGetImageData({
        canvasId,
        x: 0,
        y: 0,
        width,
        height,
        success: (res) => {
          if (res.width === width && res.height === height) {
            resolve(res);
            return;
          }

          if (attempt >= maxRetries) {
            reject(new Error(`canvasGetImageData 尺寸异常: ${res.width}x${res.height}, 期望 ${width}x${height}`));
            return;
          }

          setTimeout(() => {
            read(attempt + 1).then(resolve).catch(reject);
          }, 16);
        },
        fail: reject
      }, this);
    });

    return read(0);
  },

  // src: smart-pixel-generator.vue:2013-2133
  async generatePixelArt() {
    const totalStart = Date.now();
    if (!ctx.hasSelectedPixelSize) {
      uni.showToast({
        title: '请先选择板子大小',
        icon: 'none'
      });
      return;
    }

    // 检查是否选择了色卡
    if (!ctx.selectedPalette) {
      uni.showToast({
        title: '请先选择色卡',
        icon: 'none'
      });
      return;
    }
    
    console.log('\n=== 开始智能生成像素图 ===');
    console.log('图片:', ctx.originalImage);
    console.log('像素大小:', ctx.pixelSize);
    console.log('色卡颜色数:', ctx.paletteColors.length);
    
    ctx.loading = true;
    ctx.startPerformanceTrace('generate');
    ctx.applyStructureConfigFromAdjustments();
    const skipFeatureAnalysis = ctx.shouldSkipFeatureAnalysis();
    ctx.loadingText = skipFeatureAnalysis ? '正在生成像素图...' : '正在分析图片特征...';
    ctx.progress = 10;
    const token = ++ctx.activeGenerateToken;
    
    try {
      let stageStart = Date.now();

      if (skipFeatureAnalysis) {
        console.log('快速生成：跳过图片/色卡特征分析');
        ctx.imageFeatures = null;
        ctx.paletteFeatures = null;
        ctx.progress = 45;
      } else {
        // 1. 分析图片特征（用于肤色检测等，可选）
        console.log('\n步骤1: 分析图片特征');
        ctx.imageFeatures = await ctx.analyzeImage();
        if (token !== ctx.activeGenerateToken) return;
        const imageAnalyzeTime = Date.now() - stageStart;
        ctx.recordPerformanceStage('图片分析', imageAnalyzeTime);
        console.log('耗时-图片分析:', imageAnalyzeTime, 'ms');
        console.log('图片特征分析完成:', ctx.imageFeatures);
        ctx.progress = 30;

        // 2. 分析色卡特征（仅记录，不自动改配置）
        console.log('\n分析色卡特征');
        ctx.loadingText = '正在分析色卡特征...';
        stageStart = Date.now();
        ctx.paletteFeatures = ctx.analyzePalette();
        const paletteAnalyzeTime = Date.now() - stageStart;
        ctx.recordPerformanceStage('色卡分析', paletteAnalyzeTime);
        console.log('耗时-色卡分析:', paletteAnalyzeTime, 'ms');
        console.log('色卡特征分析完成:', ctx.paletteFeatures);
        ctx.progress = 50;
      }
      
      // 3. 生成像素图（结构层固定使用当前配置）
      console.log('\n生成像素图');
      ctx.loadingText = '正在生成像素图...';
      stageStart = Date.now();
      if (!ctx.hasPreviewGenerated || !ctx.pixelData) {
        await ctx.processImage(token);
        if (token !== ctx.activeGenerateToken) return;
        ctx.hasPreviewGenerated = true;
      } else {
        ctx.addPerformanceNote('复用已有像素预览');
      }
      const pixelizeTime = Date.now() - stageStart;
      ctx.recordPerformanceStage('像素化总段', pixelizeTime);
      console.log('耗时-像素化:', pixelizeTime, 'ms');
      console.log('像素图生成完成，数据:', ctx.pixelData ? `${ctx.pixelData.length}x${ctx.pixelData[0]?.length}` : 'null');
      ctx.progress = 80;
      
      // 4. 匹配色卡颜色
      console.log('\n匹配色卡颜色');
      ctx.loadingText = '正在匹配色卡颜色...';
      stageStart = Date.now();
      const matched = await ctx.matchColors(token);
      if (!matched || token !== ctx.activeGenerateToken) return;
      const matchTime = Date.now() - stageStart;
      ctx.recordPerformanceStage('色卡匹配总段', matchTime);
      console.log('耗时-色卡匹配:', matchTime, 'ms');
      console.log('颜色匹配完成，结果:', ctx.resultPixelData ? `${ctx.resultPixelData.length}x${ctx.resultPixelData[0]?.length}` : 'null');
      ctx.progress = 100;
      
      // 5. 计算实际内容区域
      console.log('\n步骤5: 计算内容区域');
      ctx.calculateContentArea();
      
      // 6. 切换到步骤2
      console.log('\n步骤6: 切换到结果页');
      ctx.step = 2;

      console.log('耗时-总生成:', Date.now() - totalStart, 'ms');
      ctx.finishPerformanceTrace();
      console.log('=== 生成流程完成 ===\n');
      
    } catch (e) {
      console.error('生成失败，详细错误:', e);
      console.error('错误堆栈:', e.stack);
      if (token === ctx.activeGenerateToken) {
        ctx.loading = false;
        uni.showToast({
          title: '生成失败: ' + (e.message || '未知错误'),
          icon: 'none',
          duration: 3000
        });
      }
    } finally {
      if (token === ctx.activeGenerateToken) {
        ctx.loading = false;
      }
    }
  },

  // src: smart-pixel-generator.vue:2136-2141
  async analyzeImage() {
    // imageAnalyzer imported at top of script
    const features = await imageAnalyzer.analyzeImageFeatures(ctx.originalImage, 100);
    console.log('图片特征:', features);
    return features;
  },

  // src: smart-pixel-generator.vue:2144-2149
  analyzePalette() {
    // imageAnalyzer imported at top of script
    const features = imageAnalyzer.analyzePaletteFeatures(ctx.paletteColors);
    console.log('色卡特征:', features);
    return features;
  },

  // src: smart-pixel-generator.vue:2197-2228
  getPresetDescription(presetType) {
    let presetName = '';
    
    switch (presetType) {
      case 'portrait-high':
        presetName = ' 特写人像模式';
        break;
      case 'portrait-medium':
        presetName = '� 远景人像模式';
        break;
      case 'illustration-character':
        presetName = ' 插画人物模式';
        break;
      case 'icon':
        presetName = ' 图标模式';
        break;
      case 'illustration':
        presetName = ' 插画模式';
        break;
      case 'photo':
        presetName = ' 照片模式';
        break;
      default:
        presetName = '⚖️ 平衡模式';
        break;
    }
    
    const satInfo = ctx.saturationLevel !== 1.0 ? ` | 饱和度${Math.round(ctx.saturationLevel * 100)}%` : '';
    const contrastInfo = ctx.contrastLevel !== 1.0 ? ` | 对比度${Math.round(ctx.contrastLevel * 100)}%` : '';
    
    return `${presetName}${satInfo}${contrastInfo}`;
  },

  // src: smart-pixel-generator.vue:2231-2235
  updateDescription() {
    // 使用缓存的预设类型，避免重复判断
    // 因为用户手动调整参数后，预设类型不应该改变
    ctx.analysisResult = ctx.getPresetDescription(ctx.currentPresetType);
  },

  // src: smart-pixel-generator.vue:2238-2366
  async processImage(activeToken = null) {
    const startTime = Date.now();
    console.log('开始处理图片...');
    await ctx.ensureOriginalImageInfo();
    if (activeToken && activeToken !== ctx.activeGenerateToken) return;
    ctx.updatePerformanceTraceImageMeta();
    console.log('原始图片尺寸:', ctx.originalImageWidth, 'x', ctx.originalImageHeight);
    console.log('输出像素大小:', ctx.pixelSize);

    const targetDims = ctx.getTargetPixelDimensions();
    const scaleFactor = Math.max(1, Math.round(ctx.tempCanvasSize / ctx.pixelSize));
    const processWidth = Math.max(targetDims.width, targetDims.width * scaleFactor);
    const processHeight = Math.max(targetDims.height, targetDims.height * scaleFactor);
    const canvasWidth = ctx.tempCanvasWidth;
    const canvasHeight = ctx.tempCanvasHeight;
    const baseKey = ctx.getBaseCacheKey();

    if (ctx.basePixelCache && ctx.basePixelCache.key === baseKey && ctx.basePixelCache.pixels) {
      if (activeToken && activeToken !== ctx.activeGenerateToken) return;
      console.log('命中原始降采样底稿缓存');
      ctx.addPerformanceNote('命中降采样底稿缓存');
      const cacheStructureStart = Date.now();
      ctx.pixelData = ctx.buildStructurePixelsFromBase();
      ctx.recordPerformanceStage('结构派生', Date.now() - cacheStructureStart, {
        fromCache: true
      });
      const cacheProcessTime = Date.now() - startTime;
      ctx.recordPerformanceStage('processImage总计', cacheProcessTime, {
        fromBaseCache: true
      });
      console.log('耗时-processImage总计:', cacheProcessTime, 'ms');
      return;
    }
    
    return new Promise((resolve, reject) => {
      const ctx = uni.createCanvasContext('tempCanvas', this);
      
      console.log('canvas 尺寸:', canvasWidth, 'x', canvasHeight, '处理区域:', processWidth, 'x', processHeight, '目标像素:', targetDims.width, 'x', targetDims.height);
      
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      
      // 防御：如果尚未取到原图尺寸，使用画布尺寸兜底，避免除以 0
      let srcW = ctx.originalImageWidth;
      let srcH = ctx.originalImageHeight;
      if (!srcW || !srcH) {
        console.warn('processImage: 原始尺寸未就绪，使用 canvas 尺寸兜底');
        srcW = processWidth;
        srcH = processHeight;
      }

      // 按原图比例绘制到矩形画布，长边等于用户选择的板子大小，短边按比例缩小。
      const scale = Math.min(processWidth / srcW, processHeight / srcH);
      const scaledWidth = srcW * scale;
      const scaledHeight = srcH * scale;
      const offsetX = (processWidth - scaledWidth) / 2;
      const offsetY = (processHeight - scaledHeight) / 2;
      
      console.log('缩放信息:', { scale, scaledWidth, scaledHeight, offsetX, offsetY });

      if (activeToken && activeToken !== ctx.activeGenerateToken) {
        resolve();
        return;
      }
      
      ctx.drawImage(ctx.originalImage, offsetX, offsetY, scaledWidth, scaledHeight);
      
      ctx.draw(false, async () => {
        try {
          const imageDataStart = Date.now();
          const res = await ctx.getCanvasImageDataWithRetry('tempCanvas', processWidth, processHeight);
          if (activeToken && activeToken !== ctx.activeGenerateToken) {
            resolve();
            return;
          }
          ctx.recordPerformanceStage('canvas取图', Date.now() - imageDataStart, {
            read: `${processWidth}x${processHeight}`,
            canvas: `${canvasWidth}x${canvasHeight}`
          });
          console.log('提取数据成功:', res.width, 'x', res.height, '数据长度:', res.data.length);

          try {
            const srcWidth = res.width;
            const srcHeight = res.height;
            const imageData = res.data;
            let basePixels;
            const downsampleStart = Date.now();
            if (ctx.shouldUseFastSamplingPipeline()) {
              const rgbPixels = ctx.simpleDownsampleRgb(imageData, srcWidth, srcHeight, targetDims.width, targetDims.height);

              basePixels = ctx.rgbGridToHexGrid(rgbPixels);
              console.log('像素化完成（新管线）:', basePixels ? `${basePixels.length}x${basePixels[0].length}` : 'null');
            } else {
              basePixels = ctx.pixelizeImageData(imageData, processWidth, targetDims.width, processHeight, targetDims.height);
              console.log('像素化完成（经典管线）:', basePixels ? `${basePixels.length}x${basePixels[0].length}` : 'null');
            }
            ctx.recordPerformanceStage('降采样计算', Date.now() - downsampleStart, {
              output: `${targetDims.width}x${targetDims.height}`,
              input: `${srcWidth}x${srcHeight}`
            });

            if (activeToken && activeToken !== ctx.activeGenerateToken) {
              resolve();
              return;
            }

            ctx.pixelData = basePixels;
            ctx.basePixelCache = {
              key: baseKey,
              pixels: ctx.clonePixelGrid(ctx.pixelData)
            };
            const mergeStart = Date.now();
            ctx.pixelData = ctx.buildStructurePixelsFromBase();
            const structureTime = Date.now() - mergeStart;
            ctx.recordPerformanceStage('结构派生', structureTime);
            const processTotal = Date.now() - startTime;
            ctx.recordPerformanceStage('processImage总计', processTotal);
            console.log('耗时-结构派生:', structureTime, 'ms');
            console.log('耗时-processImage总计:', processTotal, 'ms');
            resolve();
          } catch (error) {
            console.error('processImage 像素化失败:', error);
            reject(error);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  },

  // src: smart-pixel-generator.vue:2375-2377
  shouldSkipFeatureAnalysis() {
    return !ctx.enableSkinToneProtection;
  },

  // src: smart-pixel-generator.vue:2379-2381
  shouldUseFastSamplingPipeline() {
    return true;
  },

  // src: smart-pixel-generator.vue:2383-2402
  rgbGridToHexGrid(rgbPixels) {
    const hexData = [];
    for (let y = 0; y < rgbPixels.length; y++) {
      const row = rgbPixels[y];
      const hexRow = new Array(row.length);
      for (let x = 0; x < row.length; x++) {
        const p = row[x];
        if (!p) {
          hexRow[x] = null;
        } else {
          const r = Math.max(0, Math.min(255, Math.round(p.r)));
          const g = Math.max(0, Math.min(255, Math.round(p.g)));
          const b = Math.max(0, Math.min(255, Math.round(p.b)));
          hexRow[x] = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
        }
      }
      hexData.push(hexRow);
    }
    return hexData;
  },

  // src: smart-pixel-generator.vue:2404-2428
  buildStructurePixelsFromBase() {
    if (!ctx.basePixelCache || !ctx.basePixelCache.pixels) return ctx.pixelData;

    const settings = ctx.applyStructureConfigFromAdjustments();
    const cacheKey = ctx.getStructureCacheKey(settings);
    if (ctx.structureCache.has(cacheKey)) {
      console.log('命中结构缓存');
      return ctx.clonePixelGrid(ctx.structureCache.get(cacheKey));
    }

    const colorStart = Date.now();
    const source = ctx.buildColorSimplifiedPixelsFromBase(settings);
    ctx.recordPerformanceStage('颜色简化层', Date.now() - colorStart, {
      level: settings.colorMergeLevel || 0
    });

    ctx.pixelData = ctx.applySamplingEnhancements(source, settings);
    ctx.applyRegionMergingPipeline({
      ...settings,
      colorMergeLevel: 0
    });
    const result = ctx.clonePixelGrid(ctx.pixelData);
    ctx.setLimitedCache(ctx.structureCache, cacheKey, result);
    return result;
  },

  // src: smart-pixel-generator.vue:2430-2456
  buildColorSimplifiedPixelsFromBase(settings = ctx.getEffectiveStructureSettings()) {
    if (!ctx.basePixelCache || !ctx.basePixelCache.pixels) return ctx.pixelData;

    const level = settings.colorMergeLevel || 0;
    if (level <= 0) {
      return ctx.clonePixelGrid(ctx.basePixelCache.pixels);
    }

    const cacheKey = ctx.getColorSimplifyCacheKey(settings);
    if (ctx.colorSimplifyCache.has(cacheKey)) {
      console.log('命中颜色简化缓存');
      ctx.addPerformanceNote('命中颜色简化缓存', { level });
      return ctx.clonePixelGrid(ctx.colorSimplifyCache.get(cacheKey));
    }

    const previousPixelData = ctx.pixelData;
    ctx.pixelData = ctx.clonePixelGrid(ctx.basePixelCache.pixels);
    ctx.applyRegionMergingPipeline({
      ...settings,
      regionMergeLevel: 0,
      smoothIterations: 0
    });
    const result = ctx.clonePixelGrid(ctx.pixelData);
    ctx.pixelData = previousPixelData;
    ctx.setLimitedCache(ctx.colorSimplifyCache, cacheKey, result);
    return ctx.clonePixelGrid(result);
  },

  // src: smart-pixel-generator.vue:2458-2501
  applySamplingEnhancements(pixelData, settings = ctx.getEffectiveStructureSettings()) {
    if (!pixelData || !Array.isArray(pixelData)) return pixelData;

    const height = pixelData.length;
    const width = pixelData[0] ? pixelData[0].length : 0;
    if (!height || !width) return pixelData;

    const blockStrength = Math.max(0, Math.min(1, settings.blockClarityRatio || 0));
    const edgeStrength = Math.max(0, Math.min(1, settings.edgeKeepRatio || 0));
    if (blockStrength <= 0 && edgeStrength <= 0) return pixelData;

    const result = ctx.clonePixelGrid(pixelData);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const currentHex = pixelData[y][x];
        if (!currentHex) continue;

        const current = ctx.hexToRgb(currentHex);
        const dominant = ctx.getDominantNeighborColor(pixelData, x, y);
        let mixed = current;

        if (dominant && blockStrength > 0) {
          mixed = {
            r: current.r * (1 - blockStrength) + dominant.r * blockStrength,
            g: current.g * (1 - blockStrength) + dominant.g * blockStrength,
            b: current.b * (1 - blockStrength) + dominant.b * blockStrength
          };
        }

        if (edgeStrength > 0 && ctx.isLocalDarkEdge(pixelData, x, y, current)) {
          const keep = 0.35 * edgeStrength;
          mixed = {
            r: mixed.r * (1 - keep),
            g: mixed.g * (1 - keep),
            b: mixed.b * (1 - keep)
          };
        }

        result[y][x] = ctx.rgbToHex(mixed);
      }
    }

    return result;
  },

  // src: smart-pixel-generator.vue:2503-2537
  getDominantNeighborColor(pixelData, x, y) {
    const height = pixelData.length;
    const width = pixelData[0] ? pixelData[0].length : 0;
    const counts = new Map();

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
        const hex = pixelData[ny][nx];
        if (!hex) continue;
        const rgb = ctx.hexToRgb(hex);
        const key = `${Math.round(rgb.r / 16)},${Math.round(rgb.g / 16)},${Math.round(rgb.b / 16)}`;
        const item = counts.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        item.count++;
        item.r += rgb.r;
        item.g += rgb.g;
        item.b += rgb.b;
        counts.set(key, item);
      }
    }

    let best = null;
    for (const item of counts.values()) {
      if (!best || item.count > best.count) best = item;
    }

    if (!best || best.count <= 1) return null;
    return {
      r: best.r / best.count,
      g: best.g / best.count,
      b: best.b / best.count
    };
  },

  // src: smart-pixel-generator.vue:2539-2565
  isLocalDarkEdge(pixelData, x, y, current) {
    const height = pixelData.length;
    const width = pixelData[0] ? pixelData[0].length : 0;
    const currentLight = current.r + current.g + current.b;
    let brighterNeighbors = 0;

    const neighbors = [
      [y - 1, x],
      [y + 1, x],
      [y, x - 1],
      [y, x + 1]
    ];

    for (const pos of neighbors) {
      const ny = pos[0];
      const nx = pos[1];
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
      const hex = pixelData[ny][nx];
      if (!hex) continue;
      const rgb = ctx.hexToRgb(hex);
      if ((rgb.r + rgb.g + rgb.b) - currentLight > 90) {
        brighterNeighbors++;
      }
    }

    return currentLight < 260 && brighterNeighbors >= 2;
  },

  // src: smart-pixel-generator.vue:2567-2623
  simpleDownsampleRgb(imageData, srcWidth, srcHeight, dstWidth, dstHeight = dstWidth) {
    const result = [];
    const expectedLen = srcWidth * srcHeight * 4;
    console.log('simpleDownsample src:', srcWidth + 'x' + srcHeight, 'dst:', dstWidth + 'x' + dstHeight, 'dataLen:', imageData.length, 'expected:', expectedLen);

    let validBlocks = 0;
    let emptyBlocks = 0;

    for (let y = 0; y < dstHeight; y++) {
      const row = [];
      const syStart = Math.floor(y * srcHeight / dstHeight);
      const syEnd = Math.floor((y + 1) * srcHeight / dstHeight);

      for (let x = 0; x < dstWidth; x++) {
        const sxStart = Math.floor(x * srcWidth / dstWidth);
        const sxEnd = Math.floor((x + 1) * srcWidth / dstWidth);

        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let totalA = 0;
        let count = 0;

        for (let sy = syStart; sy < syEnd; sy++) {
          for (let sx = sxStart; sx < sxEnd; sx++) {
            const idx = (sy * srcWidth + sx) * 4;
            if (idx + 3 >= imageData.length) continue;
            const a = imageData[idx + 3];

            if (a >= 64) {
              totalR += imageData[idx];
              totalG += imageData[idx + 1];
              totalB += imageData[idx + 2];
              totalA += a;
              count++;
            }
          }
        }

        if (count === 0) {
          emptyBlocks++;
          row.push(null);
        } else {
          validBlocks++;
          const r = Math.round(totalR / count);
          const g = Math.round(totalG / count);
          const b = Math.round(totalB / count);
          row.push({ r, g, b });
        }
      }
      result.push(row);
    }

    console.log('simpleDownsample blocks -> valid:', validBlocks, 'empty:', emptyBlocks, 'total:', dstWidth * dstHeight);

    return result;
  },

  // src: smart-pixel-generator.vue:2626-2761
  pixelizeImageData(imageData, canvasWidth, outputWidth, canvasHeight = canvasWidth, outputHeight = outputWidth) {
    console.log('开始像素化，输入:', canvasWidth + 'x' + canvasHeight, '输出:', outputWidth + 'x' + outputHeight);
    console.log('像素化风格:', ctx.autoConfig.pixelizeMode);
    console.log('边缘处理模式:', ctx.autoConfig.pixelMode);
    
    const pixelData = [];
    const factorX = Math.max(1, Math.floor(canvasWidth / outputWidth));
    const factorY = Math.max(1, Math.floor(canvasHeight / outputHeight));
    
    // 根据 pixelMode 调整深色阈值参数
    let darkThreshold = 60;
    let darkRatioThreshold = 0.20;
    
    if (ctx.autoConfig.pixelMode === 'preserve-edge') {
      darkThreshold = 70;
      darkRatioThreshold = Math.max(outputWidth, outputHeight) >= 80 ? 0.18 : 0.15;
    } else if (ctx.autoConfig.pixelMode === 'smooth') {
      darkThreshold = 60;
      darkRatioThreshold = Math.max(outputWidth, outputHeight) >= 80 ? 0.30 : 0.28;
    } else {
      darkThreshold = 60;
      darkRatioThreshold = Math.max(outputWidth, outputHeight) >= 80 ? 0.22 : 0.20;
    }
    
    // 确定实际使用的像素化算法
    let actualPixelizeMode = ctx.autoConfig.pixelizeMode;
    if (actualPixelizeMode === 'smart') {
      // 智能模式：根据图片特征自动选择
      const imgF = ctx.imageFeatures || {};
      if (imgF.type === 'illustration') {
        actualPixelizeMode = 'sharp';  // 插画用桶聚合
      } else {
        actualPixelizeMode = 'smooth'; // 照片用平均
      }
      console.log('智能选择像素化算法:', actualPixelizeMode);
    }
    
    for (let y = 0; y < outputHeight; y++) {
      const row = new Array(outputWidth).fill(null);
      const syStart = y * factorY;
      const syEnd = Math.min(syStart + factorY, canvasHeight);
      
      for (let x = 0; x < outputWidth; x++) {
        const sxStart = x * factorX;
        const sxEnd = Math.min(sxStart + factorX, canvasWidth);
        
        let darkCount = 0;
        let visibleCount = 0;
        let totalR = 0, totalG = 0, totalB = 0;
        const buckets = Object.create(null);
        
        for (let sy = syStart; sy < syEnd; sy++) {
          for (let sx = sxStart; sx < sxEnd; sx++) {
            const idx = (sy * canvasWidth + sx) * 4;
            if (idx + 3 >= imageData.length) continue;
            
            const r = imageData[idx];
            const g = imageData[idx + 1];
            const b = imageData[idx + 2];
            const a = imageData[idx + 3];
            
            if (a < 64) continue;
            visibleCount++;
            
            const maxChannel = Math.max(r, g, b);
            if (maxChannel < darkThreshold) darkCount++;
            
            // 简单平均：累加所有像素
            totalR += r;
            totalG += g;
            totalB += b;
            
            // 桶聚合：按颜色分组
            const key = (r << 16) | (g << 8) | b;
            let bucket = buckets[key];
            if (!bucket) {
              bucket = { count: 0, r: 0, g: 0, b: 0 };
              buckets[key] = bucket;
            }
            bucket.count++;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
          }
        }
        
        if (!visibleCount) {
          row[x] = null;
          continue;
        }
        
        // 深色像素检测
        if (darkCount / visibleCount >= darkRatioThreshold) {
          row[x] = '#000000';
          continue;
        }
        
        let rAvg, gAvg, bAvg;
        
        if (actualPixelizeMode === 'smooth') {
          // 照片模式：简单平均（过渡平滑）
          rAvg = Math.max(0, Math.min(255, Math.round(totalR / visibleCount)));
          gAvg = Math.max(0, Math.min(255, Math.round(totalG / visibleCount)));
          bAvg = Math.max(0, Math.min(255, Math.round(totalB / visibleCount)));
        } else {
          // 插画模式：桶聚合（保持色块清晰）
          let bestBucket = null;
          for (const key in buckets) {
            const bucket = buckets[key];
            if (!bestBucket || bucket.count > bestBucket.count) {
              bestBucket = bucket;
            }
          }
          
          if (!bestBucket) {
            row[x] = null;
            continue;
          }
          
          const count = bestBucket.count || 1;
          rAvg = Math.max(0, Math.min(255, Math.round(bestBucket.r / count)));
          gAvg = Math.max(0, Math.min(255, Math.round(bestBucket.g / count)));
          bAvg = Math.max(0, Math.min(255, Math.round(bestBucket.b / count)));
        }
        
        row[x] = '#' + ((1 << 24) + (rAvg << 16) + (gAvg << 8) + bAvg).toString(16).slice(1).toUpperCase();
      }
      pixelData.push(row);
    }
    
    console.log('像素化完成，尺寸:', pixelData.length, 'x', pixelData[0]?.length);
    
    // 应用饱和度和对比度调整
    
    return pixelData;
  },

  // src: smart-pixel-generator.vue:2763-2839
  applyRegionMergingPipeline(settings = ctx.getEffectiveStructureSettings()) {
    if (!ctx.pixelData || !Array.isArray(ctx.pixelData) || ctx.pixelData.length === 0) return;
    const height = ctx.pixelData.length;
    const width = ctx.pixelData[0] ? ctx.pixelData[0].length : 0;
    if (height === 0 || width === 0) return;

    const colorMergeLevel = settings.colorMergeLevel || 0;
    const regionMergeLevel = settings.regionMergeLevel || 0;
    if (colorMergeLevel <= 0 && regionMergeLevel <= 0 && (settings.smoothIterations || 0) <= 0) {
      ctx.baseColorCount = 0;
      console.log('默认快速结构：跳过全局聚类和区域合并');
      return;
    }

    // 将 HEX 像素数据转换为 {r,g,b} 结构，便于复用测试页的区域合并算法
    const rgbData = [];
    for (let y = 0; y < height; y++) {
      const row = ctx.pixelData[y];
      const rgbRow = new Array(row.length);
      for (let x = 0; x < row.length; x++) {
        const hex = row[x];
        if (!hex) {
          rgbRow[x] = null;
        } else {
          const rgb = ctx.hexToRgb(hex);
          rgbRow[x] = { r: rgb.r, g: rgb.g, b: rgb.b };
        }
      }
      rgbData.push(rgbRow);
    }

    // 基础颜色统计，用于百分比色彩简化
    ctx.baseColorCount = ctx.countColorsFromPixelDataRgb(rgbData);

    // 全局色彩简化（按百分比减少颜色数量）
    if (colorMergeLevel > 0) {
      ctx.applyGlobalColorClusteringRgb(rgbData, colorMergeLevel);
    }

    // 区域合并
    if (regionMergeLevel > 0) {
      ctx.applyRegionMergingRgb(rgbData, regionMergeLevel);

      // 高挡位时应用测试页中使用的轻量颜色归一化，以对齐竞品风格
      if (regionMergeLevel >= 10) {
        ctx.applyTestColorQuantizationRgb(rgbData, regionMergeLevel);
      }
    }

    let iterations = settings.smoothIterations || 0;
    if (iterations > 3) iterations = 3;
    if (iterations > 0) {
      ctx.applySpatialSmoothingRgb(rgbData, iterations);
    }

    // 写回 HEX 数据供后续色卡匹配使用
    const merged = [];
    for (let y = 0; y < height; y++) {
      const rgbRow = rgbData[y];
      const hexRow = new Array(rgbRow.length);
      for (let x = 0; x < rgbRow.length; x++) {
        const p = rgbRow[x];
        if (!p) {
          hexRow[x] = null;
        } else {
          const r = Math.max(0, Math.min(255, Math.round(p.r)));
          const g = Math.max(0, Math.min(255, Math.round(p.g)));
          const b = Math.max(0, Math.min(255, Math.round(p.b)));
          const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
          hexRow[x] = hex;
        }
      }
      merged.push(hexRow);
    }

    ctx.pixelData = merged;
  },

  // src: smart-pixel-generator.vue:2842-2900
  applySpatialSmoothingRgb(pixelData, iterations = 1) {
    const height = pixelData.length;
    const width = pixelData[0] ? pixelData[0].length : 0;
    if (height === 0 || width === 0) return;

    for (let iter = 0; iter < iterations; iter++) {
      const newData = pixelData.map(row => row.map(p => (p ? { ...p } : null)));
      let detailPreserved = 0;
      let flatSmoothed = 0;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (!pixelData[y][x]) continue;

          const colorCount = new Map();
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy;
              const nx = x + dx;
              if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
              const np = pixelData[ny][nx];
              if (!np) continue;
              const key = `${np.r},${np.g},${np.b}`;
              colorCount.set(key, (colorCount.get(key) || 0) + 1);
            }
          }

          const uniqueColors = colorCount.size;
          if (uniqueColors >= 4) {
            detailPreserved++;
            continue;
          }

          let maxCount = 0;
          let dominantColor = null;
          for (const [key, count] of colorCount) {
            if (count > maxCount) {
              maxCount = count;
              const [r, g, b] = key.split(',').map(Number);
              dominantColor = { r, g, b };
            }
          }

          if (maxCount >= 5 && dominantColor) {
            newData[y][x] = dominantColor;
            flatSmoothed++;
          }
        }
      }

      console.log(`空间平滑迭代(智能页) ${iter + 1}: 细节保留 ${detailPreserved} 块, 平坦平滑 ${flatSmoothed} 块`);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          pixelData[y][x] = newData[y][x];
        }
      }
    }
  },

  // src: smart-pixel-generator.vue:2903-2923
  mapMergeLevelToMaxColors(level) {
    if (level === 0) return 0;

    const base = ctx.baseColorCount || 0;
    if (!base) return 0;

    const steps = 10;
    const clampedLevel = Math.max(0, Math.min(steps, level));

    const maxReduction = 0.6; // 最多减少约 60% 颜色
    const reduction = maxReduction * (clampedLevel / steps);
    const keepRatio = 1 - reduction;

    let target = Math.round(base * keepRatio);

    const minColors = 8;
    if (target < minColors) target = minColors;
    if (target > base) target = base;

    return target;
  },

  // src: smart-pixel-generator.vue:2926-2938
  countColorsFromPixelDataRgb(pixelData) {
    const colorSet = new Set();

    for (const row of pixelData) {
      for (const p of row) {
        if (!p) continue;
        const key = `${p.r},${p.g},${p.b}`;
        colorSet.add(key);
      }
    }

    return colorSet.size;
  },

  // src: smart-pixel-generator.vue:2941-2979
  applyGlobalColorClusteringRgb(pixelData, level) {
    if (level <= 0) return;

    const maxColors = ctx.mapMergeLevelToMaxColors(level);
    if (!maxColors) return;

    console.log('开始全局色彩聚类（smart页），level:', level, '-> maxColors:', maxColors);

    // {r,g,b} -> hex
    const hexData = pixelData.map(row =>
      row.map(p => {
        if (!p) return null;
        const r = p.r.toString(16).padStart(2, '0');
        const g = p.g.toString(16).padStart(2, '0');
        const b = p.b.toString(16).padStart(2, '0');
        return '#' + r + g + b;
      })
    );

    const quantized = quantizeColors(hexData, maxColors);

    // 写回 {r,g,b}
    for (let y = 0; y < pixelData.length; y++) {
      for (let x = 0; x < pixelData[y].length; x++) {
        const hex = quantized[y][x];
        if (!hex) {
          pixelData[y][x] = null;
        } else {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          pixelData[y][x] = { r, g, b };
        }
      }
    }

    // 轻度空间平滑，统一邻域颜色（与测试页保持一致）
    ctx.applySpatialSmoothingRgb(pixelData, 1);
  },

  // src: smart-pixel-generator.vue:2982-3128
  applyRegionMergingRgb(pixelData, level) {
    const height = pixelData.length;
    const width = pixelData[0] ? pixelData[0].length : 0;
    if (height === 0 || width === 0) return;

    const thresholdMin = 6;
    const thresholdMax = 60;
    const clampedLevel = Math.max(0, Math.min(20, level));
    const t = clampedLevel / 20;
    const threshold = thresholdMin + (thresholdMax - thresholdMin) * t;
    const thresholdSq = threshold * threshold;

    let edgeThreshold;
    if (clampedLevel <= 5) {
      edgeThreshold = 20;
    } else if (clampedLevel <= 10) {
      edgeThreshold = 24;
    } else if (clampedLevel <= 15) {
      edgeThreshold = 32;
    } else {
      edgeThreshold = 40;
    }
    const edgeThresholdSq = edgeThreshold * edgeThreshold;

    const visited = [];
    const isDetail = [];

    function distSq(a, b) {
      const dr = a.r - b.r;
      const dg = a.g - b.g;
      const db = a.b - b.b;
      return dr * dr + dg * dg + db * db;
    }

    for (let y = 0; y < height; y++) {
      const visitedRow = new Array(width).fill(false);
      const detailRow = new Array(width).fill(false);
      for (let x = 0; x < width; x++) {
        const p = pixelData[y][x];
        if (!p) continue;
        let detail = false;
        const neighbors = [
          [y - 1, x],
          [y + 1, x],
          [y, x - 1],
          [y, x + 1]
        ];
        for (let i = 0; i < neighbors.length; i++) {
          const ny = neighbors[i][0];
          const nx = neighbors[i][1];
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          const np = pixelData[ny][nx];
          if (!np) continue;
          if (distSq(p, np) > edgeThresholdSq) {
            detail = true;
            break;
          }
        }
        detailRow[x] = detail;
      }
      visited.push(visitedRow);
      isDetail.push(detailRow);
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const start = pixelData[y][x];
        if (!start || visited[y][x]) continue;

        if (isDetail[y][x]) {
          visited[y][x] = true;
          continue;
        }

        const queue = [[y, x]];
        const coords = [];
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;
        visited[y][x] = true;

        while (queue.length) {
          const current = queue.shift();
          const cy = current[0];
          const cx = current[1];
          const p = pixelData[cy][cx];
          if (!p) continue;

          coords.push([cy, cx]);
          sumR += p.r;
          sumG += p.g;
          sumB += p.b;
          count++;

          const avg = {
            r: sumR / count,
            g: sumG / count,
            b: sumB / count
          };

          const neighbors = [
            [cy - 1, cx],
            [cy + 1, cx],
            [cy, cx - 1],
            [cy, cx + 1]
          ];

          if (clampedLevel >= 9) {
            neighbors.push(
              [cy - 1, cx - 1],
              [cy - 1, cx + 1],
              [cy + 1, cx - 1],
              [cy + 1, cx + 1]
            );
          }
          for (let i = 0; i < neighbors.length; i++) {
            const ny = neighbors[i][0];
            const nx = neighbors[i][1];
            if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
            if (visited[ny][nx]) continue;
            if (isDetail[ny][nx]) continue;
            const np = pixelData[ny][nx];
            if (!np) continue;
            if (distSq(avg, np) <= thresholdSq) {
              visited[ny][nx] = true;
              queue.push([ny, nx]);
            }
          }
        }

        if (coords.length <= 1) {
          continue;
        }

        const r = Math.round(sumR / count);
        const g = Math.round(sumG / count);
        const b = Math.round(sumB / count);

        for (let i = 0; i < coords.length; i++) {
          const cy = coords[i][0];
          const cx = coords[i][1];
          pixelData[cy][cx] = { r, g, b };
        }
      }
    }
  },

  // src: smart-pixel-generator.vue:3130-3156
  applyTestColorQuantizationRgb(pixelData, level) {
    const height = pixelData.length;
    const width = pixelData[0] ? pixelData[0].length : 0;
    if (height === 0 || width === 0) return;

    const clampedLevel = Math.max(0, Math.min(20, level));
    if (clampedLevel < 10) return;

    const t = (clampedLevel - 10) / 10;
    const rawStep = 6 + (10 - 6) * t;
    const step = Math.max(1, Math.round(rawStep));

    for (let y = 0; y < height; y++) {
      const row = pixelData[y];
      for (let x = 0; x < width; x++) {
        const p = row[x];
        if (!p) continue;
        let r = Math.round(p.r / step) * step;
        let g = Math.round(p.g / step) * step;
        let b = Math.round(p.b / step) * step;
        if (r < 0) r = 0; if (r > 255) r = 255;
        if (g < 0) g = 0; if (g > 255) g = 255;
        if (b < 0) b = 0; if (b > 255) b = 255;
        row[x] = { r, g, b };
      }
    }
  },

  // src: smart-pixel-generator.vue:3159-3199
  adjustColorProperties(pixels, options = null) {
    const saturation = options && typeof options.saturation === 'number' ? options.saturation : ctx.saturationLevel;
    const contrast = options && typeof options.contrast === 'number' ? options.contrast : ctx.contrastLevel;
    const protectSkinTone = options && Object.prototype.hasOwnProperty.call(options, 'protectSkinTone')
      ? !!options.protectSkinTone
      : ctx.enableSkinToneProtection;
    // 清空肤色缓存（每次调整时重新计算）
    ctx.skinToneCache.clear();
    
    for (let y = 0; y < pixels.length; y++) {
      for (let x = 0; x < pixels[y].length; x++) {
        if (!pixels[y][x]) continue; // 只跳过 null，不跳过黑色
        
        const rgb = ctx.hexToRgb(pixels[y][x]);
        const hsl = ctx.rgbToHsl(rgb);
        
        // 肤色保护：检测是否为肤色像素（使用缓存）
        const isSkin = protectSkinTone && ctx.isSkinTonePixelCached(pixels[y][x], rgb);
        
        if (isSkin) {
          // 肤色像素：使用更温和的调整
          const skinSaturationFactor = saturation > 1.0 ?
            1.0 + (saturation - 1.0) * 0.3 :  // 提高时只增加 30%
            Math.max(0.9, saturation);  // 降低时最多降到 90%，避免肤色过灰
          hsl.s = Math.max(0, Math.min(1, hsl.s * skinSaturationFactor));
          
          // 肤色对比度也轻微调整
          const skinContrastFactor = 1.0 + (contrast - 1.0) * 0.5;
          hsl.l = 0.5 + (hsl.l - 0.5) * skinContrastFactor;
          hsl.l = Math.max(0, Math.min(1, hsl.l));
        } else {
          // 非肤色像素：正常调整
          hsl.s = Math.max(0, Math.min(1, hsl.s * saturation));
          hsl.l = 0.5 + (hsl.l - 0.5) * contrast;
          hsl.l = Math.max(0, Math.min(1, hsl.l));
        }
        
        pixels[y][x] = ctx.hslToHex(hsl);
      }
    }
  },

  // src: smart-pixel-generator.vue:3202-3212
  isSkinTonePixelCached(hexColor, rgb) {
    // 检查缓存
    if (ctx.skinToneCache.has(hexColor)) {
      return ctx.skinToneCache.get(hexColor);
    }
    
    // 计算并缓存
    const result = ctx.isSkinTonePixel(rgb);
    ctx.skinToneCache.set(hexColor, result);
    return result;
  },

  // src: smart-pixel-generator.vue:3216-3239
  isSkinTonePixel(rgb) {
    const { r, g, b } = rgb;
    
    // 基本 RGB 范围（覆盖深肤色）
    if (r < 40 || g < 20 || b < 10) return false;  // 排除极暗的颜色
    if (r < g || r < b) return false;  // R 必须是最大的（肤色基本特征）
    
    // HSL 检测
    const hsl = ctx.rgbToHsl(rgb);
    
    // 色相：0-50°（红色到橙黄色区间，覆盖各种肤色）
    if (hsl.h > 50) return false;
    
    // 饱和度：0.1-0.7（放宽范围，包含亚洲肤色和深肤色）
    if (hsl.s < 0.1 || hsl.s > 0.7) return false;
    
    // 亮度：0.25-0.85（放宽范围，包含深浅肤色）
    if (hsl.l < 0.25 || hsl.l > 0.85) return false;
    
    // R-G 差异检查（肤色中 R 和 G 相对接近）
    if (Math.abs(r - g) > 80) return false;
    
    return true;
  },

  // src: smart-pixel-generator.vue:3242-3268
  rgbToHsl(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    
    if (max === min) {
      return { h: 0, s: 0, l };
    }
    
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    let h = 0;
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }
    
    return { h: h * 360, s, l };
  },

  // src: smart-pixel-generator.vue:3271-3303
  hslToHex(hsl) {
    const h = hsl.h / 360;
    const s = hsl.s;
    const l = hsl.l;
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (c) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
  },

  // src: smart-pixel-generator.vue:3305-3329
  getColorFamily(hsl) {
    if (!hsl) return 'other';
    let { h, s, l } = hsl;
    if (isNaN(h)) return 'other';

    h = ((h % 360) + 360) % 360;

    if (s < 0.12) {
      if (l <= 0.2) return 'black';
      if (l >= 0.85) return 'white';
      return 'gray';
    }

    if (h >= 20 && h < 50 && l >= 0.2 && l <= 0.7) {
      return 'brown';
    }

    if (h < 20 || h >= 340) return 'red';
    if (h < 80) return 'orange_yellow';
    if (h < 160) return 'green';
    if (h < 200) return 'cyan';
    if (h < 260) return 'blue';
    if (h < 320) return 'purple';
    return 'red';
  },

  // src: smart-pixel-generator.vue:3332-3364
  calculateContentArea() {
    const targetDims = ctx.getTargetPixelDimensions();

    if (!ctx.resultPixelData || !Array.isArray(ctx.resultPixelData) || ctx.resultPixelData.length === 0) {
      console.error('calculateContentArea: resultPixelData 无效');
      ctx.contentPixelWidth = targetDims.width;
      ctx.contentPixelHeight = targetDims.height;
      return;
    }

    const rowCount = ctx.resultPixelData.length;
    const colCount = ctx.resultPixelData[0] ? ctx.resultPixelData[0].length : rowCount;
    ctx.contentPixelWidth = colCount || targetDims.width;
    ctx.contentPixelHeight = rowCount || targetDims.height;

    console.log('方板像素尺寸:', ctx.contentPixelWidth, 'x', ctx.contentPixelHeight);
    
    // 计算 canvas 尺寸（按比例，受预览区最大高度约束）
    const maxDisplaySize = ctx.previewDisplayMax || 260;
    const scale = Math.min(
      maxDisplaySize / ctx.contentPixelWidth,
      maxDisplaySize / ctx.contentPixelHeight
    );
    
    // 使用 Math.ceil 确保尺寸足够大，避免右侧截断
    ctx.canvasWidth = Math.ceil(ctx.contentPixelWidth * scale);
    ctx.canvasHeight = Math.ceil(ctx.contentPixelHeight * scale);
    
    console.log(' canvas 计算结果:');
    console.log('  内容像素:', ctx.contentPixelWidth, 'x', ctx.contentPixelHeight);
    console.log('  缩放比例:', scale.toFixed(2));
    console.log('  canvas尺寸(px):', ctx.canvasWidth, 'x', ctx.canvasHeight);
  },

  // src: smart-pixel-generator.vue:3369-3499
  async matchColors(activeToken = null) {
    const startTime = Date.now();
    const ownsLoading = activeToken == null;
    console.log('\n=== 开始智能颜色匹配 ===');
    console.log('配置:', ctx.autoConfig);
    if (ownsLoading) {
      ctx.loading = true;
    }
    
    try {
      const finalKey = ctx.getFinalCacheKey();
      if (ctx.finalResultCache.has(finalKey)) {
        console.log('命中最终预览缓存');
        if (activeToken && activeToken !== ctx.activeGenerateToken) return false;
        ctx.addPerformanceNote('命中最终结果缓存');
        ctx.resultPixelData = ctx.clonePixelGrid(ctx.finalResultCache.get(finalKey));
        if (ownsLoading) {
          ctx.loading = false;
        }
        return true;
      }

      // 1. 灰度检测（先检测，再决定用哪个色卡）
      let paletteToUse = ctx.paletteColors;
      const grayRatio = ctx.detectGrayscaleRatio(ctx.pixelData);
      console.log('灰度比例:', grayRatio);
      if (grayRatio >= 0.95) {
        const grayPalette = ctx.extractGrayscalePalette(ctx.paletteColors);
        if (grayPalette.length > 0) {
          paletteToUse = grayPalette;
          console.log('使用灰度色卡，颜色数:', grayPalette.length);
        }
      }

      if (activeToken && activeToken !== ctx.activeGenerateToken) return false;
      
      // 2. 预计算 LAB 值并构建 KD-Tree（按色卡缓存，避免每次生成重复构建）
      let stageStart = Date.now();
      const preparedPalette = ctx.preparePaletteForMatching(paletteToUse);
      const palettePrepareTime = Date.now() - stageStart;
      ctx.recordPerformanceStage('色卡预处理', palettePrepareTime, {
        colors: paletteToUse.length
      });
      console.log('耗时-色卡预处理:', palettePrepareTime, 'ms');
      ctx.paletteColorsLab = preparedPalette.colorsLab;
      ctx.labKDTree = preparedPalette.kdTree;
      ctx.currentPalette = paletteToUse; // 保存当前使用的色卡
      console.log('KD-Tree 构建完成，使用色卡数:', paletteToUse.length);
      
      const sourcePixels = ctx.preparePixelsForPaletteMatching(ctx.pixelData);
      const skinMask = ctx.activeSkinToneProtection ? ctx.buildSkinToneMask(sourcePixels) : null;

      // 3. 基础颜色匹配
      ctx.loadingText = '正在匹配颜色...';
      stageStart = Date.now();
      const baseMatchKey = ctx.getBaseMatchCacheKey(paletteToUse, sourcePixels);
      let result;
      if (ctx.baseMatchResultCache.has(baseMatchKey)) {
        console.log('命中基础色号匹配缓存');
        ctx.addPerformanceNote('命中基础色号匹配缓存');
        result = ctx.clonePixelGrid(ctx.baseMatchResultCache.get(baseMatchKey));
      } else {
        result = await ctx.mapPixelsToColorPalette(sourcePixels, paletteToUse, skinMask);
        ctx.setLimitedCache(ctx.baseMatchResultCache, baseMatchKey, ctx.clonePixelGrid(result));
      }
      if (activeToken && activeToken !== ctx.activeGenerateToken) return false;
      const baseMatchTime = Date.now() - stageStart;
      ctx.recordPerformanceStage('基础匹配', baseMatchTime);
      console.log('耗时-基础匹配:', baseMatchTime, 'ms');
      
      // 4. 应用抖动算法
      if (ctx.autoConfig.dithering !== 'none') {
        ctx.loadingText = '正在应用抖动...';
        stageStart = Date.now();
        result = await ctx.applyDithering(sourcePixels, result, paletteToUse);
        if (activeToken && activeToken !== ctx.activeGenerateToken) return false;
        ctx.recordPerformanceStage('抖动处理', Date.now() - stageStart);
      }
      
      // 5. 块面统一
      if (ctx.activeBlockUnityLevel > 0) {
        ctx.loadingText = '正在统一块面...';
        stageStart = Date.now();
        result = ctx.applyBlockUnity(result, sourcePixels, ctx.activeBlockUnityLevel);
        if (activeToken && activeToken !== ctx.activeGenerateToken) return false;
        const blockUnityTime = Date.now() - stageStart;
        ctx.recordPerformanceStage('块面统一', blockUnityTime);
        console.log('耗时-块面统一:', blockUnityTime, 'ms');
      }

      // 6. 应用柔和模式
      if (ctx.activeSmoothNoiseLevel > 0) {
        ctx.loadingText = '正在柔和处理...';
        stageStart = Date.now();
        result = await ctx.applySmoothMode(result, sourcePixels, paletteToUse);
        if (activeToken && activeToken !== ctx.activeGenerateToken) return false;
        const smoothTime = Date.now() - stageStart;
        ctx.recordPerformanceStage('柔和处理', smoothTime);
        console.log('耗时-柔和处理:', smoothTime, 'ms');
      }

      // 7. 清理调色板杂色（合并极少使用的小色块到周围主色）
      stageStart = Date.now();
      result = ctx.cleanupPaletteNoise(result);
      const cleanupTime = Date.now() - stageStart;
      ctx.recordPerformanceStage('杂色清理', cleanupTime);
      console.log('耗时-杂色清理:', cleanupTime, 'ms');

      ctx.resultPixelData = result;

      ctx.setLimitedCache(ctx.finalResultCache, finalKey, ctx.clonePixelGrid(ctx.resultPixelData));

      if (ownsLoading) {
        ctx.loading = false;
      }
      const matchTotal = Date.now() - startTime;
      ctx.recordPerformanceStage('matchColors总计', matchTotal);
      console.log('耗时-matchColors总计:', matchTotal, 'ms');
      console.log('=== 匹配完成 ===');
      return true;
      
    } catch (e) {
      console.error('匹配出错:', e);
      if (ownsLoading) {
        ctx.loading = false;
      }
      uni.showToast({ title: '匹配出错', icon: 'none' });
      // 向上抛出，让调用方决定是否继续后续步骤
      throw e;
    }
  },

  // src: smart-pixel-generator.vue:3501-3528
  preparePaletteForMatching(palette) {
    const key = ctx.getPaletteCacheKey(palette);
    if (ctx.palettePreparationCache.has(key)) {
      return ctx.palettePreparationCache.get(key);
    }

    const colorsLab = palette.map(c => {
      const rgb = ctx.precisionMatcher.hexToRgb(c.hex);
      const lab = ctx.precisionMatcher.rgbToLab(rgb);
      const hsl = ctx.rgbToHsl(rgb);
      const family = ctx.getColorFamily(hsl);
      return {
        ...c,
        lab,
        hsl,
        family,
        isSkinTone: ctx.isSkinTonePixel(rgb)
      };
    });

    const prepared = {
      colorsLab,
      kdTree: ctx.precisionMatcher.buildPrecisionKDTree(colorsLab)
    };

    ctx.palettePreparationCache.set(key, prepared);
    return prepared;
  },

  // src: smart-pixel-generator.vue:3530-3535
  getPaletteCacheKey(palette) {
    if (ctx.selectedPalette && palette === ctx.paletteColors) {
      return `${ctx.selectedPalette.brand || ''}:${ctx.selectedPalette.palette_code || ''}`;
    }
    return palette.map(c => c && c.hex ? c.hex : '').join(',');
  },

  // src: smart-pixel-generator.vue:3537-3552
  preparePixelsForPaletteMatching(pixels) {
    const saturation = ctx.activeSaturationLevel || 1.0;
    const contrast = ctx.activeContrastLevel || 1.0;
    if (saturation === 1.0 && contrast === 1.0) {
      return pixels;
    }

    const adjusted = ctx.clonePixelGrid(pixels);
    console.log('匹配前调整颜色，鲜艳度:', saturation, '明暗层次:', contrast);
    ctx.adjustColorProperties(adjusted, {
      saturation,
      contrast,
      protectSkinTone: false
    });
    return adjusted;
  },

  // src: smart-pixel-generator.vue:3554-3578
  buildSkinToneMask(pixels) {
    if (!pixels || !Array.isArray(pixels)) return null;
    const mask = [];
    let skinCount = 0;
    let total = 0;

    for (let y = 0; y < pixels.length; y++) {
      const row = pixels[y] || [];
      const maskRow = new Array(row.length).fill(false);
      for (let x = 0; x < row.length; x++) {
        const hex = row[x];
        if (!hex) continue;
        total++;
        const rgb = ctx.hexToRgb(hex);
        if (ctx.isSkinTonePixel(rgb)) {
          maskRow[x] = true;
          skinCount++;
        }
      }
      mask.push(maskRow);
    }

    console.log('肤色像素检测:', skinCount, '/', total);
    return skinCount > 0 ? mask : null;
  },

  // src: smart-pixel-generator.vue:3580-3587
  isPaletteSkinToneColor(color) {
    if (!color || !color.hex) return false;
    if (Object.prototype.hasOwnProperty.call(color, 'isSkinTone')) {
      return !!color.isSkinTone;
    }
    const rgb = ctx.hexToRgb(color.hex);
    return ctx.isSkinTonePixel(rgb);
  },

  // src: smart-pixel-generator.vue:3590-3601
  detectGrayscaleRatio(pixels) {
    let gray = 0, total = 0;
    for (let i = 0; i < pixels.length; i += 5) {
      for (let j = 0; j < pixels[i].length; j += 5) {
        if (!pixels[i][j]) continue;
        const rgb = ctx.hexToRgb(pixels[i][j]);
        if (Math.abs(rgb.r - rgb.g) <= 10 && Math.abs(rgb.g - rgb.b) <= 10) gray++;
        total++;
      }
    }
    return total > 0 ? gray / total : 0;
  },

  // src: smart-pixel-generator.vue:3604-3609
  extractGrayscalePalette(palette) {
    return palette.filter(c => {
      const rgb = ctx.hexToRgb(c.hex);
      return Math.abs(rgb.r - rgb.g) <= 15 && Math.abs(rgb.g - rgb.b) <= 15;
    });
  },

  // src: smart-pixel-generator.vue:3612-3694
  async mapPixelsToColorPalette(pixels, palette, skinMask = null) {
    const result = [];
    const useQuantizedCache = ctx.shouldUseFastPaletteCache();
    const mapCacheKey = [
      ctx.getPaletteCacheKey(palette),
      ctx.autoConfig.paletteStrategy,
      ctx.autoConfig.familyPriority,
      ctx.autoConfig.algorithm,
      ctx.activeSkinToneProtection ? 'skin' : 'normal',
      useQuantizedCache ? 'fast' : 'exact'
    ].join('|');
    if (!ctx.matchColorMapCache.has(mapCacheKey)) {
      ctx.setLimitedCache(ctx.matchColorMapCache, mapCacheKey, new Map(), ctx.getCacheLimitForSize());
    } else {
      const cachedMap = ctx.matchColorMapCache.get(mapCacheKey);
      ctx.matchColorMapCache.delete(mapCacheKey);
      ctx.matchColorMapCache.set(mapCacheKey, cachedMap);
    }
    ctx.colorCache = ctx.matchColorMapCache.get(mapCacheKey);
    const colorCacheLimit = ctx.getMatchColorCacheLimitForSize();
    let exactCacheHits = 0;
    let quantizedCacheHits = 0;
    let calculated = 0;

    for (let y = 0; y < pixels.length; y++) {
      const row = pixels[y];
      const mappedRow = [];
      for (let x = 0; x < row.length; x++) {
        const color = row[x];
        if (!color) { mappedRow.push(null); continue; }
        const isSkin = !!(skinMask && skinMask[y] && skinMask[y][x]);
        const exactKey = isSkin ? `skin:${color}` : color;
        if (ctx.colorCache.has(exactKey)) {
          mappedRow.push(ctx.colorCache.get(exactKey));
          exactCacheHits++;
        } else {
          const cacheKey = useQuantizedCache ? ctx.getQuantizedColorCacheKey(color) : color;
          const scopedCacheKey = isSkin ? `skin:${cacheKey}` : cacheKey;
          if (scopedCacheKey !== exactKey && ctx.colorCache.has(scopedCacheKey)) {
            const cached = ctx.colorCache.get(scopedCacheKey);
            ctx.colorCache.set(exactKey, cached);
            if (ctx.colorCache.size > colorCacheLimit) {
              ctx.colorCache.clear();
            }
            mappedRow.push(cached);
            quantizedCacheHits++;
            continue;
          }

          const matchColor = cacheKey !== color ? cacheKey : color;
          const closest = ctx.findClosestColor(matchColor, palette, { skinTone: isSkin });
          if (cacheKey !== color) {
            ctx.colorCache.set(scopedCacheKey, closest);
          }
          ctx.colorCache.set(exactKey, closest);
          if (ctx.colorCache.size > colorCacheLimit) {
            ctx.colorCache.clear();
          }
          mappedRow.push(closest);
          calculated++;
        }
      }
      result.push(mappedRow);
    }

    console.log('色卡匹配缓存:', {
      fastCache: useQuantizedCache,
      exactCacheHits,
      quantizedCacheHits,
      calculated,
      cacheSize: ctx.colorCache.size,
      cacheLimit: colorCacheLimit
    });
    ctx.addPerformanceNote('色卡匹配缓存', {
      fastCache: useQuantizedCache,
      exactCacheHits,
      quantizedCacheHits,
      calculated,
      cacheSize: ctx.colorCache.size,
      cacheLimit: colorCacheLimit
    });
    return result;
  },

  // src: smart-pixel-generator.vue:3696-3704
  shouldUseFastPaletteCache() {
    const tier = ctx.getSizeTier();
    return !ctx.hasCustomStructureConfig &&
      ctx.matchMode === 'standard' &&
      (tier === 'large' || tier === 'xlarge') &&
      ctx.pipelineMode === 'new' &&
      ctx.autoConfig.paletteStrategy === 'nearest' &&
      ctx.autoConfig.dithering === 'none';
  },

  // src: smart-pixel-generator.vue:3706-3713
  getQuantizedColorCacheKey(hex) {
    const rgb = ctx.hexToRgb(hex);
    const step = 4;
    const r = Math.max(0, Math.min(255, Math.round(rgb.r / step) * step));
    const g = Math.max(0, Math.min(255, Math.round(rgb.g / step) * step));
    const b = Math.max(0, Math.min(255, Math.round(rgb.b / step) * step));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
  },

  // src: smart-pixel-generator.vue:3716-3801
  findClosestColor(targetColor, palette, options = {}) {
    if (!targetColor) return null;

    if (ctx.autoConfig.algorithm !== 'lab') {
      return ctx.precisionMatcher.findClosestColorWeighted(targetColor, palette);
    }

    const targetRgb = ctx.hexToRgb(targetColor);
    const targetLab = ctx.precisionMatcher.rgbToLab(targetRgb);
    const targetHsl = ctx.rgbToHsl(targetRgb);
    const targetFamily = ctx.getColorFamily(targetHsl);

    const preferSkinTone = !!(options && options.skinTone && ctx.activeSkinToneProtection);
    let bestGlobalHex = palette && palette.length > 0 ? palette[0].hex : targetColor;
    let bestGlobalDistance = Infinity;

    if (!preferSkinTone && ctx.labKDTree) {
      const nearest = ctx.precisionMatcher.findNearestPrecise(targetLab, ctx.labKDTree);
      if (nearest && nearest.lab) {
        bestGlobalHex = nearest.hex;
        bestGlobalDistance = ctx.precisionMatcher.deltaE(targetLab, nearest.lab);
      }
    }

    if (preferSkinTone || !ctx.labKDTree || bestGlobalDistance === Infinity) {
      const source = (ctx.paletteColorsLab && ctx.paletteColorsLab.length > 0) ? ctx.paletteColorsLab : (palette || []);
      for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (!c || !c.hex) continue;
        const lab = c.lab || ctx.precisionMatcher.rgbToLab(ctx.precisionMatcher.hexToRgb(c.hex));
        let dist = ctx.precisionMatcher.deltaE(targetLab, lab);
        if (preferSkinTone) {
          const isSkinColor = ctx.isPaletteSkinToneColor(c);
          dist += isSkinColor ? -6 : 12;
        }
        if (dist < bestGlobalDistance) {
          bestGlobalDistance = dist;
          bestGlobalHex = c.hex;
        }
      }
    }

    // 纯最近色策略：直接返回全局最近色
    if (ctx.autoConfig.paletteStrategy === 'nearest') {
      return bestGlobalHex;
    }

    if (!targetFamily || !ctx.paletteColorsLab || ctx.paletteColorsLab.length === 0) {
      return bestGlobalHex;
    }

    let bestFamilyHex = null;
    let bestFamilyDistance = Infinity;
    for (let i = 0; i < ctx.paletteColorsLab.length; i++) {
      const c = ctx.paletteColorsLab[i];
      if (!c || c.family !== targetFamily || !c.lab) continue;
      const dist = ctx.precisionMatcher.deltaE(targetLab, c.lab);
      if (dist < bestFamilyDistance) {
        bestFamilyDistance = dist;
        bestFamilyHex = c.hex;
      }
    }

    if (!bestFamilyHex || bestFamilyDistance === Infinity) {
      return bestGlobalHex;
    }

    if (bestGlobalDistance === Infinity) {
      return bestFamilyHex;
    }

    const distanceDiff = bestFamilyDistance - bestGlobalDistance;
    const baseTolerance = bestGlobalDistance < 10 ? 5 : 10;

    const priority = ctx.autoConfig.familyPriority || 'medium';
    let factor = 1.0;
    if (priority === 'low') factor = 0.5;
    else if (priority === 'high') factor = 2.0;
    const tolerance = baseTolerance * factor;

    if (bestFamilyDistance <= bestGlobalDistance || distanceDiff <= tolerance) {
      return bestFamilyHex;
    }

    return bestGlobalHex;
  },

  // src: smart-pixel-generator.vue:3804-3843
  calculateGradients(pixels) {
    const rows = pixels.length, cols = pixels[0].length;
    const gradients = [];
    
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        if (!pixels[y][x]) {
          row.push(0);
          continue;
        }
        
        // Sobel 算子计算梯度
        let gx = 0, gy = 0;
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= rows || nx < 0 || nx >= cols || !pixels[ny][nx]) continue;
            
            const rgb = ctx.hexToRgb(pixels[ny][nx]);
            const intensity = (rgb.r + rgb.g + rgb.b) / 3;
            
            // Sobel 核
            const gxKernel = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
            const gyKernel = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
            
            gx += intensity * gxKernel[dy + 1][dx + 1];
            gy += intensity * gyKernel[dy + 1][dx + 1];
          }
        }
        
        const gradient = Math.sqrt(gx * gx + gy * gy);
        row.push(gradient);
      }
      gradients.push(row);
    }
    
    return gradients;
  },

  // src: smart-pixel-generator.vue:3846-3862
  async applyDithering(original, mapped, palette) {
    // 方案D：检测色卡颜色数量，如果太少就跳过抖动
    if (palette.length < 10) {
      console.log('色卡颜色太少（', palette.length, '种），跳过抖动以避免噪点');
      return mapped;
    }
    
    // 方案A：计算梯度，只在渐变区域应用抖动
    const gradients = ctx.calculateGradients(original);
    
    if (ctx.autoConfig.dithering === 'floyd-steinberg') {
      return ctx.applyFloydSteinbergWithGradient(original, mapped, palette, gradients);
    } else if (ctx.autoConfig.dithering === 'atkinson') {
      return ctx.applyAtkinsonWithGradient(original, mapped, palette, gradients);
    }
    return mapped;
  },

  // src: smart-pixel-generator.vue:3865-3901
  async applyFloydSteinbergWithGradient(original, mapped, palette, gradients) {
    const rows = original.length, cols = original[0].length;
    const work = JSON.parse(JSON.stringify(original));
    const result = JSON.parse(JSON.stringify(mapped));
    
    const gradientThreshold = 20; // 梯度阈值，大于此值才应用抖动（提高到 20，更保守）
    let ditherApplied = 0, ditherSkipped = 0;
    
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const old = work[y][x];
        if (!old) continue;
        
        const gradient = gradients[y][x];
        const newC = ctx.findClosestColor(old, palette);
        result[y][x] = newC;
        
        // 只在梯度大的区域（渐变区域）应用抖动
        if (gradient > gradientThreshold) {
          const oRgb = ctx.hexToRgb(old), nRgb = ctx.hexToRgb(newC);
          const eR = oRgb.r - nRgb.r, eG = oRgb.g - nRgb.g, eB = oRgb.b - nRgb.b;
          if (x+1 < cols) ctx.addError(work, y, x+1, eR, eG, eB, 7/16);
          if (y+1 < rows) {
            if (x > 0) ctx.addError(work, y+1, x-1, eR, eG, eB, 3/16);
            ctx.addError(work, y+1, x, eR, eG, eB, 5/16);
            if (x+1 < cols) ctx.addError(work, y+1, x+1, eR, eG, eB, 1/16);
          }
          ditherApplied++;
        } else {
          ditherSkipped++;
        }
      }
    }
    
    console.log('抖动统计：应用=', ditherApplied, '跳过=', ditherSkipped);
    return result;
  },

  // src: smart-pixel-generator.vue:3904-3942
  async applyAtkinsonWithGradient(original, mapped, palette, gradients) {
    const rows = original.length, cols = original[0].length;
    const work = JSON.parse(JSON.stringify(original));
    const result = JSON.parse(JSON.stringify(mapped));
    
    const gradientThreshold = 20; // 与 Floyd-Steinberg 保持一致
    let ditherApplied = 0, ditherSkipped = 0;
    
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const old = work[y][x];
        if (!old) continue;
        
        const gradient = gradients[y][x];
        const newC = ctx.findClosestColor(old, palette);
        result[y][x] = newC;
        
        // 只在梯度大的区域应用抖动
        if (gradient > gradientThreshold) {
          const oRgb = ctx.hexToRgb(old), nRgb = ctx.hexToRgb(newC);
          const eR = oRgb.r - nRgb.r, eG = oRgb.g - nRgb.g, eB = oRgb.b - nRgb.b;
          if (x+1 < cols) ctx.addError(work, y, x+1, eR, eG, eB, 1/8);
          if (x+2 < cols) ctx.addError(work, y, x+2, eR, eG, eB, 1/8);
          if (y+1 < rows) {
            if (x > 0) ctx.addError(work, y+1, x-1, eR, eG, eB, 1/8);
            ctx.addError(work, y+1, x, eR, eG, eB, 1/8);
            if (x+1 < cols) ctx.addError(work, y+1, x+1, eR, eG, eB, 1/8);
          }
          if (y+2 < rows) ctx.addError(work, y+2, x, eR, eG, eB, 1/8);
          ditherApplied++;
        } else {
          ditherSkipped++;
        }
      }
    }
    
    console.log('Atkinson 抖动统计：应用=', ditherApplied, '跳过=', ditherSkipped);
    return result;
  },

  // src: smart-pixel-generator.vue:3945-3953
  addError(pixels, y, x, eR, eG, eB, factor) {
    const c = pixels[y][x];
    if (!c) return;
    const rgb = ctx.hexToRgb(c);
    const r = Math.max(0, Math.min(255, Math.round(rgb.r + eR * factor)));
    const g = Math.max(0, Math.min(255, Math.round(rgb.g + eG * factor)));
    const b = Math.max(0, Math.min(255, Math.round(rgb.b + eB * factor)));
    pixels[y][x] = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  },

  // src: smart-pixel-generator.vue:3955-3963
  getBlockUnityParams(level) {
    const lv = Math.max(0, Math.min(10, Math.round(level || 0)));
    if (lv <= 0) return null;
    if (lv <= 2) return { passes: 1, radius: 1, agreeThreshold: 0.72, maxPaletteJump: 22 };
    if (lv <= 4) return { passes: 1, radius: 1, agreeThreshold: 0.65, maxPaletteJump: 30 };
    if (lv <= 6) return { passes: 2, radius: 1, agreeThreshold: 0.58, maxPaletteJump: 38 };
    if (lv <= 8) return { passes: 2, radius: 2, agreeThreshold: 0.52, maxPaletteJump: 46 };
    return { passes: 3, radius: 2, agreeThreshold: 0.48, maxPaletteJump: 54 };
  },

  // src: smart-pixel-generator.vue:3965-4007
  applyBlockUnity(mapped, original, level) {
    const params = ctx.getBlockUnityParams(level);
    if (!params || !mapped || !mapped.length) return mapped;

    const rows = mapped.length;
    const cols = mapped[0] ? mapped[0].length : 0;
    if (!cols) return mapped;

    let result = JSON.parse(JSON.stringify(mapped));

    for (let pass = 0; pass < params.passes; pass++) {
      const next = JSON.parse(JSON.stringify(result));
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const current = result[y][x];
          if (!current) continue;
          if (ctx.isEdgePixel(y, x, original)) continue;

          const neighbors = ctx.getNeighborColors(result, x, y, params.radius);
          if (neighbors.length === 0) continue;

          const freq = new Map();
          neighbors.forEach(c => { if (c) freq.set(c, (freq.get(c) || 0) + 1); });
          let maxCount = 0;
          let dominant = null;
          freq.forEach((cnt, c) => {
            if (cnt > maxCount) {
              maxCount = cnt;
              dominant = c;
            }
          });

          if (!dominant || dominant === current) continue;
          if (maxCount / neighbors.length < params.agreeThreshold) continue;
          if (ctx.colorDistance(current, dominant) > params.maxPaletteJump) continue;
          next[y][x] = dominant;
        }
      }
      result = next;
    }

    return result;
  },

  // src: smart-pixel-generator.vue:4010-4039
  async applySmoothMode(mapped, original, palette) {
    const result = JSON.parse(JSON.stringify(mapped));
    const rows = mapped.length, cols = mapped[0].length;
    const level = Math.max(0, Math.min(10, Math.round(ctx.activeSmoothNoiseLevel || 0)));
    if (level <= 0) return result;
    const radius = level >= 7 ? 2 : 1;
    const threshold = level >= 7 ? 0.55 : (level >= 4 ? 0.6 : 0.68);
    const diffLimit = 24 + level * 2;
    
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (ctx.isEdgePixel(y, x, original)) continue;
        const neighbors = ctx.getNeighborColors(mapped, x, y, radius);
        if (neighbors.length === 0) continue;
        
        const freq = new Map();
        neighbors.forEach(c => { if (c) freq.set(c, (freq.get(c) || 0) + 1); });
        let maxCount = 0, mostCommon = null;
        freq.forEach((cnt, c) => { if (cnt > maxCount) { maxCount = cnt; mostCommon = c; } });
        
        if (mostCommon && maxCount / neighbors.length >= threshold) {
          const diff = ctx.colorDistance(result[y][x], mostCommon);
          if (diff < diffLimit) {
            result[y][x] = mostCommon;
          }
        }
      }
    }
    return result;
  },

  // src: smart-pixel-generator.vue:4042-4157
  cleanupPaletteNoise(pixels) {
    if (!pixels || !Array.isArray(pixels) || pixels.length === 0) return pixels;
    const rows = pixels.length;
    const cols = pixels[0] ? pixels[0].length : 0;
    if (!cols) return pixels;

    const level = ctx.activePaletteMergeLevel || 0;
    if (level <= 0) return pixels;

    const visited = Array(rows).fill(null).map(() => Array(cols).fill(false));
    const result = pixels.map(row => (row ? row.slice() : row));

    const directions = [
      [-1, 0],
      [0, 1],
      [1, 0],
      [0, -1]
    ];

    const maxRegionSize = Math.max(1, Math.min(10, Math.round(level)));

    let totalRegions = 0;
    let mergedRegions = 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (visited[y][x]) continue;
        const startColor = pixels[y][x];
        if (!startColor) {
          visited[y][x] = true;
          continue;
        }

        totalRegions++;

        const queue = [[x, y]];
        const region = [];
        visited[y][x] = true;

        while (queue.length) {
          const [cx, cy] = queue.shift();
          const currentColor = pixels[cy][cx];
          if (!currentColor) continue;

          region.push([cx, cy]);

          for (let i = 0; i < directions.length; i++) {
            const nx = cx + directions[i][0];
            const ny = cy + directions[i][1];
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            if (visited[ny][nx]) continue;

            const neighborColor = pixels[ny][nx];
            if (!neighborColor) {
              visited[ny][nx] = true;
              continue;
            }

            if (neighborColor === startColor) {
              visited[ny][nx] = true;
              queue.push([nx, ny]);
            }
          }
        }

        if (region.length <= 0 || region.length > maxRegionSize) continue;

        const neighborCount = new Map();
        for (let i = 0; i < region.length; i++) {
          const [rx, ry] = region[i];
          for (let d = 0; d < directions.length; d++) {
            const nx = rx + directions[d][0];
            const ny = ry + directions[d][1];
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            if (pixels[ny][nx] === startColor || !pixels[ny][nx]) continue;
            neighborCount.set(pixels[ny][nx], (neighborCount.get(pixels[ny][nx]) || 0) + 1);
          }
        }

        let dominantColor = null;
        let maxCount = 0;
        neighborCount.forEach((cnt, c) => {
          if (cnt > maxCount) {
            maxCount = cnt;
            dominantColor = c;
          }
        });
        if (!dominantColor) continue;

        const edgeCount = region.reduce((sum, [rx, ry]) => {
          let count = 0;
          for (let d = 0; d < directions.length; d++) {
            const nx = rx + directions[d][0];
            const ny = ry + directions[d][1];
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            if (pixels[ny][nx] && pixels[ny][nx] !== startColor) count++;
          }
          return sum + count;
        }, 0);
        if (edgeCount <= 0 || maxCount / edgeCount < 0.5) continue;

        for (let i = 0; i < region.length; i++) {
          const [rx, ry] = region[i];
          result[ry][rx] = dominantColor;
        }

        mergedRegions++;
      }
    }

    if (mergedRegions > 0) {
      console.log('孤色清理: 区域总数', totalRegions, '合并区域', mergedRegions, 'maxRegionSize:', maxRegionSize);
    }

    return result;
  },

  // src: smart-pixel-generator.vue:4160-4169
  isEdgePixel(y, x, pixels) {
    const rows = pixels.length, cols = pixels[0].length;
    if (y === 0 || y === rows - 1 || x === 0 || x === cols - 1) return true;
    const current = pixels[y][x];
    const neighbors = [pixels[y - 1][x], pixels[y + 1][x], pixels[y][x - 1], pixels[y][x + 1]];
    for (const n of neighbors) {
      if (ctx.colorDistance(current, n) > 50) return true;
    }
    return false;
  },

  // src: smart-pixel-generator.vue:4172-4176
  colorDistance(c1, c2) {
    if (!c1 || !c2) return 0;
    const r1 = ctx.hexToRgb(c1), r2 = ctx.hexToRgb(c2);
    return Math.sqrt((r1.r-r2.r)**2 + (r1.g-r2.g)**2 + (r1.b-r2.b)**2);
  },

  // src: smart-pixel-generator.vue:4179-4192
  getNeighborColors(pixels, x, y, radius) {
    const neighbors = [];
    const rows = pixels.length, cols = pixels[0].length;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
          neighbors.push(pixels[ny][nx]);
        }
      }
    }
    return neighbors;
  },

  // src: smart-pixel-generator.vue:4195-4203
  hexToRgb(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  },

  // src: smart-pixel-generator.vue:4205-4210
  rgbToHex(rgb) {
    const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
    const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
    const b = Math.max(0, Math.min(255, Math.round(rgb.b)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
  },

  // src: smart-pixel-generator.vue:4213-4243
  drawResult(target = ctx.step === 1 ? 'preview' : 'matched') {
    const canvasId = target === 'preview' ? 'previewCanvas' : 'matchedCanvas';
    console.log('开始绘制结果到 canvas');
    console.log('目标canvas:', canvasId);
    console.log('canvasSize:', ctx.canvasSize);
    console.log('pixelSize:', ctx.pixelSize);
    console.log('resultPixelData:', ctx.resultPixelData ? `${ctx.resultPixelData.length}x${ctx.resultPixelData[0]?.length}` : 'null');
    
    if (!ctx.resultPixelData || ctx.resultPixelData.length === 0) {
      console.error('resultPixelData 为空，无法绘制');
      return;
    }
    
    // 参考 palette-selector.vue，先检查 canvas 是否存在
    const query = uni.createSelectorQuery().in(this);
    query.select(`#${canvasId}`).boundingClientRect(data => {
      console.log('Canvas 节点信息:', data);
      
      if (!data) {
        console.error('Canvas 节点不存在！');
        // 延迟重试
        setTimeout(() => {
          ctx.drawResult(target);
        }, 300);
        return;
      }
      
      // Canvas 存在，开始绘制
      ctx.doDrawResult(canvasId);
    }).exec();
  },

  // src: smart-pixel-generator.vue:4511-4588
  applyPresetConfig(presetType) {
    const imgF = ctx.imageFeatures || {};
    
    // 其他预设使用固定配置
    switch (presetType) {
      case 'portrait-high':
        ctx.autoConfig.pixelizeMode = 'smooth';
        ctx.autoConfig.pixelMode = 'smooth';
        ctx.autoConfig.smoothMode = 'light';
        ctx.saturationLevel = 0.9;
        ctx.contrastLevel = 1.02;
        ctx.enableSkinToneProtection = true;
        break;
        
      case 'portrait-medium':
        ctx.autoConfig.pixelizeMode = 'smooth';
        ctx.autoConfig.pixelMode = 'default';
        ctx.autoConfig.smoothMode = 'light';
        ctx.saturationLevel = 1.0;
        ctx.contrastLevel = 1.05;
        ctx.enableSkinToneProtection = true;
        break;
        
      case 'illustration-character':
        ctx.autoConfig.pixelizeMode = 'sharp';
        ctx.autoConfig.pixelMode = 'preserve-edge';
        ctx.autoConfig.smoothMode = 'light';
        ctx.saturationLevel = 1.15;
        ctx.contrastLevel = 1.1;
        ctx.enableSkinToneProtection = false;
        break;
        
      case 'icon':
        ctx.autoConfig.pixelizeMode = 'sharp';
        ctx.autoConfig.pixelMode = 'preserve-edge';
        ctx.autoConfig.smoothMode = 'none';
        ctx.saturationLevel = 1.0;
        ctx.contrastLevel = 1.0;
        ctx.enableSkinToneProtection = false;
        break;
        
      case 'illustration':
        ctx.autoConfig.pixelizeMode = 'sharp';
        ctx.autoConfig.pixelMode = 'preserve-edge';
        ctx.autoConfig.smoothMode = imgF.edgeComplexity > 0.25 ? 'light' : 'medium';
        ctx.saturationLevel = 1.2;
        ctx.contrastLevel = 1.1;
        ctx.enableSkinToneProtection = false;
        break;
        
      case 'photo':
        ctx.autoConfig.pixelizeMode = 'smooth';
        ctx.autoConfig.pixelMode = 'default';
        ctx.autoConfig.smoothMode = 'light';
        ctx.saturationLevel = 1.1;
        ctx.contrastLevel = 1.08;
        ctx.enableSkinToneProtection = false;
        break;
        
      default:
        ctx.autoConfig.algorithm = 'lab';
        ctx.autoConfig.dithering = 'none';
        ctx.autoConfig.pixelizeMode = 'smart';
        ctx.autoConfig.pixelMode = 'default';
        ctx.autoConfig.smoothMode = 'light';
        ctx.autoConfig.paletteStrategy = 'nearest';
        ctx.autoConfig.familyPriority = 'medium';
        ctx.saturationLevel = 1.0;
        ctx.contrastLevel = 1.0;
        ctx.enableSkinToneProtection = false;
        ctx.paletteMergeLevel = 0;
        break;
    }
    
    // 更新描述
    ctx.updateDescription();
    console.log('已应用预设配置:', presetType);
  },

  // src: smart-pixel-generator.vue:4685-4716
  async regenerateFromPixelization() {
    ctx.loading = true;
    ctx.loadingText = '正在处理...';
    const token = ++ctx.activeGenerateToken;
    ctx.startPerformanceTrace('regenerate');
    
    try {
      await ctx.processImage(token);
      if (token !== ctx.activeGenerateToken) return;
      
      const matched = await ctx.matchColors(token);
      if (!matched || token !== ctx.activeGenerateToken) return;
      
      ctx.updateDescription();
      
      ctx.drawResult(ctx.step === 1 ? 'preview' : 'matched');
      ctx.finishPerformanceTrace();
    } catch (e) {
      console.error('重新生成失败:', e);
      if (token === ctx.activeGenerateToken) {
        uni.showToast({
          title: `处理失败: ${e.message || '未知错误'}`,
          icon: 'none',
          duration: 2000
        });
      }
    } finally {
      if (token === ctx.activeGenerateToken) {
        ctx.loading = false;
      }
    }
  },
};

/**
 * 主链上下文单例：函数体里的 `ctx` 就是它。
 * 方法挂在原型上、data() 默认值作为自有属性，避免 `Object.assign` 触发 computed 取值器。
 * 同一时刻只支持一个实例（试玩页 / selftest 够用），需要重跑就调用 `resetChainState()`。
 */
export const ctx = Object.assign(Object.create(chainMethods), createInitialState());

/** 复位到 data() 默认值（可覆盖），保留方法。 */
export function resetChainState(overrides = {}) {
  Object.assign(ctx, createInitialState(overrides));
  return ctx;
}
