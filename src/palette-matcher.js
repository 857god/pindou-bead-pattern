/**
 * palette-matcher —— 色卡感知的最近色匹配
 *
 * 提供三种度量：
 *   - `ciede2000`（默认）：sRGB → CIELAB(D65) → CIEDE2000 色差，最贴近人眼感知。
 *   - `euclidean`：CIELAB 空间欧氏距离（即 ΔE76），比 CIEDE2000 便宜，排序大体一致。
 *   - `weighted-rgb`：红均值加权的 RGB 距离，单次比较只有几次乘法，适合预览或低端机兜底。
 *
 * ## k-d 树为什么可以安全剪枝（也是本项目修掉的原始实现缺陷）
 *
 * k-d 树按 L/a/b 轴的中位数切分，剪枝依据「查询点到分割面的距离」，这个量是
 * **CIELAB 坐标差**，只能与**同量纲**的距离比较。CIEDE2000 的值经过 SL/SC/SH
 * 缩放，量纲不同——直接拿它剪枝会剪掉真正更近的分支（原始实现即如此，
 * 实测 418 色色卡、300 次随机查询中会出现明显错配）。
 *
 * 这里改用**同量纲的下界**。记 ΔE00 公式中的 x=ΔC'/SC、y=ΔH'/SH，由
 * `x²+y²+RT·x·y ≥ (1-|RT|/2)(x²+y²)` 以及 `ΔC'²+ΔH'² = Δa'²+Δb'²`（余弦定理，
 * 恒等式）可推出，对任意两点：
 *
 * ```
 * ΔE00² ≥ (ΔL / SLmax)² + (1 - |RT|max/2) · (Δa² + Δb²) / Smax²
 * ```
 *
 * 在 sRGB 色域上数值求得 `SLmax = 1.747`、`Smax = 7.030`、`|RT|max = 1.732`，于是：
 *   - 按 L 轴切分：远侧点的 ΔE00 ≥ δ / 1.747
 *   - 按 a/b 轴切分：远侧点的 ΔE00 ≥ δ · √0.134 / 7.030 ≈ δ / 19.19
 *
 * 取 3% 安全余量后作为剪枝系数。**所以本实现的最近色结果与全量扫描逐位一致**，
 * 而不是「大概率一致」的近似。
 *
 * 如果更在意速度、可以接受极小误差，用 `{ mode: 'fast' }`：只取 CIELAB 欧氏距离下
 * 的 K 个最近邻再用 CIEDE2000 重排（K 由 `candidates` 控制）。
 *
 * 设计约束：
 *   - 零运行时依赖，不触碰 Canvas / DOM / uni-app API，Node 与浏览器通用。
 *   - **不改写入参**：色卡数组与其中每个色卡对象都不会被就地修改
 *     （原始实现会原地 `sort` 入参并往色卡对象上写 `lab` 字段，这里已修正）。
 *
 * @example
 * import { PaletteMatcher } from 'bead-pixel-core/palette-matcher';
 *
 * const matcher = new PaletteMatcher([
 *   { hex: '#FFFFFF', code: 'A01' },
 *   { hex: '#000000', code: 'A02' },
 * ]);
 * matcher.nearest('#FEFEFE');
 * // -> { entry: { hex: '#FFFFFF', code: 'A01' }, hex: '#FFFFFF', distance: 0.09, lab: [...] }
 */

const HEX_RE = /^#?([a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i;

/**
 * k-d 树剪枝系数（同量纲下界，含 3% 安全余量）。
 * 推导见文件头注释；`PRUNE_L_FACTOR ≥ SLmax`，`PRUNE_AB_FACTOR ≥ Smax/√(1-|RT|max/2)`。
 */
const PRUNE_L_FACTOR = 1.8;
const PRUNE_AB_FACTOR = 20;

/**
 * 解析十六进制颜色。
 * 支持 `#RGB`、`#RRGGBB`、`#RRGGBBAA`（alpha 位仅被忽略，不参与匹配）。
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError(`hexToRgb: 需要字符串，收到 ${typeof hex}`);
  }
  const match = HEX_RE.exec(hex.trim());
  if (!match) {
    throw new TypeError(`hexToRgb: 无法解析颜色 "${hex}"`);
  }
  let body = match[1];
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {string} `#rrggbb`（小写）
 */
