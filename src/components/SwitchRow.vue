<template>
  <div class="switch-row control-row advanced-row">
    <span class="control-label">
      {{ label }}<span v-if="hint" class="label-hint" v-html="hint"></span>：
    </span>
    <div class="control-switch">
      <button
        type="button"
        class="switch"
        role="switch"
        :class="{ on: modelValue }"
        :aria-checked="modelValue ? 'true' : 'false'"
        :disabled="disabled"
        :aria-label="label"
        @click="toggle"
      >
        <span class="switch-knob" aria-hidden="true"></span>
      </button>
      <span class="switch-label">{{ modelValue ? onLabel : offLabel }}</span>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  onLabel: { type: String, default: '已启用' },
  offLabel: { type: String, default: '已关闭' },
});

const emit = defineEmits(['update:modelValue', 'change']);

function toggle() {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
  emit('change', !props.modelValue);
}
</script>

<style scoped>
.switch-row .control-switch {
  display: flex;
  align-items: center;
  gap: 10px;
}

.switch {
  width: 46px;
  height: 28px;
  padding: 2px;
  border-radius: var(--pw-radius-pill);
  border: 1px solid var(--pw-hairline);
  background: var(--pw-track);
  display: inline-flex;
  align-items: center;
  transition: background 0.2s;
  flex-shrink: 0;
}

.switch:disabled {
  cursor: not-allowed;
}

.switch.on {
  background: var(--pw-primary);
  border-color: var(--pw-on-primary);
}

.switch-knob {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(31, 27, 18, 0.28);
  transform: translateX(0);
  transition: transform 0.2s;
}

.switch.on .switch-knob {
  transform: translateX(18px);
}

.switch-label {
  font-size: 12px;
  color: var(--pw-muted);
}
</style>
