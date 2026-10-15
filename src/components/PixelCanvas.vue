<template>
  <div class="pw-canvas" :class="{ 'is-empty': !grid }">
    <canvas
      v-if="grid"
      ref="canvasEl"
      class="result-canvas"
      :class="{ 'is-large': large }"
      :aria-label="label"
    ></canvas>
    <p v-else class="pw-canvas-empty">{{ placeholder }}</p>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { store, setCanvas } from '../workflow.mjs';

const props = defineProps({
  /** { rgba, width, height } 或 null */
  grid: { type: Object, default: null },
  /** 'structure' | 'match' */
  which: { type: String, default: 'structure' },
  label: { type: String, default: '像素预览' },
  placeholder: { type: String, default: '等待生成' },
  large: { type: Boolean, default: false },
});

const emit = defineEmits(['ready']);
const canvasEl = ref(null);

function notifyReady() {
  setCanvas(props.which, canvasEl.value);
  emit('ready', { which: props.which, canvas: canvasEl.value });
}

onMounted(() => {
  nextTick(notifyReady);
});

watch(
  () => props.grid,
  () => {
    if (!props.grid) return;
    nextTick(notifyReady);
  },
);

watch(canvasEl, () => {
  nextTick(notifyReady);
});

onBeforeUnmount(() => {
  setCanvas(props.which, null);
  emit('ready', { which: props.which, canvas: null });
});
</script>

<style scoped>
.pw-canvas {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pw-canvas .result-canvas {
  /* 主动撑满到上限（不能只给 max-*，否则 52 格的图只有 52px 大，等于看不见） */
  width: min(100%, var(--pw-max));
  height: auto;
  max-height: none;
  aspect-ratio: 1 / 1;
  border-radius: 18px;
  border: 1px solid var(--pw-hairline);
  background: #ffffff;
  image-rendering: pixelated;
}

.pw-canvas .result-canvas.is-large {
  width: min(100%, calc(var(--pw-max) * 1.25));
}

.pw-canvas-empty {
  width: min(100%, var(--pw-max));
  aspect-ratio: 1 / 1;
  border: 1px dashed var(--pw-dashed);
  border-radius: 18px;
  background: #fff8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pw-muted);
  font-size: 13px;
}
</style>
