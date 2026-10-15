import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import { listExternalPalettes, readExternalPalette, resolveColorDataRoot } from './src/algorithm/color-data.node.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * 色卡数据的开发服务器路由。
 *
 *   GET /palettes/index.json      → { root, palettes: [...] }
 *   GET /palettes/<id>.json       → { id, label, brand, paletteCode, colors: [{code, hex}] }
 *
 * 数据优先来自外部目录（`PINDOU_COLOR_DATA_ROOT` 或 ../pindou-color-data 等），
 * 其次来自 `public/palettes/`（用户自己放的静态文件），所以仓库里始终不含品牌色卡。
 *
 * 找不到时必须**自己回 404**，不能让请求漏到 Vite 的 SPA 回退上：
 * 否则 `/palettes/nope.json` 会返回 200 + index.html，前端拿到 HTML 再解析 JSON 会报出
 * 一个看不懂的错。
 */
function paletteDataPlugin() {
  const serveJson = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'palette-data',
    configureServer(server) {
      server.middlewares.use('/palettes', async (req, res) => {
        const url = (req.url || '').split('?')[0].replace(/^\//, '');

        if (!url.endsWith('.json')) {
          return serveJson(res, 404, { error: '色卡数据只提供 .json' });
        }

        const name = url.slice(0, -'.json'.length);

        try {
          if (name === 'index') {
            const externalRoot = resolveColorDataRoot();
            return serveJson(res, 200, {
              root: externalRoot ? '外部色卡目录' : null,
              palettes: await listExternalPalettes(externalRoot),
            });
          }

          const palette = await readExternalPalette(name);
          if (palette) return serveJson(res, 200, palette);

          // 退到 public/palettes/<name>.json（生产部署时用户自己放的那份）
          const file = join(ROOT, 'public', 'palettes', `${name}.json`);
          if (resolve(file).startsWith(resolve(ROOT, 'public', 'palettes'))) {
            const raw = await readFile(file, 'utf8').catch(() => null);
            if (raw !== null) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(raw);
            }
          }

          return serveJson(res, 404, { error: `没有色卡数据：${name}` });
        } catch (error) {
          return serveJson(res, 500, { error: String(error && error.message ? error.message : error) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), paletteDataPlugin()],
  server: {
    // 绑 IPv4：默认的 localhost 在部分 Windows 上只解析到 ::1，
    // 结果 http://127.0.0.1:5310 连不上，容易让人以为没起来。
    host: '127.0.0.1',
    port: 5310,
    strictPort: false,
  },
  build: {
    target: 'es2022',
  },
});
