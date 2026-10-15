/**
 * 端到端冒烟：用真实外部色卡（Mard 221）跑完两步，打印每步的实测数据。
 *
 * 用法：node scripts/smoke.mjs [像素大小]
 * 需要外部色卡目录（见 README「色卡数据」）；找不到时自动回落到内置合成色卡。
 */

import { runStructureStage, runMatchStage } from '../src/algorithm/stages.mjs';
import { listExternalPalettes, readExternalPalette, resolveColorDataRoot } from '../src/algorithm/color-data.node.mjs';
import { paletteByName } from '../src/algorithm/palettes.mjs';
import { syntheticScene } from '../src/algorithm/sample-scene.mjs';

const pixelSize = Number(process.argv[2]) || 96;
const source = syntheticScene(480, 320);

const root = resolveColorDataRoot();
console.log(`色卡根目录：${root ?? '未找到（将用内置合成色卡）'}`);

let palette;
let label;
if (root) {
  const available = await listExternalPalettes(root);
  console.log(`可用外部色卡：${available.map((p) => `${p.id}(${p.colorCount})`).join('、') || '（无）'}`);
  const mard = available.find((p) => p.id === 'mard-221');
  if (mard) {
    const loaded = await readExternalPalette(mard.id, root);
    palette = loaded.colors;
    label = `${loaded.label} · ${loaded.colorCount} 色`;
  }
}
if (!palette) {
  palette = paletteByName('152');
  label = '内置合成色卡 · 152 色';
}

console.log(`\n源图 ${source.width}×${source.height}，像素大小 ${pixelSize}，色卡 ${label}`);

// ---- 第一步：结构层 ----
const t1 = Date.now();
const structure = await runStructureStage({ source, pixelSize, palette });
console.log(`\n[第一步] 结构层`);
console.log(`  网格        ${structure.width}×${structure.height}（方板）`);
console.log(`  非空/留空   ${structure.occupiedCells} / ${structure.emptyCells}`);
console.log(`  像素调整模式 ${structure.settings ? 'ok' : '-'}  区域合并档 ${structure.settings.regionMergeLevel}  色彩简化档 ${structure.settings.colorMergeLevel}  平滑迭代 ${structure.settings.smoothIterations}`);
console.log(`  尺寸档位    ${structure.sizeTier}`);
console.log(`  耗时        ${structure.elapsed} ms`);

// ---- 第二步：色卡匹配 ----
const matched = await runMatchStage({ palette, dithering: 'none' });
console.log(`\n[第二步] 色卡匹配`);
console.log(`  用色        ${matched.ranked.length} / ${matched.paletteSize}`);
console.log(`  平均 ΔE00   ${matched.stats.mean.toFixed(2)}（中位 ${matched.stats.median.toFixed(2)}，最大 ${matched.stats.max.toFixed(2)}）`);
console.log(`  孤立豆      ${matched.isolatedCells} 格（${(matched.isolated * 100).toFixed(2)}%）`);
console.log(`  耗时        ${matched.elapsed} ms`);
console.log(`\n  用量前 8：${matched.ranked.slice(0, 8).map(([code, n]) => `${code}×${n}`).join('  ')}`);
console.log(`\n两步总耗时 ${Date.now() - t1} ms`);
