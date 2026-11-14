<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { TosFileDialogOptions, TosFileDialogResult, TosFileProvider } from 'tos-app-core'
import { useTosApp } from 'tos-app-core/vue'
import TosFileDialog from './TosFileDialog.vue'
import Icon from './FileDialogIcon.vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<Omit<TosFileDialogOptions, 'multiple'> & {
  modelValue: string
  editable?: boolean
  disabled?: boolean
  provider?: TosFileProvider
  dialogTitle?: string
}>(), { editable: true, disabled: false, mode: 'open', kind: 'file' })
const emit = defineEmits<{
  'update:modelValue': [path: string]
  select: [result: TosFileDialogResult]
  cancel: []
}>()
const { translate: t } = useTosApp()
const dialogOpen = ref(false)
const dialogOptions = shallowRef<TosFileDialogOptions>({})
const buttonLabel = computed(() => t(props.mode === 'save' ? '选择保存位置' : props.kind === 'directory' ? '选择文件夹' : '选择文件'))
function browse() {
  if (props.disabled) return
  const path = props.modelValue.startsWith('/') ? props.modelValue.replace(/\/+$/, '') : ''
  const separator = path.lastIndexOf('/')
  const parent = path.slice(0, separator) || null
  dialogOptions.value = {
    mode: props.mode, kind: props.kind,
    initialPath: props.initialPath !== undefined ? props.initialPath : props.mode === 'open' && props.kind === 'directory' ? path || null : parent,
    defaultName: props.defaultName ?? (props.mode === 'save' ? path.slice(separator + 1) : ''),
    filters: props.filters,
  }
  dialogOpen.value = true
}
function updatePath(event: Event) {
  if (props.editable && !props.disabled) emit('update:modelValue', (event.target as HTMLInputElement).value)
}
function selected(result: TosFileDialogResult) {
  if (props.disabled || !result.paths[0]) return
  emit('update:modelValue', result.paths[0])
  emit('select', result)
}
watch(() => props.disabled, disabled => { if (disabled) dialogOpen.value = false })
</script>

<template>
  <div class="tos-path-input" :class="{ disabled, readonly: !editable }">
    <input type="text" :aria-label="$attrs.id || $attrs['aria-labelledby'] ? undefined : t('路径')" :title="modelValue" v-bind="$attrs" :value="modelValue" :readonly="!editable" :disabled="disabled" @input="updatePath" />
    <button type="button" :disabled="disabled" :aria-label="buttonLabel" :title="buttonLabel" aria-haspopup="dialog" :aria-expanded="dialogOpen" @click="browse"><Icon name="folder" /></button>
  </div>
  <TosFileDialog v-model="dialogOpen" v-bind="dialogOptions" :multiple="false" :provider="provider" :title="dialogTitle" @select="selected" @cancel="emit('cancel')" />
</template>

<style scoped>
.tos-path-input { display: flex; align-items: stretch; width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; background: var(--field); color: var(--text); font: 13px/1.45 system-ui, sans-serif; }
.tos-path-input:hover:not(.disabled):not(:focus-within) { border-color: var(--muted); }
.tos-path-input:focus-within { border-color: var(--focus); outline: 2px solid var(--focus); outline-offset: -2px; }
.tos-path-input input { flex: 1; width: 0; min-width: 0; height: 30px; min-height: 30px; box-sizing: border-box; margin: 0; padding: 4px 8px; border: 0; border-radius: 4px 0 0 4px; outline: none; background: transparent; color: inherit; font: inherit; caret-color: var(--text); }
input::placeholder { color: var(--placeholder); }
input::selection { color: var(--selected-text); background: var(--selected); }
button { display: inline-flex; justify-content: center; align-items: center; flex: 0 0 32px; padding: 0; margin: 0; border: 0; border-left: 1px solid var(--line); border-radius: 0 4px 4px 0; color: var(--muted); background: transparent; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hover); }
button:active:not(:disabled) { background: var(--active); }
/* The wrapper owns the focus stroke; tint the button to identify its tab stop. */
.tos-path-input input:focus-visible, .tos-path-input button:focus-visible { outline: none; }
button:focus-visible { color: var(--accent); background: var(--selected); }
.readonly input { background: var(--panel); }
.disabled { opacity: .55; }
button:disabled, input:disabled { cursor: not-allowed; }
@media (max-width: 620px) { .tos-path-input input { height: 42px; min-height: 42px; } button { flex-basis: 44px; } }
</style>