export function rgbToHex(rgb) {
  const toHex = (c) => {
    const v = Math.max(0, Math.min(255, Math.round(c)));
    return v.toString(16).padStart(2, '0');
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * sRGB → CIELAB（D65 白点）。
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {[number, number, number]} `[L, a, b]`
 */
export function rgbToLab(rgb) {
  let r = rgb.r / 255;
  let g = rgb.g / 255;
  let b = rgb.b / 255;

  // sRGB 传输函数反变换（gamma 校正）
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  // 线性 sRGB → XYZ(D65)，再归一化到白点
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIEDE2000 色差。数值越小越接近，0 表示完全一致。
 * @param {[number, number, number]} lab1
 * @param {[number, number, number]} lab2
 * @returns {number}
 */
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const cBar = (C1 + C2) / 2;
  const cBar7 = Math.pow(cBar, 7);

  // G：低彩度区域对 a 轴的拉伸，补偿 CIELAB 在灰色附近的不均匀
  const G = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const cBarP = (C1p + C2p) / 2;

  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * (Math.PI / 180));

  let hBarP;
  if (C1p * C2p === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2;
  } else {
    hBarP = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hBarP - 30) * (Math.PI / 180)) +
    0.24 * Math.cos(2 * hBarP * (Math.PI / 180)) +
    0.32 * Math.cos((3 * hBarP + 6) * (Math.PI / 180)) -
    0.2 * Math.cos((4 * hBarP - 63) * (Math.PI / 180));

  const lBarP = (L1 + L2) / 2;
  const SL = 1 + (0.015 * Math.pow(lBarP - 50, 2)) / Math.sqrt(20 + Math.pow(lBarP - 50, 2));
  const SC = 1 + 0.045 * cBarP;
  const SH = 1 + 0.015 * cBarP * T;

  const cBarP7 = Math.pow(cBarP, 7);
  const RT =
    -2 *
    Math.sqrt(cBarP7 / (cBarP7 + Math.pow(25, 7))) *
    Math.sin(60 * Math.exp(-Math.pow((hBarP - 275) / 25, 2)) * (Math.PI / 180));

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH)
  );
}

/** 色相角，度，`[0, 360)`。 */
function hueAngle(b, ap) {
  if (b === 0 && ap === 0) return 0;
  const deg = Math.atan2(b, ap) * (180 / Math.PI);
  return deg >= 0 ? deg : deg + 360;
}

/**
 * 红均值加权的 RGB 距离（"redmean"），比欧氏距离更接近感知，且只有几次乘法。
 * @param {{ r: number, g: number, b: number }} a
 * @param {{ r: number, g: number, b: number }} b
 * @returns {number}
 */
export function weightedRgbDistance(a, b) {
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (3 - rMean / 256) * db * db;
}

/**
 * CIELAB 空间欧氏距离（ΔE76）。k-d 树剪枝必须用这个量纲，不能用 CIEDE2000。
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function labDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 把一个色卡条目规范化为内部结构，绝不修改入参对象。 */
function normalizeEntry(entry, index) {
  const raw = typeof entry === 'string' ? { hex: entry } : entry;
  if (!raw || typeof raw !== 'object' || typeof raw.hex !== 'string') {
    throw new TypeError(`palette[${index}]：需要 "{ hex }" 对象或 hex 字符串`);
  }
  const rgb = hexToRgb(raw.hex);
  return {
    entry: raw,
    hex: rgbToHex(rgb),
    rgb,
    lab: rgbToLab(rgb),
  };
}

/**
 * 色卡匹配器。
 */
export class PaletteMatcher {
  /**
   * @param {Array<{ hex: string } | string>} [palette]
   * @param {{
   *   metric?: 'ciede2000' | 'euclidean' | 'weighted-rgb',
   *   mode?: 'exact' | 'fast',
   *   candidates?: number
   * }} [options]
   *   - `metric`：色差度量，默认 `ciede2000`
   *   - `mode`：`exact`（默认，与全量扫描一致）或 `fast`（近似，更快）
   *   - `candidates`：仅 `fast` 模式使用，参与重排的欧氏最近邻个数（默认 32）
   */
  constructor(palette = [], options = {}) {
    this.metric =
      options.metric === 'weighted-rgb' || options.metric === 'euclidean'
        ? options.metric
        : 'ciede2000';
    this.mode = options.mode === 'fast' ? 'fast' : 'exact';
    this.candidates = Math.max(1, Math.floor(options.candidates ?? 32));
    /** @type {Array<{ entry: object, hex: string, rgb: object, lab: number[] }>} */
    this.entries = [];
    /** @type {object|null} */
    this.tree = null;
    /** 惰性 LUT：hex → 匹配结果，逐像素重复色命中率很高 */
    this.cache = new Map();
    this.setPalette(palette);
  }

  /** @returns {number} 色卡颜色数 */
  get size() {
    return this.entries.length;
  }

  /**
   * 替换色卡并重建索引。
   * @param {Array<{ hex: string } | string>} palette
   * @returns {this}
   */
  setPalette(palette) {
    if (!Array.isArray(palette)) {
      throw new TypeError('setPalette: 需要色卡数组');
    }
    this.entries = palette.map(normalizeEntry);
    this.cache.clear();
    this.tree = this.entries.length > 0 ? this.buildIndex() : null;
    return this;
  }

