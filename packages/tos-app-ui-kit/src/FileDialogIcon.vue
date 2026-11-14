<script setup lang="ts">
defineProps<{ name: 'folder' | 'file' | 'back' | 'forward' | 'up' | 'refresh' | 'close' | 'search' | 'server' | 'chevron' | 'edit' | 'warning' }>()
const paths = {
  folder: 'M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6',
  back: 'm12 19-7-7 7-7M5 12h14', forward: 'm12 5 7 7-7 7M5 12h14', up: 'm5 12 7-7 7 7M12 5v14',
  refresh: 'M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M8 16H3v5',
  close: 'm18 6-12 12M6 6l12 12', search: 'm21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  server: 'M4 3h16v7H4ZM4 14h16v7H4ZM7 6.5h.01M7 17.5h.01', chevron: 'm9 18 6-6-6-6',
  edit: 'm16 3 5 5-13 13H3v-5ZM14 5l5 5', warning: 'm10.3 3.9-8.1 14A2 2 0 0 0 3.9 21h16.2a2 2 0 0 0 1.7-3.1l-8.1-14a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
}
</script>
<template><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="paths[name]" /></svg></template>
<style scoped>
svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
</style>
