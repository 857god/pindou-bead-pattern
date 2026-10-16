/**
 * 两步成像的 Node 侧测试：不需要浏览器（canvas stub 是纯 JS 实现），
 * 所以能在无头环境里直接验证「结构层 → 匹配层」的拆分是否正确。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runStructureStage, runMatchStage, previewStandardSettings } from '../src/algorithm/stages.mjs';
import { PRESET_PALETTES, paletteByName } from '../src/algorithm/palettes.mjs';
import { syntheticScene } from '../src/algorithm/sample-scene.mjs';
import { resetChainState } from '../src/algorithm/chain.mjs';

const source = syntheticScene(96, 64);
const palette = paletteByName('152');
const HEX = /^#[0-9A-F]{6}$/;

test('结构层产出方板网格，留空处为 null', async () => {
  const structure = await runStructureStage({ source, pixelSize: 24, palette });

  assert.equal(structure.width, 24);
  assert.equal(structure.height, 24, '方板模型：高也应是 pixelSize');
  assert.equal(structure.cells, 576);
  assert.equal(structure.hexGrid.length, 24);
  assert.equal(structure.hexGrid[0].length, 24);
  assert.equal(structure.rgba.length, structure.cells * 4);

  // 96×64 的源图放进 24×24 方板：内容 24×16，上下各留 4 行
  assert.equal(structure.emptyCells, 24 * 4 * 2);
  assert.equal(structure.occupiedCells, structure.cells - structure.emptyCells);

  let checked = 0;
  for (const row of structure.hexGrid) {
    for (const hex of row) {
      if (hex === null) continue;
      assert.ok(HEX.test(hex), `结构网格里出现了非 HEX 值：${hex}`);
      checked += 1;
    }
  }
  assert.equal(checked, structure.occupiedCells);
});

test('匹配层产出色号，且色号全部来自色卡', async () => {
  await runStructureStage({ source, pixelSize: 24, palette });
  const matched = await runMatchStage({ palette });

  assert.equal(matched.width, 24);
  assert.equal(matched.height, 24);
  assert.equal(matched.codes.length, matched.cells);
  assert.equal(matched.rgba.length, matched.cells * 4);

  const allowed = new Set(palette.map((p) => p.code));
  for (const code of matched.codes) {
    if (code === null) continue;
    assert.ok(allowed.has(code), `色号 ${code} 不在色卡里`);
  }

  const total = matched.ranked.reduce((sum, [, count]) => sum + count, 0);
  assert.equal(total, matched.occupiedCells, '用量合计应等于非空格数');
  assert.equal(matched.ranked.length, matched.usage.size);
  for (let i = 1; i < matched.ranked.length; i += 1) {
    assert.ok(matched.ranked[i - 1][1] >= matched.ranked[i][1], 'ranked 应按用量降序');
  }
});

test('色差统计只算非空格（留空格不参与，否则平均值被稀释）', async () => {
  await runStructureStage({ source, pixelSize: 24, palette });
  const matched = await runMatchStage({ palette });

  assert.ok(matched.stats.mean > 0 && matched.stats.mean < 100);
  assert.ok(matched.stats.median <= matched.stats.max);
  assert.ok(matched.stats.mean <= matched.stats.max);
  assert.ok(matched.isolated >= 0 && matched.isolated <= 1);
  assert.equal(matched.isolated, matched.isolatedCells / matched.occupiedCells);
});

test('没跑结构层就调匹配层会明确报错', async () => {
  resetChainState();
  await assert.rejects(() => runMatchStage({ palette }), /需要先跑结构层/);
});

test('源图为空 / 色卡为空会报 TypeError', async () => {
  await assert.rejects(() => runStructureStage({ source: null, pixelSize: 24, palette }), TypeError);
  await assert.rejects(() => runStructureStage({ source, pixelSize: 24, palette: [] }), TypeError);
});

test('自定义结构档位会真的改变结构结果', async () => {
  const standard = await runStructureStage({ source, pixelSize: 32, palette, pipelineMode: 'new' });
  const custom = await runStructureStage({
    source,
    pixelSize: 32,
    palette,
    pipelineMode: 'legacy',
    customAdjustments: { colorClean: 10, backgroundClean: 6, blockClarity: 6, edgeKeep: 4 },
  });

  assert.equal(custom.settings.colorMergeLevel > standard.settings.colorMergeLevel, true);

  let differences = 0;
  for (let y = 0; y < standard.height; y += 1) {
    for (let x = 0; x < standard.width; x += 1) {
      if (standard.hexGrid[y][x] !== custom.hexGrid[y][x]) differences += 1;
    }
  }
  assert.ok(differences > 0, '自定义档位应该改变结构网格');
});

test('匹配层去杂色档位会真的改变结果', async () => {
  await runStructureStage({ source, pixelSize: 32, palette });
  const off = await runMatchStage({
    palette,
    matchMode: 'custom',
    matchParams: { paletteMergeLevel: 0, smoothNoiseLevel: 0, blockUnityLevel: 0 },
  });

  await runStructureStage({ source, pixelSize: 32, palette });
  const on = await runMatchStage({
    palette,
    matchMode: 'custom',
    matchParams: { paletteMergeLevel: 1, smoothNoiseLevel: 1, blockUnityLevel: 2 },
  });

  assert.ok(on.isolated < off.isolated, `去杂色应减少孤立豆（${off.isolated} → ${on.isolated}）`);
});

test('「同色系」策略真的改变结果（不是假控件）', async () => {
  await runStructureStage({ source, pixelSize: 32, palette });
  const nearest = await runMatchStage({
    palette,
    matchMode: 'custom',
    matchParams: { paletteStrategy: 'nearest' },
  });

  await runStructureStage({ source, pixelSize: 32, palette });
  const family = await runMatchStage({
    palette,
    matchMode: 'custom',
    matchParams: { paletteStrategy: 'family', familyPriority: 'high' },
  });

  let differences = 0;
  for (let i = 0; i < nearest.codes.length; i += 1) {
    if (nearest.codes[i] !== family.codes[i]) differences += 1;
  }
  assert.ok(differences > 0, '同色系策略应该改变色号分布');
});

test('像素大小越大格数越多（方板关系成立）', async () => {
  const small = await runStructureStage({ source, pixelSize: 16, palette });
  const large = await runStructureStage({ source, pixelSize: 40, palette });

  assert.equal(small.cells, 16 * 16);
  assert.equal(large.cells, 40 * 40);
  assert.ok(large.occupiedCells > small.occupiedCells);
});

test('标准档位预览：随尺寸档位变化，且不留副作用', async () => {
  const small = previewStandardSettings(30);
  const medium = previewStandardSettings(80);
  const xlarge = previewStandardSettings(150);

  assert.equal(small.sizeTier, 'small');
  assert.equal(medium.sizeTier, 'medium');
  assert.equal(xlarge.sizeTier, 'xlarge');

  // 结构层基线：小尺寸做背景/颜色简化，大尺寸全部交还给算法本身
  assert.deepEqual(
    [small.structure.backgroundClean, small.structure.colorClean, small.structure.noiseSmooth],
    [2, 2, 1],
  );
  assert.deepEqual(
    [medium.structure.backgroundClean, medium.structure.colorClean, medium.structure.blockClarity],
    [1, 0, 1],
  );
  assert.deepEqual(
    [xlarge.structure.backgroundClean, xlarge.structure.colorClean, xlarge.structure.noiseSmooth],
    [0, 0, 0],
  );

  // 匹配层基线：小尺寸最保守，大尺寸更强，超大尺寸回落
  assert.deepEqual(
    [small.match.paletteMergeLevel, small.match.smoothNoiseLevel, small.match.blockUnityLevel],
    [1, 1, 2],
  );
  assert.deepEqual(
    [medium.match.paletteMergeLevel, medium.match.smoothNoiseLevel, medium.match.blockUnityLevel],
    [1, 2, 3],
  );
  assert.deepEqual(
    [xlarge.match.paletteMergeLevel, xlarge.match.smoothNoiseLevel, xlarge.match.blockUnityLevel],
    [2, 2, 3],
  );
  assert.equal(small.match.enableSkinToneProtection, false);

  // 预览不应改变主链状态：预览后再跑一遍，结果与直接跑一致
  const before = previewStandardSettings(52);
  const structure = await runStructureStage({ source, pixelSize: 52, palette });
  assert.equal(structure.settings.backgroundClean, before.structure.backgroundClean);
});

test('内置合成色卡四档都能跑通匹配', async () => {
  for (const key of Object.keys(PRESET_PALETTES)) {
    const colors = PRESET_PALETTES[key];
    assert.equal(colors.length, Number(key) === 17 ? 17 : colors.length);
    await runStructureStage({ source, pixelSize: 20, palette: colors });
    const matched = await runMatchStage({ palette: colors });
    assert.ok(matched.ranked.length > 0, `${key} 色卡没有产出任何色号`);
    assert.ok(matched.ranked.length <= colors.length);
  }
});
