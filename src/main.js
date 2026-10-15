import { createApp } from 'vue';

import App from './App.vue';
import { isAutotest, isTestDrive, reportGlobalError, store } from './workflow.mjs';
import './styles/base.css';
import './styles/studio.css';
import './styles/loading.css';

/* 诊断缓冲：只保留最近 400 条 console 输出，自检模式会把它一并打到页面上。
   正常交互路径不受影响。 */
if (typeof window !== 'undefined') {
  const buffer = [];
  window.__pwConsoleLog = buffer;

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level]?.bind(console);
    console[level] = (...args) => {
      try {
        buffer.push(`${level}: ${args.map((item) => (item && item.stack) || String(item)).join(' ')}`.slice(0, 600));
        if (buffer.length > 400) buffer.splice(0, buffer.length - 400);
      } catch {
        // 诊断缓冲不能反过来影响主流程
      }
      if (original) original(...args);
    };
  }
}

const app = createApp(App);

/** 未捕获错误必须能渲染到页面上（不只是 console.error），方便 --dump-dom 抓取。 */
app.config.errorHandler = (error, instance, info) => {
  const message = (error && error.message) || String(error);
  const where = `${info || 'unknown'}${instance ? ` @ ${instance.type?.__name || instance.type?.name || 'component'}` : ''}`;
  const stack = String((error && error.stack) || '')
    .split('\n')
    .slice(1, 4)
    .map((line) => line.trim())
    .join(' <- ');

  if (typeof window !== 'undefined') {
    window.__pwVueError = { message, where, stack };
  }

  // 和 window.onerror / unhandledrejection 走同一条路径：页面上真的显示错误横幅
  reportGlobalError(`Vue 组件错误：${message}`, `${where}${stack ? ` | ${stack}` : ''}`);
  console.error('[pw vue error]', { message, where, stack });
};

app.mount('#app');

/* 画布自检辅助函数：只有自检脚本会调用，正常交互不依赖它。 */
if (typeof window !== 'undefined') {
  if (isAutotest() || isTestDrive()) window.__pwStore = store;

  window.__pwCanvasCheck = () => {
    const canvas = document.querySelector('canvas.result-canvas');
    if (!canvas) return { found: false };
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let nonWhite = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) nonWhite += 1;
      colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return { found: true, width: canvas.width, height: canvas.height, nonWhitePixels: nonWhite, uniqueColors: colors.size };
  };
}
