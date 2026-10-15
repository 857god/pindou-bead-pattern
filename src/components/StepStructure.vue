<template>
  <div class="step-structure">
    <div v-if="!store.source" class="step-header">
      <span class="step-title">选择图片并调整</span>
      <span class="step-desc">选择图片后实时预览像素画效果</span>
    </div>

    <!-- 上传区域（未选择图片时显示） -->
    <div
      v-if="!store.source"
      class="upload-area"
      :class="{ 'is-dragging': store.dragging }"
      role="button"
      tabindex="0"
      @click="pickFile"
      @keyup.enter="pickFile"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div class="upload-placeholder">
        <span class="upload-icon" aria-hidden="true">🖼️</span>
        <span class="upload-text">点击选择图片</span>
        <span class="upload-hint">也可以把图片拖到这里，或直接使用内置示例场景</span>
        <button type="button" class="sample-btn" @click.stop="useBuiltInSample">使用内置示例场景</button>
      </div>
    </div>

    <div v-if="store.source" class="pw-preview-card sticky-canvas preview-section">
      <div class="canvas-wrapper preview-tappable" :class="{ zoomed }" @click="toggleZoom">
        <img v-if="!store.structureGrid && store.sourceUrl" class="original-preview" :src="store.sourceUrl" alt="源图预览" />
        <PixelCanvas
          v-else
          which="structure"
          :grid="store.structureGrid"
          label="像素化预览"
          placeholder="等待生成"
        />
      </div>
      <p v-if="previewTitle" class="pw-preview-meta">{{ previewTitle }}</p>
    </div>

    <div v-if="store.source" class="step-controls">
      <div class="pw-card size-selector">
        <span class="pw-section-title" id="size-title">像素大小</span>
        <SizeSelector
          :model-value="store.pixelSize"
          :sizes="SIZE_OPTIONS"
          :has-selected-pixel-size="store.hasSelectedPixelSize"
          :custom-value="store.customPixelSize"
          :min-size="MIN_PIXEL_SIZE"
          :max-size="MAX_PIXEL_SIZE"
          @select="onSelectSize"
          @custom-input="onCustomInput"
          @custom-commit="onCustomCommit"
        />
      </div>

      <!-- 调整面板 -->
      <div class="pw-card adjustment-panel">
        <span class="pw-section-title">像素调整</span>
        <div class="advanced-section">
          <div class="advanced-inner">
            <ModeToggle
              label="像素调整模式："
              :model-value="store.pipelineMode"
              :options="PIPELINE_MODES"
              @change="onPipelineMode"
            />

            <p v-if="store.pipelineMode !== 'legacy'" class="mode-hint-text">
              当前使用智能推荐；下方为高级调节预览，点击「自定义」可启用
            </p>

            <div class="advanced-panel" :class="{ 'is-locked': store.pipelineMode !== 'legacy' }">
              <div class="advanced-head">
                <span class="advanced-title">高级调节</span>
                <span class="advanced-sub">
                  {{
                    store.pipelineMode === 'legacy'
                      ? '在智能推荐基础上微调（0 = 与标准相同）'
                      : '切换到「自定义」后可编辑'
                  }}
                </span>
              </div>

              <SliderRow
                v-for="(item, index) in STRUCTURE_ADJUSTMENTS"
                :key="item.key"
                :input-id="`structure-${item.key}`"
                :model-value="structureDisplay[item.key]"
                :label="item.label"
                :hint="item.hint"
                :min="item.min"
                :max="item.max"
                :disabled="store.pipelineMode !== 'legacy'"
                @input="(value) => onAdjustInput(item.key, value)"
                @change="(value) => onAdjustChange(item.key, value)"
              />
            </div>
          </div>
        </div>
      </div>

      <PalettePicker
        :brands="brands"
        :selected-brand="store.selectedBrand"
        :palettes="palettes"
        :selected-palette-id="store.selectedPaletteId"
        @select-brand="onSelectBrand"
        @select-palette="onSelectPalette"
      />

      <p v-if="!store.paletteColors.length" class="palette-hint">请选择色卡后即可生成</p>

      <div class="action-buttons">
        <button type="button" class="back-btn" @click="resetImage">重新选择图片</button>
        <button type="button" class="next-btn" :disabled="!canGenerate" @click="onGenerate">生成</button>
      </div>
    </div>

    <input ref="fileInput" class="hidden-file-input" type="file" accept="image/*" @change="onFileChange" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