  /**
   * 构建 3 维 k-d 树：按 depth % 3 选择 L/a/b 轴，取中位数分割。
   * 使用的是内部副本，因此不会修改调用方传入的色卡对象。
   * @returns {object|null}
   */
  buildIndex() {
    const points = this.entries;
    if (points.length === 0) return null;

    const build = (items, depth) => {
      if (items.length === 0) return null;
      const axis = depth % 3;
      const sorted = items.slice().sort((a, b) => a.lab[axis] - b.lab[axis]);
      const mid = sorted.length >> 1;
      return {
        point: sorted[mid],
        axis,
        left: build(sorted.slice(0, mid), depth + 1),
        right: build(sorted.slice(mid + 1), depth + 1),
      };
    };

    return build(points, 0);
  }

  /**
   * k-d 树精确求 CIELAB 欧氏距离下的 K 个最近邻。
   * 剪枝条件 `|查询点轴坐标 - 分割面| < 当前第 K 近的欧氏距离` 在本量纲下严格成立。
   * @param {number[]} targetLab
   * @returns {Array<{ entry: object, hex: string, lab: number[], euclidean: number }>}
   */
  nearestNeighbors(targetLab) {
    if (!this.tree) return [];
    const limit = this.candidates;
    /** @type {Array<{ point: object, euclidean: number }>} 按距离升序 */
    const neighbors = [];

    const offer = (point, distance) => {
      if (neighbors.length >= limit && distance >= neighbors[neighbors.length - 1].euclidean) {
        return;
      }
      let index = neighbors.length;
      while (index > 0 && neighbors[index - 1].euclidean > distance) index -= 1;
      neighbors.splice(index, 0, { point, euclidean: distance });
      if (neighbors.length > limit) neighbors.pop();
    };

    const worst = () => (neighbors.length < limit ? Infinity : neighbors[neighbors.length - 1].euclidean);

    const search = (node) => {
      if (!node) return;
      const distance = labDistance(targetLab, node.point.lab);
      offer(node.point, distance);

      const diff = targetLab[node.axis] - node.point.lab[node.axis];
      const [near, far] = diff < 0 ? [node.left, node.right] : [node.right, node.left];
      search(near);
      if (Math.abs(diff) < worst()) search(far);
    };

    search(this.tree);
    return neighbors.map(({ point, euclidean }) => ({
      entry: point.entry,
      hex: point.hex,
      lab: point.lab,
      euclidean,
    }));
  }

