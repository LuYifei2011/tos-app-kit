<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  contentClass?: string
  scroll?: 'auto' | 'hidden'
}>(), { scroll: 'auto' })
</script>

<template>
  <div class="tos-app-shell">
    <header class="tos-app-shell__header">
      <h1 class="tos-app-shell__heading">
        <span v-if="$slots.icon" class="tos-app-shell__icon" aria-hidden="true"><slot name="icon" /></span>
        <span class="tos-app-shell__title" :title="title">{{ title }}</span>
      </h1>
      <div v-if="$slots['header-extra']" class="tos-app-shell__extra"><slot name="header-extra" /></div>
    </header>
    <main class="tos-app-shell__content" :class="contentClass" :data-scroll="scroll"><slot /></main>
  </div>
</template>

<style scoped>
.tos-app-shell, .tos-app-shell__header, .tos-app-shell__content { box-sizing: border-box; }
.tos-app-shell { position: relative; display: flex; flex-direction: column; height: 100vh; height: 100dvh; min-width: 0; min-height: 0; overflow: hidden; overscroll-behavior: contain; }
.tos-app-shell__header { display: flex; align-items: center; gap: 12px; height: 41px; flex-shrink: 0; padding: 0 var(--tos-app-window-controls-width, 180px) 0 12px; border-bottom: 1px solid var(--line); background: var(--header); }
.tos-app-shell__heading { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; margin: 0; color: var(--text); font: inherit; font-size: 14px; font-weight: 500; }
.tos-app-shell__icon { display: inline-flex; align-items: center; flex-shrink: 0; }
.tos-app-shell__title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tos-app-shell__extra { min-width: 0; max-width: 40%; flex-shrink: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); font-size: 12px; }
.tos-app-shell__content { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.tos-app-shell__content[data-scroll="hidden"] { overflow: hidden; }
</style>