import PalettePicker from './PalettePicker.vue';
import PixelCanvas from './PixelCanvas.vue';
import SizeSelector from './SizeSelector.vue';
import SliderRow from './SliderRow.vue';
import ModeToggle from './ModeToggle.vue';
import {
  MAX_PIXEL_SIZE,
  MIN_PIXEL_SIZE,
  PIPELINE_MODES,
  SIZE_OPTIONS,
  STRUCTURE_ADJUSTMENTS,
  applyCustomSize,
  canGenerate,
  enterStep2,
  onStructureAdjustChange,
  onStructureAdjustInput,
  palettesOfBrand,
  resetImage,
  runStage1,
  selectBrand,
  selectPaletteById,
  setPipelineMode,
  setPixelSize,
  store,
  structureDisplay,
  useFile,
  useSample,
  brands as brandList,
} from '../workflow.mjs';

const fileInput = ref(null);
const zoomed = ref(false);

const brands = computed(() => brandList.value);
const palettes = computed(() => palettesOfBrand.value);

const previewTitle = computed(() => {
  if (store.matchGrid && store.matchResult) {
    return `${store.matchResult.width} × ${store.matchResult.height} · 色号 ${store.matchResult.ranked.length} 色 · 平均色差 ${store.matchResult.stats.mean.toFixed(1)}`;
  }
  if (store.structureResult) {
    return `${store.structureResult.width} × ${store.structureResult.height} · 已铺 ${store.structureResult.occupiedCells} 格 · 留空 ${store.structureResult.emptyCells} 格`;
  }
  return '';
});

function pickFile() {
  fileInput.value?.click();
}

async function onFileChange(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const source = await useFile(file);
  if (source) zoomed.value = false;
}

function onDragOver() {
  store.dragging = true;
}

function onDragLeave() {
  store.dragging = false;
}

async function onDrop(event) {
  store.dragging = false;
  const file = event.dataTransfer?.files && event.dataTransfer.files[0];
  if (!file) return;
  const source = await useFile(file);
  if (source) zoomed.value = false;
}

async function useBuiltInSample() {
  const source = await useSample();
  if (source) zoomed.value = false;
}

function toggleZoom() {
  zoomed.value = !zoomed.value;
}

function onSelectSize(size) {
  const changed = setPixelSize(size);
  if (changed || store.structureGrid) runStage1();
}

function onCustomInput(value) {
  store.customPixelSize = String(value).replace(/[^\d]/g, '');
}

function onCustomCommit() {
  if (!applyCustomSize()) return;
  runStage1();
}

function onPipelineMode(mode) {
  setPipelineMode(mode);
}

function onAdjustInput(key, value) {
  onStructureAdjustInput(key, value);
}

function onAdjustChange(key, value) {
  onStructureAdjustChange(key, value);
}

function onSelectBrand(brand) {
  selectBrand(brand);
}

function onSelectPalette(id) {
  if (id) selectPaletteById(id);
}

async function onGenerate() {
  if (!canGenerate.value) return;
  await enterStep2();
}
</script>

<style scoped>
.step-structure {
  display: contents;
}

.sample-btn {
  margin-top: 4px;
  padding: 8px 14px;
  border-radius: var(--pw-radius-pill);
  border: 1px solid var(--pw-hairline);
  background: #fff8f0;
  color: var(--pw-ink);
  font-size: 13px;
  font-weight: 700;
}

.sample-btn:hover {
  background: var(--pw-primary);
  color: var(--pw-on-primary);
  border-color: var(--pw-on-primary);
}

.hidden-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.palette-hint {
  margin: -4px 0 12px;
  font-size: 12px;
  color: var(--pw-muted);
}
</style>
