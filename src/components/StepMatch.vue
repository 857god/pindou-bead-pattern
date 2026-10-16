<template>
  <div class="step-match">
    <div class="pw-preview-card sticky-canvas preview-section">
      <div class="canvas-wrapper preview-tappable" :class="{ zoomed }" @click="toggleZoom">
        <PixelCanvas
          which="match"
          :grid="store.matchGrid"
          large
          label="色号匹配预览"
          placeholder="等待匹配"
        />
      </div>
      <p class="pw-preview-meta">{{ previewTitle }}</p>
    </div>

    <div class="step-controls">
      <div class="pw-card adjustment-panel">
        <span class="pw-section-title">色号匹配</span>
        <div class="advanced-section">
          <div class="advanced-inner">
            <ModeToggle
              label="匹配模式："
              :model-value="store.matchMode"
              :options="MATCH_MODES"
              @change="onMatchMode"
            />

            <p v-if="store.matchMode !== 'custom'" class="mode-hint-text">
              当前使用智能推荐；下方为高级匹配预览，点击「自定义」可启用
            </p>

            <div class="advanced-panel" :class="{ 'is-locked': store.matchMode !== 'custom' }">
              <div class="advanced-head">
                <span class="advanced-title">高级匹配</span>
                <span class="advanced-sub">
                  {{ store.matchMode === 'custom' ? '已启用自定义匹配' : '切换到「自定义」后可编辑' }}
                </span>
              </div>

              <ModeToggle
                v-if="store.paletteStrategy === 'family'"
                label="色系优先程度："
                :model-value="store.familyPriority"
                :options="FAMILY_PRIORITIES"
                :disabled="store.matchMode !== 'custom'"
                @change="onFamilyPriority"
              />

              <SliderRow
                v-for="item in MATCH_ADJUSTMENTS"
                :key="item.key"
                :input-id="`match-${item.key}`"
                :model-value="matchDisplay[item.key]"
                :label="item.label"
                :hint="item.hint"
                :min="item.min"
                :max="item.max"
                :suffix="item.suffix"
                :disabled="store.matchMode !== 'custom'"
                @input="(value) => onMatchInput(item.key, value)"
                @change="(value) => onMatchChange(item.key, value)"
              />

              <SwitchRow
                label="肤色自然"
                hint="（人物肤色优先匹配自然肤色色号）"
                :model-value="matchDisplay.enableSkinToneProtection"
                :disabled="store.matchMode !== 'custom'"
                @change="onSkinToneProtection"
              />
            </div>

            <!-- 与源页面一致：这一行在高级面板之外，标准和自定义模式下都能选 -->
            <ModeToggle
              class="strategy-row"
              label="色卡匹配策略："
              :model-value="store.paletteStrategy"
              :options="PALETTE_STRATEGIES"
              @change="onPaletteStrategy"
            />
          </div>
        </div>
      </div>

      <div class="action-buttons">
        <button type="button" class="back-btn" @click="backToStep1">上一步</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

import ModeToggle from './ModeToggle.vue';
import PixelCanvas from './PixelCanvas.vue';
import SliderRow from './SliderRow.vue';
import SwitchRow from './SwitchRow.vue';
import {
  FAMILY_PRIORITIES,
  MATCH_ADJUSTMENTS,
  MATCH_MODES,
  PALETTE_STRATEGIES,
  backToStep1,
  matchDisplay,
  onMatchAdjustChange,
  onMatchAdjustInput,
  schedulePaint,
  setFamilyPriority,
  setMatchMode,
  setPaletteStrategy,
  setSkinToneProtection,
  store,
} from '../workflow.mjs';

const zoomed = ref(false);

function toggleZoom() {
  zoomed.value = !zoomed.value;
}

const previewTitle = computed(() => {
  const result = store.matchResult;
  if (!result) return '等待匹配';
  return `${result.width} × ${result.height} · 色号 ${result.ranked.length} 色 · 平均色差 ${result.stats.mean.toFixed(1)} · 孤立格 ${result.isolatedCells}`;
});

watch(
  () => store.matchGrid,
  (grid) => {
    if (grid) schedulePaint('match');
  },
);

function onMatchMode(mode) {
  setMatchMode(mode);
}

function onPaletteStrategy(strategy) {
  setPaletteStrategy(strategy);
}

function onFamilyPriority(priority) {
  setFamilyPriority(priority);
}

function onMatchInput(key, value) {
  onMatchAdjustInput(key, value);
}

function onMatchChange(key, value) {
  onMatchAdjustChange(key, value);
}

function onSkinToneProtection(enabled) {
  setSkinToneProtection(enabled);
}
</script>

<style scoped>
.step-match {
  display: contents;
}

/* 色卡匹配策略与「匹配模式」平级，位置照源页面放在高级面板之后 */
.strategy-row {
  margin-top: 10px;
}
</style>
