<script setup lang="ts">
import { useTosApp } from 'tos-app-core/vue'
import { TosConnectionReport, TosPreferencesForm } from 'tos-app-ui-kit'

const { core, language } = useTosApp()
async function showDiagnostic() {
  try { await core.api.request('/example') } catch { /* The example deliberately returns a local 403. */ }
}
</script>

<template>
  <main>
    <h1>{{ language === 'en-US' ? 'TOS Kit example' : 'TOS Kit 示例' }}</h1>
    <TosPreferencesForm />
    <div class="actions">
      <button class="button secondary" @click="showDiagnostic">{{ language === 'en-US' ? 'Show sample diagnostic' : '显示示例诊断' }}</button>
      <button class="button secondary" @click="core.api.reset()">{{ language === 'en-US' ? 'Clear diagnostic' : '清除诊断' }}</button>
    </div>
    <TosConnectionReport />
  </main>
</template>

<style scoped>
main { max-width: 620px; padding: 24px 20px; margin: auto; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
</style>
