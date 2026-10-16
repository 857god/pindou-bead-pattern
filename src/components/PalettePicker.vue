<template>
  <div class="palette-selector pw-card">
    <span class="pw-section-title">选择色卡</span>

    <!-- 只有一张色卡可选时直接把它写出来，不摆单选下拉（单选项的下拉是纯噪音） -->
    <div v-if="singlePalette" class="selector-row single-row">
      <span class="pw-label">色卡：</span>
      <span class="picker-display single-value">{{ singleText }}</span>
    </div>

    <template v-else>
      <div v-if="showBrandRow" class="selector-row">
        <label class="pw-label" :for="brandSelectId">品牌：</label>
        <select :id="brandSelectId" class="picker-display" :value="selectedBrand" @change="onBrand">
          <option value="">请选择品牌</option>
          <option v-for="brand in brands" :key="brand" :value="brand">{{ brand }}</option>
        </select>
      </div>

      <div class="selector-row">
        <label class="pw-label" :for="paletteSelectId">色卡：</label>
        <select
          :id="paletteSelectId"
          class="picker-display"
          :class="{ disabled: needBrand }"
          :value="selectedPaletteId"
          :disabled="needBrand || !palettes.length"
          @change="onPalette"
        >
          <option v-if="needBrand" value="">请先选择品牌</option>
          <option v-else-if="!palettes.length" value="">暂无色卡</option>
          <option v-for="item in palettes" :key="item.id" :value="item.id">
            {{ item.display || item.paletteCode }}
          </option>
        </select>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  brands: { type: Array, default: () => [] },
  selectedBrand: { type: String, default: '' },
  palettes: { type: Array, default: () => [] },
  selectedPaletteId: { type: String, default: '' },
  idPrefix: { type: String, default: 'palette' },
});

const emit = defineEmits(['select-brand', 'select-palette']);

const brandSelectId = computed(() => `${props.idPrefix}-brand`);
const paletteSelectId = computed(() => `${props.idPrefix}-palette`);

/** 只有一个品牌时不再显示品牌下拉：没得选 */
const showBrandRow = computed(() => props.brands.length > 1);

/** 品牌下拉还在时，必须先选品牌才能选色卡 */
const needBrand = computed(() => showBrandRow.value && !props.selectedBrand);

/**
 * 整个页面只有一张色卡时（本仓库默认就是这种情况）直接显示成一行文字。
 * `brands.length <= 1` 保证不是因为「还没选品牌」才只剩一张。
 */
const singlePalette = computed(() =>
  !showBrandRow.value && props.palettes.length === 1 ? props.palettes[0] : null,
);

const singleText = computed(() => {
  const item = singlePalette.value;
  if (!item) return '';
  const name = item.display || item.paletteCode || item.label;
  return item.colorCount ? `${name} · ${item.colorCount} 色` : name;
});

function onBrand(event) {
  emit('select-brand', event.target.value);
}

function onPalette(event) {
  emit('select-palette', event.target.value);
}
</script>

<style scoped>
/* 一行文字版：全局的 .pw-label 是块级的，这里让它和取值同排 */
.single-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.single-row .pw-label {
  margin-bottom: 0;
  white-space: nowrap;
}

.single-value {
  display: block;
  flex: 1;
  min-width: 0;
}
</style>
