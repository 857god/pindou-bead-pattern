/**
 * 色卡数据的 Node 侧读取（只给 Vite 开发服务器的中间件用，浏览器不 import）。
 *
 * 品牌色卡数据**不进本仓库**：仓库里只有合成色卡（`palettes.mjs`）和这个加载器。
 * 真实品牌色卡按 `pindou-color-data` 仓库的约定放在外部目录里：
 *
 *   色卡根目录/
 *   ├── manifest.json
 *   └── <系列目录>/colors.json     # [{ code, hex, rgb, group, source, unidentified? }]
 *
 * 根目录解析顺序：
 *   1. 环境变量 `PINDOU_COLOR_DATA_ROOT`
 *   2. `../pindou-color-data`、`./data/pindou-color-data`
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 已知系列的展示名；不在表里的目录直接用目录名。 */
const KNOWN_LABELS = {
  'mard-221-alfonse-doudou': { id: 'mard-221', label: 'Mard 221 · 社区 alfonse-doudou 版', brand: 'Mard', paletteCode: 'Mard-221' },
  'mard-221-github': { id: 'mard-221-github', label: 'Mard 221 · 源码版', brand: 'Mard', paletteCode: 'Mard-221-src' },
  'mard-291-github': { id: 'mard-291', label: 'Mard 291', brand: 'Mard', paletteCode: 'Mard-291' },
  'artkal-m-221-official': { id: 'artkal-m-221', label: 'Artkal M 221 · 官方', brand: 'Artkal', paletteCode: 'Artkal-M-221' },
  'artkal-c-197-official': { id: 'artkal-c-197', label: 'Artkal C 197 · 官方', brand: 'Artkal', paletteCode: 'Artkal-C-197' },
};

/** 按优先级找色卡数据根目录；找不到返回 null（此时界面只有合成色卡）。 */
export function resolveColorDataRoot() {
  const candidates = [
    process.env.PINDOU_COLOR_DATA_ROOT,
    join(REPO_ROOT, '..', 'pindou-color-data'),
    join(REPO_ROOT, 'data', 'pindou-color-data'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'manifest.json'))) return candidate;
  }
  return null;
}

/** 把一个系列的 colors.json 归一化成 `[{code, hex}]`。 */
function normalizeColors(raw) {
  const colors = Array.isArray(raw) ? raw : raw.colors;
  if (!Array.isArray(colors) || colors.length === 0) return [];
  return colors
    .filter((c) => !c.unidentified) // 占位色号（UNKNOWN-*）默认剔除
    .map((c) => ({ code: String(c.code), hex: String(c.hex).toUpperCase().slice(0, 7) }));
}

/** 扫描色卡根目录，列出可用系列；没有根目录时返回空数组。 */
export async function listExternalPalettes(root = resolveColorDataRoot()) {
  if (!root) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, 'colors.json');
    if (!existsSync(file)) continue;
    const known = KNOWN_LABELS[entry.name];
    const colors = normalizeColors(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
    if (colors.length === 0) continue;
    found.push({
      id: known?.id ?? entry.name,
      dir: entry.name,
      label: known?.label ?? entry.name,
      brand: known?.brand ?? entry.name,
      paletteCode: known?.paletteCode ?? entry.name,
      colorCount: colors.length,
      kind: 'external',
    });
  }

  return found.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
}

/** 读取某个系列的颜色；目录名或 `id` 都可以。 */
export async function readExternalPalette(key, root = resolveColorDataRoot()) {
  if (!root) return null;
  const list = await listExternalPalettes(root);
  const entry = list.find((p) => p.id === key || p.dir === key);
  if (!entry) return null;
  const raw = JSON.parse((await readFile(join(root, entry.dir, 'colors.json'), 'utf8')).replace(/^\uFEFF/, ''));
  return { ...entry, colors: normalizeColors(raw) };
}
