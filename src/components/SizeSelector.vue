<template>
  <div class="size-selector">
    <span class="pw-section-title" :id="titleId">像素大小</span>
    <div class="size-options">
      <button
        v-for="size in sizes"
        :key="size"
        type="button"
        class="size-btn"
        :class="{ active: hasSelectedPixelSize && modelValue === size }"
        :aria-pressed="hasSelectedPixelSize && modelValue === size"
        @click="select(size)"
      >
        {{ size }}
      </button>

      <div class="custom-size-input" :class="{ active: customActive }">
        <input
          :value="customValue"
          type="number"
          inputmode="numeric"
          :min="minSize"
          :max="maxSize"
          :placeholder="`${minSize}-${maxSize}`"
          :aria-label="`自定义像素大小（${minSize}-${maxSize}）`"
          @input="onInput"
          @change="onCommit"
          @blur="onCommit"
          @keyup.enter="onCommit"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Number, required: true },
  sizes: { type: Array, default: () => [30, 52, 80, 104, 150] },
  hasSelectedPixelSize: { type: Boolean, default: false },
  customValue: { type: [String, Number], default: '' },
  minSize: { type: Number, default: 20 },
  maxSize: { type: Number, default: 200 },
  idPrefix: { type: String, default: 'size' },
});

const emit = defineEmits(['select', 'custom-input', 'custom-commit']);

const titleId = computed(() => `${props.idPrefix}-title`);

const customActive = computed(
  () => props.hasSelectedPixelSize && !props.sizes.includes(Number(props.modelValue)),
);

function select(size) {
  emit('select', size);
}

function onInput(event) {
  emit('custom-input', event.target.value);
}

function onCommit() {
  emit('custom-commit');
}
</script>
