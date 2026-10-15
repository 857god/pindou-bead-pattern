/**
 * 演示用色卡（demo 与 examples 共用，保证同一份数据源）。
 *
 * 这两个色卡是**合成**的，不含任何品牌色号数据：真实拼豆色卡动辄 200-300 色，
 * 这里用「色相 × 明度 × 饱和度」的规则网格近似，够用来观察色卡规模对成像的影响。
 */

/** HSL → `#rrggbb`（h 为 0-360，s/l 为 0-1）。 */
export function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 小色卡：5 级灰阶 + 12 色相 × 1 档明度 = 17 色，模拟「入门小盒」。 */
export const SMALL_PALETTE = (() => {
  const neutrals = ['#000000', '#3F3F3F', '#7F7F7F', '#BFBFBF', '#FFFFFF'];
  const list = neutrals.map((hex, i) => ({ hex, code: `S${String(i).padStart(2, '0')}` }));
  for (let i = 0; i < 12; i += 1) {
    list.push({ hex: hslToHex((i / 12) * 360, 0.78, 0.5), code: `S${(i + 5).toString().padStart(2, '0')}` });
  }
  return list;
})();

/**
 * 大色卡：8 级灰阶 + 12 色相 × 4 档明度 × 3 档饱和度 = 152 色。
 * 关键是带低饱和的中间调——真实拼豆色卡里这类颜色才是主力，
 * 只有纯色相环会把灰调天空硬拽到灰阶上。
 */
export const LARGE_PALETTE = (() => {
  const list = [];
  const neutrals = [0, 0.12, 0.25, 0.4, 0.55, 0.72, 0.88, 1];
  neutrals.forEach((l, i) => list.push({ hex: hslToHex(0, 0, l), code: `L${String(i).padStart(2, '0')}` }));
  const saturations = [0.78, 0.5, 0.26];
  const lightnesses = [0.3, 0.44, 0.58, 0.72];
  for (let hi = 0; hi < 12; hi += 1) {
    for (const [si, s] of saturations.entries()) {
      for (const [li, l] of lightnesses.entries()) {
        const index = hi * (saturations.length * lightnesses.length) + si * lightnesses.length + li + 8;
        list.push({ hex: hslToHex((hi / 12) * 360, s, l), code: `L${String(index).padStart(3, '0')}` });
      }
    }
  }
  return list;
})();

/** 批量造色卡：hueCount 个色相 × 若干明度档 × 若干饱和度档 + 灰阶。 */
export function buildPalette({ hues = 12, lightnesses = [0.3, 0.44, 0.58, 0.72], saturations = [0.78, 0.5, 0.26], neutrals = 8 } = {}) {
  const list = [];
  for (let i = 0; i < neutrals; i += 1) {
    list.push({ hex: hslToHex(0, 0, neutrals === 1 ? 0.5 : i / (neutrals - 1)), code: `G${String(i).padStart(2, '0')}` });
  }
  for (let hi = 0; hi < hues; hi += 1) {
    for (const [si, s] of saturations.entries()) {
      for (const [li, l] of lightnesses.entries()) {
        const index = hi * saturations.length * lightnesses.length + si * lightnesses.length + li;
        list.push({ hex: hslToHex((hi / hues) * 360, s, l), code: `C${String(index).padStart(4, '0')}` });
      }
    }
  }
  return list;
}

/** 试玩页下拉框里的四档色卡。键统一是字符串，避免数字键查不到的老坑。 */
export const PRESET_PALETTES = {
  17: SMALL_PALETTE,
  40: buildPalette({ hues: 6, lightnesses: [0.32, 0.5, 0.68], saturations: [0.7, 0.35], neutrals: 4 }),
  152: LARGE_PALETTE,
  300: buildPalette({
    hues: 12,
    lightnesses: [0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76],
    saturations: [0.8, 0.55, 0.3],
    neutrals: 12,
  }),
};

/** 按名字取预设色卡，未知名字回落到 152 色。 */
export function paletteByName(name) {
  return PRESET_PALETTES[String(name)] ?? LARGE_PALETTE;
}
