<template>
  <div class="mode-toggle control-row">
    <span v-if="label" class="control-label">{{ label }}</span>
    <div class="control-buttons" role="group" :aria-label="label">
      <button
        v-for="option in normalizedOptions"
        :key="option.value"
        type="button"
        class="control-btn"
        :class="{ active: option.value === modelValue }"
        :aria-pressed="option.value === modelValue"
        :disabled="disabled || option.disabled"
        @click="select(option.value)"
      >
        <span class="btn-title">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** `['nearest', 'family']` 或 `[{ value, label }]` */
  options: { type: Array, required: true },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'change']);

const normalizedOptions = computed(() =>
  props.options.map((option) =>
    option && typeof option === 'object' ? option : { value: option, label: String(option) },
  ),
);

function select(value) {
  if (props.disabled || value === props.modelValue) return;
  emit('update:modelValue', value);
  emit('change', value);
}
</script>
