<script setup lang="ts">
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, File, Folder, Pencil, RefreshCw, Search, Server, TriangleAlert, X } from '@lucide/vue'

defineProps<{ name: 'folder' | 'file' | 'back' | 'forward' | 'up' | 'refresh' | 'close' | 'search' | 'server' | 'chevron' | 'edit' | 'warning' }>()
const icons = {
  folder: Folder, file: File, back: ArrowLeft, forward: ArrowRight, up: ArrowUp,
  refresh: RefreshCw, close: X, search: Search, server: Server, chevron: ChevronRight,
  edit: Pencil, warning: TriangleAlert,
}
</script>
<template><component :is="icons[name]" :size="18" :stroke-width="1.6" aria-hidden="true" focusable="false" /></template>
<style scoped>
svg { width: 18px; height: 18px; flex: none; }
</style>
