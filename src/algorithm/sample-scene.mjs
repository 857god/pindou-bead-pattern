/**
 * 演示用合成场景：天空渐变、落日光晕、远山、湖面倒影、前景树影 + 颗粒噪声。
 * 用确定性伪随机，保证每次生成、每台机器一致。
 */

/** @returns {{width: number, height: number, data: Uint8ClampedArray}} RGBA */
export function syntheticScene(width = 480, height = 320) {
  let seed = 20261015;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const data = new Uint8ClampedArray(width * height * 4);
  const horizon = height * 0.62;
  const sunX = width * 0.68;
  const sunY = height * 0.3;
  const ridge = (x, base, amp, freq, phase) =>
    base + amp * (Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.7 + phase * 1.9) * 0.3 + Math.sin(x * freq * 5.3) * 0.1);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let r;
      let g;
      let b;

      if (y < horizon) {
        // 天空：顶部靛蓝 → 地平线暖橙
        const k = y / horizon;
        r = 40 + 210 * Math.pow(k, 2.2);
        g = 70 + 130 * Math.pow(k, 2.6);
        b = 140 - 60 * Math.pow(k, 1.4);

        // 落日光晕
        const d = Math.hypot(x - sunX, (y - sunY) * 1.6);
        const glow = Math.exp(-d / (width * 0.12));
        r += 255 * glow * 0.9;
        g += 190 * glow * 0.75;
        b += 90 * glow * 0.4;

        // 两层山脊
        const far = ridge(x, horizon - height * 0.1, height * 0.05, 0.012, 1.2);
        const near = ridge(x, horizon - height * 0.04, height * 0.055, 0.02, 4.1);
        if (y > far) {
          const shade = 0.85 + (0.35 * (y - far)) / height;
          r = 128 * shade; g = 138 * shade; b = 186 * shade;
        }
        if (y > near) {
          const shade = 0.8 + (0.3 * (y - near)) / height;
          r = 84 * shade; g = 100 * shade; b = 132 * shade;
        }
      } else {
        // 湖面：天空倒影 + 横向水纹，越近越暗
        const depth = (y - horizon) / (height - horizon);
        const mirror = horizon - (y - horizon) * 0.7;
        const km = Math.max(0, Math.min(1, mirror / horizon));
        const d = Math.hypot(x - sunX * 0.95, (mirror - sunY) * 1.6);
        const glow = Math.exp(-d / (width * 0.16));
        r = (40 + 210 * Math.pow(km, 2.2)) * 0.85 + 255 * glow * 0.55;
        g = (70 + 130 * Math.pow(km, 2.6)) * 0.85 + 190 * glow * 0.46;
        b = (140 - 60 * Math.pow(km, 1.4)) * 0.95 + 90 * glow * 0.28;
        const ripple = Math.sin(y * 1.4 + x * 0.06) * 12 + Math.sin(x * 0.21 + y * 0.7) * 7;
        r += ripple; g += ripple * 0.9; b += ripple * 0.6;
        r *= 1 - depth * 0.16; g *= 1 - depth * 0.19; b *= 1 - depth * 0.12;
      }

      // 前景树影
      const treeMask = (cx, spread, top) => {
        const dx = Math.abs(x - cx) / spread;
        const crown = top + Math.sin(x * 0.15) * 6 + Math.sin(x * 0.41) * 4;
        return dx < 1 && y > crown - Math.sqrt(Math.max(0, 1 - dx * dx)) * height * 0.15;
      };
      if (treeMask(width * 0.06, width * 0.085, height * 0.78) || treeMask(width * 0.95, width * 0.095, height * 0.74)) {
        r = 46; g = 74; b = 52;
      }

      // 颗粒噪声，模拟真实照片
      const grain = (rand() - 0.5) * 12;
      data[i] = r + grain;
      data[i + 1] = g + grain;
      data[i + 2] = b + grain;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
