/** 色卡数据的归一化与排序：界面不关心色卡来自内置还是外部目录。 */

/** 把 hex 统一成 `#rrggbb` 小写；算法内部按小写 hex 查色号。 */
export function normalizeHex(hex) {
  if (typeof hex !== 'string') return '';
  const value = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return '';
}

/**
 * `loadPalette()` 的 colors → `[{ code, hex }]`，丢掉无效项。
 * @param {Array<{code?: string, hex?: string}>} colors
 */
export function normalizePaletteColors(colors) {
  if (!Array.isArray(colors)) return [];
  const out = [];
  for (const color of colors) {
    if (!color) continue;
    const hex = normalizeHex(color.hex);
    if (!hex) continue;
    out.push({ code: String(color.code ?? hex), hex });
  }
  return out;
}

/** 色卡编码排序：`Mard-2` 排在 `Mard-10` 前面。 */
export function sortPaletteInfosByCode(infos) {
  return [...(infos || [])].sort((a, b) =>
    String(a.paletteCode || '').localeCompare(String(b.paletteCode || ''), 'zh-Hans-CN', { numeric: true }),
  );
}
