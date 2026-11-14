<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useTosApp } from 'tos-app-core/vue'
import type { ConnectionDiagnostic } from 'tos-app-core'

const props = defineProps<{ report?: ConnectionDiagnostic | null }>()
const { translate: t, connectionDiagnostic } = useTosApp()
const report = computed(() => props.report === undefined ? connectionDiagnostic.value : props.report)
const field = ref<HTMLTextAreaElement>()
const id = useId()
const text = computed(() => JSON.stringify(report.value, null, 2))
function selectReport() { field.value?.focus(); field.value?.select() }
</script>

<template>
  <section v-if="report" class="tos-connection-report" :aria-label="t('连接诊断')">
    <h2>{{ t('连接诊断') }}</h2>
    <dl>
      <dt>{{ t('前端 / 后端版本') }}</dt><dd>{{ report.clientVersion }} / {{ report.serverVersion || t('响应未提供') }}</dd>
      <dt>{{ t('响应') }}</dt><dd>{{ report.status ?? t('网络失败') }} · {{ report.responseFormat }} · {{ report.responseBytes }} B<span v-if="report.responseCode"> · {{ report.responseCode }}</span></dd>
      <dt>CSRF Cookie</dt><dd>{{ t(report.csrfCookieAvailable ? '页面可读取' : '页面未读取到') }}</dd>
      <dt>{{ t('页面设置 CSRF 请求头') }}</dt><dd>{{ t(report.csrfHeaderConfigured ? '是' : '否') }}</dd>
    </dl>
    <p>{{ t('报告仅记录凭据是否可读，不包含 Cookie 或令牌值。页面读取结果不能代表系统最终发送的全部凭据。') }}</p>
    <details>
      <summary>{{ t('查看完整报告') }}</summary>
      <label class="tos-sr-only" :for="id">{{ t('连接诊断报告') }}</label>
      <textarea :id="id" ref="field" :value="text" readonly spellcheck="false" />
      <button type="button" @click="selectReport">{{ t('选中报告') }}</button>
    </details>
  </section>
</template>

<style scoped>
.tos-connection-report { margin-top: 24px; min-width: 0; color: var(--text); font-size: 13px; }
h2 { margin: 0; font-size: 13px; font-weight: 600; }
dl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 16px; margin: 16px 0 0; line-height: 1.5; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
p { color: var(--muted); margin: 12px 0 0; font-size: 12px; line-height: 1.8; }
details { margin-top: 16px; }
summary { cursor: pointer; color: var(--accent); min-height: 32px; line-height: 32px; }
summary:hover { color: var(--text); }
textarea { box-sizing: border-box; display: block; resize: vertical; width: 100%; height: 220px; min-height: 100px; margin: 8px 0 12px; padding: 10px; border: 1px solid var(--border); border-radius: 4px; color: var(--text); background: var(--field); font: 12px/1.6 ui-monospace, monospace; caret-color: var(--focus); }
textarea:hover:not(:focus-visible) { border-color: var(--muted); }
textarea:focus-visible { border-color: var(--focus); }
textarea:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
button { min-height: 32px; padding: 0 12px; font: inherit; font-weight: 500; color: var(--text); border: 1px solid var(--border); border-radius: 4px; background: var(--secondary); cursor: pointer; }
button:hover { background: var(--hover); }
button:active { background: var(--active); }
.tos-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media(max-width: 620px) { summary { min-height: 44px; line-height: 44px; } button { min-height: 44px; } }
</style>