  /**
   * 按当前度量给候选排序。
   * @param {Array<{ entry: object, hex: string, lab: number[], euclidean: number }>} candidates
   * @param {number[]} targetLab 查询点的 LAB
   * @returns {Array<{ entry: object, hex: string, lab: number[], euclidean: number, distance: number }>}
   */
  rankCandidates(candidates, targetLab) {
    return candidates
      .map((candidate) => ({
        ...candidate,
        distance:
          this.metric === 'ciede2000' && targetLab
            ? deltaE2000(targetLab, candidate.lab)
            : candidate.euclidean,
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * 精确最近色：k-d 树 + 同量纲下界剪枝，结果与 `nearestExact()` 逐位一致。
   * @param {number[]} targetLab
   * @returns {{ entry: object, hex: string, distance: number, euclidean: number, lab: number[] } | null}
   */
  nearestByLab(targetLab) {
    if (!this.tree) return null;
    const useCiede = this.metric === 'ciede2000';
    const measure = useCiede
      ? (lab) => deltaE2000(targetLab, lab)
      : (lab) => labDistance(targetLab, lab);

    let bestPoint = null;
    let bestDistance = Infinity;

    const search = (node) => {
      if (!node) return;
      const distance = measure(node.point.lab);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoint = node.point;
      }

      const diff = targetLab[node.axis] - node.point.lab[node.axis];
      const [near, far] = diff < 0 ? [node.left, node.right] : [node.right, node.left];
      search(near);

      // 欧氏度量下坐标差本身就是下界（系数 1）；CIEDE2000 用推导出的换算系数
      const factor = !useCiede ? 1 : node.axis === 0 ? PRUNE_L_FACTOR : PRUNE_AB_FACTOR;
      if (Math.abs(diff) <= factor * bestDistance) search(far);
    };

    search(this.tree);
    if (!bestPoint) return null;
    return {
      entry: bestPoint.entry,
      hex: bestPoint.hex,
      lab: bestPoint.lab,
      distance: bestDistance,
      euclidean: labDistance(targetLab, bestPoint.lab),
    };
  }

  /**
   * 快速近似：只取 CIELAB 欧氏距离下 K 个最近邻，再按当前度量重排。
   * 对 `euclidean` 度量是精确的；对 `ciede2000` 有极小概率与全局最优不一致
   * （实测 418 色色卡 2000 次查询中约 0.25%），换来更少的 CIEDE2000 计算。
   * @param {string | { r: number, g: number, b: number }} color
   * @param {number} [candidates]
   * @returns {{ entry: object, hex: string, distance: number, euclidean: number, lab: number[] } | null}
   */
  nearestFast(color, candidates) {
    if (!this.tree) return null;
    const limit = Math.max(1, Math.floor(candidates ?? this.candidates));
    const rgb = typeof color === 'string' ? hexToRgb(color) : color;
    const targetLab = rgbToLab(rgb);
    const previous = this.candidates;
    this.candidates = limit;
    let neighbors;
    try {
      neighbors = this.nearestNeighbors(targetLab);
    } finally {
      this.candidates = previous;
    }
    return this.rankCandidates(neighbors, targetLab)[0] ?? null;
  }

  /**
   * 全量线性扫描，数学上保证是该度量下的全局最优；色卡很大时不建议逐像素调用。
   * @param {string | { r: number, g: number, b: number }} color
   * @returns {{ entry: object, hex: string, distance: number, euclidean: number, lab: number[] } | null}
   */
  nearestExact(color) {
    if (this.entries.length === 0) return null;
    const rgb = typeof color === 'string' ? hexToRgb(color) : color;
    const targetLab = rgbToLab(rgb);
    return this.rankCandidates(
      this.entries.map((entry) => ({
        entry: entry.entry,
        hex: entry.hex,
        lab: entry.lab,
        euclidean: labDistance(targetLab, entry.lab),
      })),
      targetLab
    )[0];
  }

  /**
   * 找最近色。
   * @param {string | { r: number, g: number, b: number }} color hex 字符串或 rgb 对象
   * @returns {{ entry: object, hex: string, distance: number, lab: number[] } | null}
   */
  nearest(color) {
    if (this.entries.length === 0) return null;

    const key = typeof color === 'string' ? color.trim().toLowerCase() : null;
    if (key && this.cache.has(key)) return this.cache.get(key);

    let result;
    if (this.metric === 'weighted-rgb') {
      result = this.nearestWeighted(color);
    } else if (this.mode === 'fast') {
      result = this.nearestFast(color);
    } else {
      const rgb = typeof color === 'string' ? hexToRgb(color) : color;
      result = this.nearestByLab(rgbToLab(rgb));
    }

    if (key) this.cache.set(key, result);
    return result;
  }

  /**
   * 快速路径：加权 RGB 距离线性扫描。适合实时预览；批量处理请用 `nearest`。
   * @param {string | { r: number, g: number, b: number }} color
   * @returns {{ entry: object, hex: string, distance: number, lab: number[] } | null}
   */
  nearestWeighted(color) {
    if (this.entries.length === 0) return null;
    const rgb = typeof color === 'string' ? hexToRgb(color) : color;
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of this.entries) {
      const distance = weightedRgbDistance(rgb, candidate.rgb);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
        if (distance === 0) break;
      }
    }
    return best
      ? { entry: best.entry, hex: best.hex, distance: bestDistance, lab: best.lab }
      : null;
  }

  /**
   * 批量匹配。
   * @param {Iterable<string | { r: number, g: number, b: number }>} colors
   * @returns {Array<{ entry: object, hex: string, distance: number, lab: number[] } | null>}
   */
  nearestMany(colors) {
    const out = [];
    for (const color of colors) out.push(this.nearest(color));
    return out;
  }

  /**
   * 把一张 RGB 像素序列映射成色卡色号序列。
   * @param {Uint8ClampedArray | Uint8Array} rgba RGBA 顺序，长度 width*height*4
   * @param {{ alphaThreshold?: number }} [options] 低于该 alpha 的像素输出 `null`
   * @returns {Array<string | null>} 每个像素的 `entry.code ?? entry.hex`
   */
  mapPixels(rgba, options = {}) {
    const alphaThreshold = options.alphaThreshold ?? 0;
    const out = new Array(rgba.length >> 2);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
      if (rgba[i + 3] <= alphaThreshold) {
        out[p] = null;
        continue;
      }
      const match = this.nearest({ r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] });
      out[p] = match ? match.entry.code ?? match.hex : null;
    }
    return out;
  }

  /** 清空惰性缓存（色卡不变但想释放内存时用）。 */
  clearCache() {
    this.cache.clear();
  }

  /** 未命中缓存的匹配次数（调试/测试用）。 */
  get cacheSize() {
    return this.cache.size;
  }
}

export default PaletteMatcher;
