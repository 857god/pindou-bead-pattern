<template>
  <div class="palette-selector pw-card">
    <span class="pw-section-title">选择色卡</span>
    <div class="selector-row">
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
        :class="{ disabled: !selectedBrand }"
        :value="selectedPaletteId"
        :disabled="!selectedBrand || !palettes.length"
        @change="onPalette"
      >
        <option v-if="!selectedBrand" value="">请先选择品牌</option>
        <option v-else-if="!palettes.length" value="">该品牌暂无色卡</option>
        <option v-for="item in palettes" :key="item.id" :value="item.id">
          {{ item.display || item.paletteCode }}
        </option>
      </select>
    </div>
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

function onBrand(event) {
  emit('select-brand', event.target.value);
}

function onPalette(event) {
  emit('select-palette', event.target.value);
}
</script>
