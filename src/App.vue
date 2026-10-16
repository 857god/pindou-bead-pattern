<template>
  <div class="pw-app">
    <header class="pw-header">
      <div class="pw-header-inner">
        <button
          v-if="step === 2"
          type="button"
          class="pw-back-btn"
          @click="backToStep1"
        >
          上一步
        </button>
        <span v-else class="pw-header-spacer"></span>
        <h1 class="pw-header-title">{{ store.navTitle }}</h1>
        <span class="pw-header-spacer"></span>
      </div>
    </header>

    <main class="pw-content">
      <div v-if="errorText" class="error-banner" role="alert">
        <span class="error-text">{{ errorText }}</span>
        <button type="button" class="error-close" aria-label="关闭提示" @click="dismissError">×</button>
      </div>

      <div v-if="store.globalError" class="error-banner" role="alert">
        <span class="error-text">未捕获错误：{{ store.globalError }}</span>
      </div>

      <div class="pw-steps">
        <StepStructure v-if="step === 1" />
        <StepMatch v-else />
      </div>
    </main>

    <LoadingOverlay :visible="loading" :text="store.loadingText" />

    <pre v-if="store.autotestMode" id="autotest" class="autotest-out">{{
      store.autotestText || 'autotest=running'
    }}</pre>

    <pre v-if="store.autotestMode && store.autotestLogs" id="autotest-logs" class="autotest-out">{{
      store.autotestLogs
    }}</pre>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import LoadingOverlay from './components/LoadingOverlay.vue';
import StepMatch from './components/StepMatch.vue';
import StepStructure from './components/StepStructure.vue';
import { backToStep1, initWorkflow, reportGlobalError, store } from './workflow.mjs';

const step = computed(() => store.step);
const loading = computed(() => store.loading || store.loadingPending > 0);
const stepError = ref('');

const errorText = computed(() => stepError.value || store.error);

function dismissError() {
  stepError.value = '';
  store.error = '';
}

function onWindowError(event) {
  const detail = event?.error?.stack ? String(event.error.stack).split('\n')[1]?.trim() : event?.filename;
  reportGlobalError(event?.message || '未知错误', detail);
}

function onUnhandledRejection(event) {
  const reason = event?.reason;
  reportGlobalError((reason && reason.message) || String(reason || '未处理的 Promise 拒绝'), '');
}

onMounted(async () => {
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  await initWorkflow();
  if (store.autotestMode) {
    const logs = (window.__pwConsoleLog || []).filter((line) => line.includes('warn') || line.includes('error'));
    if (logs.length) store.autotestLogs = logs.slice(-25).join('\n');
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('error', onWindowError);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);
});
</script>

<style scoped>
.autotest-out {
  margin: 12px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--pw-hairline);
  background: #ffffff;
  color: var(--pw-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.error-text {
  flex: 1;
  min-width: 0;
}
</style>
