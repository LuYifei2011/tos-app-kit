<script setup lang="ts">
import { useTosApp } from 'tos-app-core/vue'

const { translate: t, languagePreference, themePreference } = useTosApp()
</script>

<template>
  <div class="tos-preference-fields">
    <label>{{ t('语言') }}<select v-model="languagePreference" :aria-label="t('语言')"><option value="tos">{{ t('跟随 TOS') }}</option><option value="browser">{{ t('跟随浏览器') }}</option><option value="zh-CN" lang="zh-CN">简体中文</option><option value="en-US" lang="en">English</option></select></label>
    <label>{{ t('主题') }}<select v-model="themePreference" :aria-label="t('主题')"><option value="tos">{{ t('跟随 TOS') }}</option><option value="browser">{{ t('跟随浏览器') }}</option><option value="light">{{ t('浅色') }}</option><option value="dark">{{ t('深色') }}</option></select></label>
  </div>
</template>

<style scoped>
.tos-preference-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 20px; }
label { display: flex; flex-direction: column; gap: 5px; min-width: 0; color: var(--text); font-size: 12px; }
select { width: 100%; min-width: 0; height: 32px; padding: 0 27px 0 9px; font: inherit; color: var(--text); background: var(--field); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; }
select option { color: var(--text); background: var(--field); }
select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media(max-width: 620px) {
  .tos-preference-fields { grid-template-columns: minmax(0, 1fr); }
  select { height: 44px; }
}
</style>
