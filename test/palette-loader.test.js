/**
 * 外部色卡加载器的测试。
 *
 * 仓库里不含品牌色卡数据，所以「有数据」的那些断言在没有外部目录时自动跳过，
 * 只保留「没有数据时不炸」的断言——这样 clone 下来 `node --test` 永远是绿的。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { listExternalPalettes, readExternalPalette, resolveColorDataRoot } from '../src/algorithm/color-data.node.mjs';

const root = resolveColorDataRoot();

test('色卡根目录要么是 null，要么含 manifest.json', async () => {
  assert.ok(root === null || typeof root === 'string');
  if (root === null) return;

  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  assert.ok(existsSync(join(root, 'manifest.json')), '根目录下必须有 manifest.json');
});

test('没有色卡数据时，列出与读取都安全降级', async () => {
  const none = await listExternalPalettes(null);
  assert.deepEqual(none, []);

  const missing = await readExternalPalette('mard-221', null);
  assert.equal(missing, null);
});

test('未知系列返回 null，不抛异常', async () => {
  assert.equal(await readExternalPalette('这个系列不存在', root), null);
});

test('列出的每个系列都能读出颜色，且字段完整', { skip: root ? false : '没有外部色卡数据' }, async () => {
  const list = await listExternalPalettes(root);
  assert.ok(list.length > 0, '有色卡根目录时至少应列出一个系列');

  for (const item of list) {
    for (const key of ['id', 'dir', 'label', 'brand', 'paletteCode']) {
      assert.equal(typeof item[key], 'string', `${item.id} 缺少字段 ${key}`);
    }
    assert.ok(item.colorCount > 0);

    const loaded = await readExternalPalette(item.id, root);
    assert.ok(loaded, `${item.id} 应能读取`);
    assert.equal(loaded.colors.length, item.colorCount, `${item.id} 颜色数与列表不符`);
  }
});

test('Mard 221：221 色、色号与色值唯一、色值格式规范', { skip: root ? false : '没有外部色卡数据' }, async () => {
  const palette = await readExternalPalette('mard-221', root);
  if (!palette) return; // 外部目录里没有这一档就跳过

  assert.equal(palette.colors.length, 221);

  const codes = new Set(palette.colors.map((c) => c.code));
  const hexes = new Set(palette.colors.map((c) => c.hex));
  assert.equal(codes.size, 221, '色号应唯一');
  assert.equal(hexes.size, 221, '色值应唯一');

  for (const color of palette.colors) {
    assert.match(color.hex, /^#[0-9A-F]{6}$/, `色值格式不对：${color.hex}`);
    assert.ok(color.code.length > 0);
  }
});
