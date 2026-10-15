<template>
  <div class="slider-row control-row advanced-row">
    <label class="control-label" :for="inputId">
      {{ label }}<span v-if="hint" class="label-hint" v-html="hint"></span>：
    </label>
    <div class="slider-container">
      <input
        :id="inputId"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        :style="{ '--pw-fill': fillPercent + '%' }"
        :aria-label="label"
        @input="onInput"
        @change="onChange"
      />
      <span class="slider-value">{{ valueText }}</span>    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  /** 父组件传进来的就是「显示单位」的值（例如鲜艳度 100 = 原始 1.0） */
  modelValue: { type: Number, required: true },
  label: { type: String, required: true },
  /** 允许包含少量 HTML（源页面把「较耗时」加粗），内容由本工程自己维护 */
  hint: { type: String, default: '' },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  step: { type: Number, default: 1 },
  suffix: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  inputId: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue', 'input', 'change']);

const fillPercent = computed(() => {
  const span = props.max - props.min;
  if (!span) return 0;
  return Math.max(0, Math.min(100, ((props.modelValue - props.min) / span) * 100));
});

const valueText = computed(() => `${Math.round(props.modelValue)}${props.suffix}`);

function onInput(event) {
  const value = Number(event.target.value);
  emit('update:modelValue', value);
  emit('input', value);
}

function onChange(event) {
  emit('change', Number(event.target.value));
}
</script>
