/**
 * 色卡来源门面：合成色卡（仓库自带）+ 外部品牌色卡（运行时按需读取，不入库）。
 *
 * 对外只暴露「列出品牌/色卡」和「按 id 取颜色」两件事，界面不需要关心
 * 色卡是内置的还是从外部目录来的。
 *
 * id 约定：
 *   `synthetic:<17|40|152|300>`  → 仓库自带的合成色卡，永远可用
 *   `external:<目录名>`           → 外部品牌色卡，走 `/palettes/index.json` 与 `/palettes/<id>.json`
 *
 * **可选范围由本文件决定**：外部数据里有 Mard 291 时，页面就只提供它这一张
 * （连内置合成色卡也不列出来，界面已经没得选，品牌下拉会自动隐藏）；
 * 没有外部品牌数据时（clone 下来就是这样）退回四档合成色卡，保证开箱能跑。
 */

import { PRESET_PALETTES } from './palettes.mjs';

export const PALETTE_ENDPOINT = '/palettes';

/** 页面只开放这一张品牌色卡（外部数据里目录 `mard-291-github` 的 id）。 */
export const PREFERRED_PALETTE_ID = 'mard-291';

/** 没有外部品牌数据时默认选中的内置合成色卡：色最全的那张，示例效果最好。 */
const FALLBACK_PALETTE_ID = 'synthetic:152';

const SYNTHETIC_LABELS = {
  17: '17 色 · 灰阶 + 纯色相环',
  40: '40 色 · 6 色相',
  152: '152 色 · 均匀色相网格',
  300: '300 色 · 均匀色相网格',
};

/** 仓库自带的合成色卡。 */
export function listSyntheticPalettes() {
  return Object.entries(PRESET_PALETTES).map(([key, colors]) => ({
    id: `synthetic:${key}`,
    label: SYNTHETIC_LABELS[key] ?? `${key} 色`,
    brand: '内置合成色卡',
    paletteCode: `synthetic-${key}`,
    colorCount: colors.length,
    kind: 'synthetic',
  }));
}

/**
 * 全部可选色卡。
 *
 * 有 Mard 291 时只返回它一张；没有外部数据时返回四档内置合成色卡（默认那张排在最前）。
 * 外部数据不可用是正常情况，不报错。
 */
export async function listPalettes() {
  const synthetic = listSyntheticPalettes();
  let external = [];

  try {
    const response = await fetch(`${PALETTE_ENDPOINT}/index.json`);
    if (response.ok) {
      const data = await response.json();
      external = (data.palettes ?? []).map((item) => ({
        id: `external:${item.id}`,
        label: item.label,
        brand: item.brand,
        paletteCode: item.paletteCode,
        colorCount: item.colorCount,
        kind: 'external',
      }));
    }
  } catch {
    // 没有外部色卡数据是正常情况，不是错误
  }

  // 有指定的品牌色卡：只留它，其他品牌和内置合成色卡都不再出现在列表里
  const preferred = external.filter((item) => item.id === `external:${PREFERRED_PALETTE_ID}`);
  if (preferred.length) return { external: preferred, synthetic: [], all: preferred };

  // 没有外部品牌数据：四档合成色卡都能选，把默认那张排到最前（界面默认选中第一张）
  const fallback = synthetic.find((item) => item.id === FALLBACK_PALETTE_ID);
  const all = fallback ? [fallback, ...synthetic.filter((item) => item !== fallback)] : synthetic;
  return { external: [], synthetic, all };
}

/**
 * 按 id 取色卡颜色，统一成 `[{ code, hex }]`。
 * @param {string} id 形如 `synthetic:152` 或 `external:mard-221`
 */
export async function loadPalette(id) {
  if (typeof id !== 'string' || !id) throw new Error('色卡 id 为空');

  const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];

  if (kind === 'synthetic') {
    const colors = PRESET_PALETTES[key];
    if (!colors) throw new Error(`未知的内置色卡：${key}`);
    return { id, label: SYNTHETIC_LABELS[key] ?? `${key} 色`, brand: '内置合成色卡', colors };
  }

  if (kind === 'external') {
    const response = await fetch(`${PALETTE_ENDPOINT}/${encodeURIComponent(key)}.json`);
    if (!response.ok) throw new Error(`色卡 ${key} 加载失败（HTTP ${response.status}）`);

    // 静态托管常常把找不到的路径回退成 index.html（状态码也是 200），
    // 这时直接 response.json() 会抛出一个看不懂的解析错误，先挡在这里。
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType && !contentType.includes('json')) {
      throw new Error(`色卡 ${key} 加载失败：服务端返回的不是 JSON（${contentType.split(';')[0]}）`);
    }

    const data = await response.json();
    if (!Array.isArray(data.colors) || data.colors.length === 0) throw new Error(`色卡 ${key} 没有颜色数据`);
    return { id, label: data.label ?? key, brand: data.brand ?? key, colors: data.colors };
  }

  throw new Error(`无法识别的色卡 id：${id}`);
}
