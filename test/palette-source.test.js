/**
 * 色卡门面的测试。
 *
 * `palette-source.mjs` 是浏览器侧模块（用 `fetch`），但它本身不碰 DOM，
 * 所以这里用假的 `fetch` 就能在 Node 里完整验证：合并内外色卡、按 id 取色、
 * 外部数据缺失时安全降级。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { listPalettes, loadPalette, listSyntheticPalettes } from '../src/algorithm/palette-source.mjs';

const INDEX = {
  palettes: [
    { id: 'artkal-c-197', label: 'Artkal C 197', brand: 'Artkal', paletteCode: 'Artkal-C-197', colorCount: 2, kind: 'external' },
    { id: 'mard-221', label: 'Mard 221', brand: 'Mard', paletteCode: 'Mard-221', colorCount: 2, kind: 'external' },
    { id: 'mard-291', label: 'Mard 291', brand: 'Mard', paletteCode: 'Mard-291', colorCount: 3, kind: 'external' },
  ],
};
const MARD = {
  id: 'mard-221',
  label: 'Mard 221',
  brand: 'Mard',
  colors: [
    { code: 'A1', hex: '#FAF5CD' },
    { code: 'B1', hex: '#2F2B2F' },
  ],
};

/** 造一个 Response 样子的小对象（只带被测代码用到的字段）。 */
function fakeResponse({ ok, status, body, contentType = 'application/json; charset=utf-8' }) {
  return {
    ok,
    status,
    headers: { get: (key) => (String(key).toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => {
      if (contentType.includes('html')) throw new SyntaxError('Unexpected token < in JSON at position 0');
      return body;
    },
  };
}

/** 装一个只认指定路由的假 fetch，返回一个卸载函数。 */
function stubFetch(routes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const hit = routes[String(url)];
    if (hit === undefined) return fakeResponse({ ok: false, status: 404, body: {} });
    if (hit instanceof Error) throw hit;
    if (hit && hit.__html) return fakeResponse({ ok: true, status: 200, contentType: 'text/html; charset=utf-8' });
    return fakeResponse({ ok: true, status: 200, body: hit });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('内置合成色卡四档，id 都带 synthetic: 前缀', () => {
  const list = listSyntheticPalettes();
  assert.equal(list.length, 4);
  for (const item of list) {
    assert.match(item.id, /^synthetic:\d+$/);
    assert.equal(item.kind, 'synthetic');
    assert.ok(item.colorCount > 0);
    assert.equal(item.brand, '内置合成色卡');
  }
  assert.deepEqual(list.map((p) => p.id), ['synthetic:17', 'synthetic:40', 'synthetic:152', 'synthetic:300']);
});

test('外部数据里只有 Mard 291 会进入可选列表，其他品牌一律剔除', async () => {
  const fake = stubFetch({ '/palettes/index.json': INDEX });
  try {
    const { external, synthetic, all } = await listPalettes();
    // 索引里有三个系列（Artkal / Mard 221 / Mard 291），只留 Mard 291
    assert.deepEqual(external.map((p) => p.id), ['external:mard-291']);
    assert.equal(external[0].brand, 'Mard');
    assert.equal(external[0].paletteCode, 'Mard-291');
    assert.equal(external[0].colorCount, 3);
    // 有品牌色卡时不再列内置合成色卡：界面上不会出现第二个选项
    assert.deepEqual(synthetic, []);
    assert.deepEqual(all.map((p) => p.id), ['external:mard-291']);
  } finally {
    fake.restore();
  }
});

test('没有外部色卡数据时降级成只有合成色卡，不抛异常', async () => {
  const fake = stubFetch({});
  try {
    const { external, synthetic, all } = await listPalettes();
    assert.deepEqual(external, []);
    assert.equal(synthetic.length, 4);
    // 默认选中第一张：152 色那张（示例效果最好）
    assert.equal(all[0].id, 'synthetic:152');
    assert.deepEqual(
      all.map((p) => p.id).sort(),
      ['synthetic:152', 'synthetic:17', 'synthetic:300', 'synthetic:40'],
    );
  } finally {
    fake.restore();
  }
});

test('外部目录请求失败（网络异常）时同样降级', async () => {
  const fake = stubFetch({ '/palettes/index.json': new Error('断网') });
  try {
    const { external, synthetic } = await listPalettes();
    assert.deepEqual(external, []);
    assert.equal(synthetic.length, 4);
  } finally {
    fake.restore();
  }
});

test('取内置色卡的颜色', async () => {
  const palette = await loadPalette('synthetic:17');
  assert.equal(palette.colors.length, 17);
  assert.equal(palette.brand, '内置合成色卡');
  for (const color of palette.colors) {
    assert.match(color.hex, /^#[0-9a-fA-F]{6}$/);
    assert.equal(typeof color.code, 'string');
  }
});

test('取外部色卡的颜色', async () => {
  const fake = stubFetch({ '/palettes/mard-221.json': MARD });
  try {
    const palette = await loadPalette('external:mard-221');
    assert.equal(palette.label, 'Mard 221');
    assert.equal(palette.colors.length, 2);
    assert.deepEqual(palette.colors[0], { code: 'A1', hex: '#FAF5CD' });
    assert.equal(fake.calls[0], '/palettes/mard-221.json');
  } finally {
    fake.restore();
  }
});

test('外部色卡 id 会做 URL 编码', async () => {
  const fake = stubFetch({ '/palettes/a%20b.json': { id: 'a b', colors: [{ code: 'X', hex: '#000000' }] } });
  try {
    await loadPalette('external:a b');
    assert.equal(fake.calls[0], '/palettes/a%20b.json');
  } finally {
    fake.restore();
  }
});

test('单页应用回退返回 HTML 时报错清楚，不抛 JSON 解析错误', async () => {
  const fake = stubFetch({ '/palettes/mard-221.json': { __html: true } });
  try {
    await assert.rejects(() => loadPalette('external:mard-221'), /返回的不是 JSON/);
  } finally {
    fake.restore();
  }
});

test('各种非法输入都会明确报错', async () => {
  await assert.rejects(() => loadPalette(''), /色卡 id 为空/);
  await assert.rejects(() => loadPalette('bogus:1'), /无法识别的色卡 id/);
  await assert.rejects(() => loadPalette('synthetic:999'), /未知的内置色卡/);

  const fake = stubFetch({ '/palettes/empty.json': { id: 'empty', colors: [] } });
  try {
    await assert.rejects(() => loadPalette('external:没有这个'), /加载失败/);
    await assert.rejects(() => loadPalette('external:empty'), /没有颜色数据/);
  } finally {
    fake.restore();
  }
});
