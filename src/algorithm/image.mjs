/**
 * 图片解码：把用户选的图片或内置示例转成算法需要的 `{ width, height, data }`。
 *
 * 用浏览器自带的 `createImageBitmap` + canvas 解码（PNG / JPEG / WebP 都支持），
 * 超大图先缩到工作尺寸，避免拖慢演示。
 */

import { syntheticScene } from './sample-scene.mjs';

export { syntheticScene };

/** 工作尺寸的最长边；超过就先等比缩小。 */
export const MAX_WORK_EDGE = 2000;

/** 把 RGBA 写进一个离屏 canvas，便于缩放取样。 */
function toCanvas(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

/** 等比缩到最长边不超过 `MAX_WORK_EDGE`。 */
export function clampToWorkSize(image) {
  const longest = Math.max(image.width, image.height);
  if (longest <= MAX_WORK_EDGE) return image;

  const ratio = MAX_WORK_EDGE / longest;
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const dst = document.createElement('canvas');
  dst.width = width;
  dst.height = height;
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(toCanvas(image), 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/**
 * 解码 `File` / `Blob`（来自 `<input type="file">`、拖拽或剪贴板）。
 * @returns {Promise<{width: number, height: number, data: Uint8ClampedArray, name: string}>}
 */
export async function decodeFile(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const image = clampToWorkSize({
    width: canvas.width,
    height: canvas.height,
    data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
  });
  return { ...image, name: file.name || '未命名图片' };
}

/** 内置示例场景（没有图片时也能直接玩）。 */
export function sampleScene(width = 480, height = 320) {
  return { ...syntheticScene(width, height), name: '内置示例场景' };
}
