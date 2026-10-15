/**
 * 画布绘制：把 RGBA 网格铺到 canvas 上。
 *
 * 关键做法：canvas 的**后备像素尺寸就等于格数**（1 格 = 1 像素），
 * 显示尺寸交给 CSS，配 `image-rendering: pixelated` 放大——
 * 于是放大多少倍都不会糊，也不用像源页面那样手算缩放。
 */

import { ctx as chainCtx } from './algorithm/chain.mjs';

/**
 * 把 RGBA 铺到 canvas（1 格 1 像素）。
 * @param {HTMLCanvasElement} canvas
 * @param {{rgba: Uint8ClampedArray, width: number, height: number}} grid
 */
export function paintGrid(canvas, { rgba, width, height }) {
  if (!canvas) return;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}

/**
 * 结构层/匹配层网格 → RGBA。空位（方板留空）补白。
 * @param {string[][]} hexGrid
 */
export function gridToRgba(hexGrid) {
  const height = hexGrid.length;
  const width = hexGrid[0] ? hexGrid[0].length : 0;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const row = hexGrid[y] || [];
    for (let x = 0; x < width; x += 1) {
      const hex = row[x];
      const o = (y * width + x) * 4;
      if (typeof hex !== 'string' || hex.length < 7) {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      out[o] = parseInt(hex.slice(1, 3), 16);
      out[o + 1] = parseInt(hex.slice(3, 5), 16);
      out[o + 2] = parseInt(hex.slice(5, 7), 16);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 供界面判断「这一步能不能点生成」等状态用：主链是否已经产出结构网格。 */
export function hasStructure() {
  return Array.isArray(chainCtx.pixelData) && chainCtx.pixelData.length > 0;
}
