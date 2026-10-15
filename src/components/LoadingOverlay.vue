<template>
  <div v-if="visible" class="loading-overlay" role="status" aria-live="polite">
    <div class="loading-box">
      <span class="loading-text">{{ text || '正在处理...' }}</span>
      <div v-if="progress > 0" class="progress-bar">
        <div class="progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <span v-if="progress > 0" class="progress-text">{{ progress }}%</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  text: { type: String, default: '' },
  progress: { type: Number, default: 0 },
});
</script>
