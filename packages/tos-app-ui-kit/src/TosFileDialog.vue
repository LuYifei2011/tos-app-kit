<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { createFileDialog, matchesTosFileFilter, validTosFilename } from 'tos-app-core'
import type { TosFileDialogController, TosFileDialogOptions, TosFileDialogResult, TosFileEntry, TosFileProvider } from 'tos-app-core'
import { useTosApp } from 'tos-app-core/vue'
import Icon from './FileDialogIcon.vue'

const props = defineProps<TosFileDialogOptions & { modelValue: boolean; title?: string; provider?: TosFileProvider }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [result: TosFileDialogResult]
  cancel: []
}>()
const { core, translate: t, language } = useTosApp()
const id = useId()
const dialog = ref<HTMLDialogElement>()
const overwriteDialog = ref<HTMLDialogElement>()
const addressInput = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const controller = shallowRef<TosFileDialogController>()
const state = shallowRef<TosFileDialogController['snapshot']>()
const missingProvider = ref(false)
const roots = ref<TosFileEntry[]>([])
const rootsFailed = ref(false)
const query = ref('')
const currentPath = ref<string | null>(null)
const history = ref<(string | null)[]>([])
const historyIndex = ref(-1)
const editingAddress = ref(false)
const address = ref('')
const highlighted = ref<string[]>([])
const focusedPath = ref<string | null>(null)
const anchor = ref<string | null>(null)
const overwriteTarget = ref<string | null>(null)
let unsubscribe = () => {}
let rootsRequest: AbortController | undefined
let session = 0
let navigationRequest = 0
const saving = computed(() => (controller.value?.mode ?? props.mode) === 'save')
const directory = computed(() => (controller.value?.kind ?? props.kind) === 'directory')
const heading = computed(() => props.title ?? t(saving.value ? directory.value ? '保存文件夹' : '保存文件' : directory.value ? '选择文件夹' : '打开文件'))
const busy = computed(() => !state.value?.location || state.value.loading || state.value.checking)
const entries = computed(() => {
  const filter = controller.value?.filters[state.value?.filterIndex ?? 0]
  return (state.value?.location?.entries ?? [])
    .filter(entry => (!directory.value || entry.kind === 'directory') && matchesTosFileFilter(entry, filter) && entry.name.toLowerCase().includes(query.value.toLowerCase()))
    .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, language.value, { numeric: true }))
})
const activeRoot = computed(() => roots.value.filter(root => currentPath.value === root.path || currentPath.value?.startsWith(`${root.path}/`)).sort((a, b) => b.path.length - a.path.length)[0])
const breadcrumbs = computed(() => {
  const root = activeRoot.value
  if (!root) return currentPath.value ? [{ name: state.value?.location?.directory?.name ?? currentPath.value, path: currentPath.value }] : []
  const result = [{ name: root.name, path: root.path }]
  let path = root.path
  for (const name of currentPath.value!.slice(root.path.length).split('/').filter(Boolean)) { path += `/${name}`; result.push({ name, path }) }
  return result
})
const highlightedEntries = computed(() => (state.value?.location?.entries ?? []).filter(entry => highlighted.value.includes(entry.path)))
const folderToOpen = computed(() => !directory.value && highlightedEntries.value.length === 1 && highlightedEntries.value[0]?.kind === 'directory' ? highlightedEntries.value[0] : null)
const canConfirm = computed(() => { void state.value; return !busy.value && (!!folderToOpen.value || !!controller.value?.canConfirm) })
const selectionName = computed(() => highlightedEntries.value.map(entry => entry.name).join(', ') || (directory.value ? state.value?.location?.directory?.name ?? '' : ''))
const filenameError = computed(() => {
  if (!saving.value || !state.value?.filename) return ''
  if (!validTosFilename(state.value.filename)) return t('名称不能为 . 或 ..，也不能包含斜杠或控制字符。')
  if (!directory.value && !matchesTosFileFilter({ path: '', name: state.value.filename, kind: 'file' }, controller.value?.filters[state.value.filterIndex])) return t('名称与所选文件类型不匹配。')
  return ''
})
function cleanup() {
  session++
  rootsRequest?.abort()
  unsubscribe()
  controller.value?.dispose()
  controller.value = undefined
  state.value = undefined
  overwriteTarget.value = null
  overwriteDialog.value?.close()
}
function close(cancelled: boolean) {
  cleanup()
  dialog.value?.close()
  emit('update:modelValue', false)
  if (cancelled) emit('cancel')
}
async function loadRoots(provider: TosFileProvider, activeSession: number) {
  rootsRequest?.abort()
  const request = rootsRequest = new AbortController()
  rootsFailed.value = false
  try {
    const result = await provider.list(null, { signal: request.signal })
    if (session === activeSession && !request.signal.aborted) roots.value = result.entries.filter(entry => entry.kind === 'directory')
  } catch { if (session === activeSession && !request.signal.aborted) rootsFailed.value = true }
}
function resetSelection() { highlighted.value = []; focusedPath.value = null; anchor.value = null }
async function navigate(path: string | null, index?: number) {
  const active = controller.value
  if (!active) return
  const request = ++navigationRequest
  const restoreListFocus = !!dialog.value?.open
  if (index !== undefined) historyIndex.value = index
  else if (historyIndex.value < 0 || history.value[historyIndex.value] !== path) {
    history.value = [...history.value.slice(0, historyIndex.value + 1), path]
    historyIndex.value = history.value.length - 1
  }
  currentPath.value = path
  editingAddress.value = false
  query.value = ''
  resetSelection()
  await active.navigate(path)
  if (controller.value !== active || request !== navigationRequest) return
  if (active.snapshot.location) currentPath.value = active.snapshot.location.directory?.path ?? null
  focusedPath.value = entries.value[0]?.path ?? null
  if (restoreListFocus) {
    await nextTick()
    if (controller.value !== active || request !== navigationRequest) return
    if (focusedPath.value) await focusRow(focusedPath.value)
    else list.value?.focus()
  }
}
function travel(offset: number) {
  const index = historyIndex.value + offset
  if (index >= 0 && index < history.value.length) void navigate(history.value[index]!, index)
}
async function editAddress() {
  address.value = currentPath.value ?? ''
  editingAddress.value = true
  await nextTick()
  addressInput.value?.focus(); addressInput.value?.select()
}
function goAddress() {
  const value = address.value.trim()
  if (!value || value.startsWith('/')) void navigate(value ? value.replace(/\/$/, '') || '/' : null)
}
function selectRow(entry: TosFileEntry, event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
  if (busy.value) return
  const toggle = controller.value?.multiple && (event.ctrlKey || event.metaKey)
  const range = controller.value?.multiple && event.shiftKey && anchor.value
  if (range) {
    const start = entries.value.findIndex(item => item.path === anchor.value)
    const end = entries.value.findIndex(item => item.path === entry.path)
    highlighted.value = start < 0 ? [entry.path] : entries.value.slice(Math.min(start, end), Math.max(start, end) + 1).map(item => item.path)
  } else {
    highlighted.value = toggle ? highlighted.value.includes(entry.path) ? highlighted.value.filter(path => path !== entry.path) : [...highlighted.value, entry.path] : [entry.path]
    anchor.value = entry.path
  }
  focusedPath.value = entry.path
  controller.value?.setSelection(highlighted.value)
}
async function focusRow(path: string) {
  focusedPath.value = path
  await nextTick()
  const row = Array.from(list.value?.querySelectorAll<HTMLElement>('[role=option]') ?? []).find(element => element.dataset.path === path)
  row?.focus(); row?.scrollIntoView({ block: 'nearest' })
}
async function confirm(overwrite = false) {
  if (!overwrite && folderToOpen.value) { await navigate(folderToOpen.value.path); return }
  const active = controller.value
  const result = await active?.confirm(overwrite)
  if (!result || active !== controller.value) return
  close(false)
  emit('select', result)
}
function activate(entry: TosFileEntry) {
  if (busy.value) return
  if (entry.kind === 'directory') { void navigate(entry.path); return }
  selectRow(entry)
  void confirm()
}
function listKey(event: KeyboardEvent) {
  if (busy.value || !entries.value.length) return
  const index = Math.max(0, entries.value.findIndex(entry => entry.path === focusedPath.value))
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.value.length - 1 : Math.max(0, Math.min(entries.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    const entry = entries.value[next]!
    if (!event.ctrlKey && !event.metaKey) selectRow(entry, event)
    void focusRow(entry.path)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const entry = entries.value[index]!
    if (entry.kind === 'directory') void navigate(entry.path)
    else if (highlighted.value.includes(entry.path)) void confirm()
    else activate(entry)
  } else if (event.key === ' ') {
    event.preventDefault(); selectRow(entries.value[index]!, { ctrlKey: true, shiftKey: event.shiftKey })
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && controller.value?.multiple) {
    event.preventDefault()
    highlighted.value = entries.value.filter(entry => entry.kind === controller.value!.kind).map(entry => entry.path)
    controller.value.setSelection(highlighted.value)
  }
}
function dialogKey(event: KeyboardEvent) {
  if (overwriteDialog.value?.open) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); void editAddress() }
  if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); travel(-1) }
  if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); travel(1) }
  if (event.altKey && event.key === 'ArrowUp' && state.value?.location?.directory) { event.preventDefault(); void navigate(state.value.location.parentPath) }
}
function setFilename(value: string) { highlighted.value = []; controller.value?.setFilename(value) }
function setFilter(value: string) { resetSelection(); controller.value?.setFilter(Number(value)) }
function cancelOverwrite() { controller.value?.cancelOverwrite() }
function sizeLabel(entry: TosFileEntry) {
  if (entry.kind === 'directory' || entry.size === undefined || !Number.isFinite(entry.size)) return '—'
  if (entry.size < 1024) return `${entry.size} B`
  const unit = entry.size < 1024 ** 2 ? 'KB' : entry.size < 1024 ** 3 ? 'MB' : 'GB'
  const divisor = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3
  return `${(entry.size / divisor).toLocaleString(language.value, { maximumFractionDigits: 1 })} ${unit}`
}
function dateLabel(entry: TosFileEntry) {
  const date = entry.modifiedAt ? new Date(entry.modifiedAt) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(language.value) : '—'
}
watch(query, () => {
  resetSelection()
  controller.value?.setSelection([])
  focusedPath.value = entries.value[0]?.path ?? null
})
watch(() => props.modelValue, async open => {
  cleanup()
  if (!open) { dialog.value?.close(); return }
  roots.value = []; history.value = []; historyIndex.value = -1
  const provider = props.provider ?? core.files
  missingProvider.value = !provider
  const currentSession = session
  if (provider) {
    const active = createFileDialog(provider, props)
    controller.value = active; state.value = active.snapshot
    unsubscribe = active.subscribe(value => { state.value = value })
    void loadRoots(provider, currentSession)
    void navigate(props.initialPath ?? null)
  }
  await nextTick()
  if (session === currentSession && props.modelValue && !dialog.value?.open) dialog.value?.showModal()
}, { immediate: true, flush: 'post' })
watch(() => [state.value?.overwritePath, state.value?.checking] as const, async ([path, checking]) => {
  if (path) {
    overwriteTarget.value = path
    await nextTick()
    if (overwriteTarget.value && props.modelValue && !overwriteDialog.value?.open) overwriteDialog.value?.showModal()
  } else if (!checking) {
    overwriteTarget.value = null
    const wasOpen = overwriteDialog.value?.open
    overwriteDialog.value?.close()
    if (wasOpen && dialog.value?.open) {
      await nextTick()
      dialog.value.querySelector<HTMLButtonElement>('.actions .primary')?.focus()
    }
  }
}, { flush: 'post' })
onBeforeUnmount(() => { cleanup(); dialog.value?.close() })
</script>

<template>
  <dialog ref="dialog" class="tos-file-dialog" :aria-labelledby="`${id}-title`" @cancel.prevent="close(true)" @keydown="dialogKey">
    <div class="dialog-layout">
      <header class="titlebar"><h2 :id="`${id}-title`">{{ heading }}</h2><button type="button" class="icon-button" :aria-label="t('关闭')" :title="t('关闭')" @click="close(true)"><Icon name="close" /></button></header>
      <p v-if="missingProvider" class="message error" role="alert">{{ t('尚未配置文件服务。') }}</p>
      <template v-else-if="state && controller">
        <div class="toolbar">
          <nav class="navigation" :aria-label="t('目录导航')">
            <button type="button" class="icon-button" :aria-label="t('后退')" :title="t('后退')" :disabled="historyIndex <= 0" @click="travel(-1)"><Icon name="back" /></button>
            <button type="button" class="icon-button" :aria-label="t('前进')" :title="t('前进')" :disabled="historyIndex >= history.length - 1" @click="travel(1)"><Icon name="forward" /></button>
            <button type="button" class="icon-button" :aria-label="t('上一级')" :title="t('上一级')" :disabled="!state.location?.directory || state.loading" @click="navigate(state.location?.parentPath ?? null)"><Icon name="up" /></button>
          </nav>
          <div class="address-bar">
            <form v-if="editingAddress" class="address-form" @submit.prevent="goAddress"><input ref="addressInput" v-model="address" :aria-label="t('目录路径')" :placeholder="t('输入 NAS 绝对路径')" :aria-invalid="!!address && !address.startsWith('/')" @keydown.esc.stop.prevent="editingAddress = false" @blur="editingAddress = false" /></form>
            <nav v-else class="breadcrumbs" :aria-label="t('当前位置')">
              <button type="button" :title="t('共享文件夹')" :aria-label="t('共享文件夹')" @click="navigate(null)"><Icon name="server" /><span v-if="!currentPath">{{ t('共享文件夹') }}</span></button>
              <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path"><Icon name="chevron" /><button type="button" :title="crumb.path" :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined" @click="navigate(crumb.path)">{{ crumb.name }}</button></template>
            </nav>
            <button v-if="!editingAddress" type="button" class="icon-button edit-path" :aria-label="t('编辑路径')" :title="t('编辑路径')" @click="editAddress"><Icon name="edit" /></button>
            <button type="button" class="icon-button" :aria-label="t('刷新')" :title="t('刷新')" :disabled="state.loading" @click="navigate(currentPath)"><Icon name="refresh" /></button>
          </div>
          <label class="search"><Icon name="search" /><input v-model="query" type="search" :aria-label="t('筛选当前目录')" :placeholder="t('筛选当前目录')" :disabled="state.loading || state.checking" /></label>
        </div>
        <div class="browser-body">
          <aside class="places" :aria-label="t('位置')">
            <button type="button" class="place" :class="{ active: currentPath === null }" @click="navigate(null)"><Icon name="server" /><span>{{ t('共享文件夹') }}</span></button>
            <button v-for="root in roots" :key="root.path" type="button" class="place share" :class="{ active: activeRoot?.path === root.path }" :title="root.path" :aria-current="activeRoot?.path === root.path ? 'location' : undefined" @click="navigate(root.path)"><Icon name="folder" /><span>{{ root.name }}</span></button>
            <button v-if="rootsFailed" type="button" class="roots-retry" @click="loadRoots(props.provider ?? core.files!, session)">{{ t('重新加载位置') }}</button>
          </aside>
          <section class="file-pane" :aria-label="t('文件和文件夹')">
            <div class="column-head" aria-hidden="true"><span>{{ t('名称') }}</span><span class="date-column">{{ t('修改日期') }}</span><span class="type-column">{{ t('类型') }}</span><span class="size-column">{{ t('大小') }}</span></div>
            <div ref="list" class="listing" role="listbox" :aria-label="t('文件和文件夹')" :aria-multiselectable="controller.multiple" :aria-busy="state.loading" :tabindex="entries.length ? -1 : 0" @keydown="listKey" @click.self="resetSelection(); controller.setSelection([])">
              <div v-if="state.loading" class="list-message" role="status"><p>{{ t('正在读取目录…') }}</p></div>
              <div v-else-if="!state.location" class="list-message error" role="alert"><Icon name="warning" /><p>{{ t(state.error ?? '目录不可用') }}</p><button type="button" @click="navigate(currentPath)">{{ t('重试') }}</button></div>
              <div v-else-if="!entries.length" class="list-message" role="status"><Icon name="folder" /><p>{{ t(query ? '没有匹配的项目' : '此文件夹为空') }}</p><button v-if="query" type="button" @click="query = ''">{{ t('清除筛选') }}</button></div>
              <div v-for="entry in entries" :key="entry.path" class="file-row" role="option" :data-path="entry.path" :aria-selected="highlighted.includes(entry.path)" :aria-label="entry.name" :tabindex="(focusedPath ?? entries[0]?.path) === entry.path ? 0 : -1" :class="{ selected: highlighted.includes(entry.path) }" @focus="focusedPath = entry.path" @click="selectRow(entry, $event)" @dblclick="activate(entry)">
                <span class="entry-name"><Icon :name="entry.kind === 'directory' ? 'folder' : 'file'" :class="{ folder: entry.kind === 'directory' }" /><span :title="entry.name">{{ entry.name }}</span></span>
                <span class="date-column">{{ dateLabel(entry) }}</span><span class="type-column">{{ t(entry.kind === 'directory' ? '文件夹' : '文件') }}</span><span class="size-column">{{ sizeLabel(entry) }}</span>
                <button v-if="entry.kind === 'directory'" type="button" class="touch-open icon-button" :aria-label="t('进入 {name}', { name: entry.name })" @click.stop="navigate(entry.path)" @dblclick.stop><Icon name="chevron" /></button>
              </div>
            </div>
            <div class="list-status" role="status"><span>{{ t('共 {count} 项', { count: entries.length }) }}</span><span v-if="highlighted.length">{{ t('已选择 {count} 项', { count: highlighted.length }) }}</span><span v-else-if="directory && state.location?.directory">{{ t('将选择当前文件夹') }}</span></div>
          </section>
        </div>
        <div class="bottom-panel">
          <div class="fields">
            <label><span>{{ t(directory ? '文件夹名称' : '文件名') }}</span><input v-if="saving" :value="state.filename" :disabled="state.loading || state.checking" :aria-invalid="!!filenameError" :aria-describedby="filenameError ? `${id}-filename-error` : undefined" @input="setFilename(($event.target as HTMLInputElement).value)" @keydown.enter.prevent="confirm()" /><input v-else :value="selectionName" readonly :placeholder="t('请选择项目')" /></label>
            <label v-if="!directory && controller.filters.length"><span>{{ t('文件类型') }}</span><select :value="state.filterIndex" :disabled="state.loading || state.checking" @change="setFilter(($event.target as HTMLSelectElement).value)"><option v-for="(filter, index) in controller.filters" :key="index" :value="index">{{ filter.label }}</option></select></label>
          </div>
          <div class="actions"><button type="button" class="primary" :disabled="!canConfirm" @click="confirm()">{{ t(state.checking ? '正在检查…' : folderToOpen ? '打开' : saving ? '保存' : directory ? '选择文件夹' : '打开') }}</button><button type="button" @click="close(true)">{{ t('取消') }}</button></div>
          <p v-if="filenameError" :id="`${id}-filename-error`" class="error footer-error">{{ filenameError }}</p>
          <p v-if="state.error && state.location" class="error footer-error" role="alert">{{ t(state.error) }}</p>
        </div>
      </template>
      <div v-if="missingProvider" class="missing-actions"><button type="button" @click="close(true)">{{ t('关闭') }}</button></div>
    </div>
  </dialog>
  <dialog ref="overwriteDialog" class="tos-overwrite-dialog" role="alertdialog" :aria-labelledby="`${id}-overwrite-title`" :aria-describedby="`${id}-overwrite-description`" @cancel.stop.prevent="cancelOverwrite">
    <div class="overwrite-content"><Icon name="warning" class="warning-icon" /><div><h2 :id="`${id}-overwrite-title`">{{ t(directory ? '使用已有文件夹？' : '替换已有文件？') }}</h2><p :id="`${id}-overwrite-description`">{{ t(directory ? '目标位置已存在同名文件夹，是否使用此文件夹？' : '目标位置已存在同名文件，继续保存将替换该文件。') }}</p><p class="overwrite-path">{{ overwriteTarget }}</p></div></div>
    <div class="overwrite-actions"><button type="button" autofocus :disabled="state?.checking" @click="cancelOverwrite">{{ t('取消') }}</button><button type="button" class="primary" :disabled="state?.checking" @click="confirm(true)">{{ t(state?.checking ? '正在检查…' : directory ? '使用此文件夹' : '替换') }}</button></div>
  </dialog>
</template>

<style scoped>
.tos-file-dialog, .tos-overwrite-dialog { box-sizing: border-box; margin: auto; padding: 0; color: var(--text); background: var(--dialog); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 16px 48px #0004; font: 13px/1.45 system-ui, sans-serif; color-scheme: inherit; }
.tos-file-dialog { width: min(840px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); overflow: hidden; }
.tos-file-dialog::backdrop { background: var(--backdrop); }
.tos-overwrite-dialog::backdrop { background: #0005; }
.dialog-layout { display: flex; flex-direction: column; height: min(540px, calc(100dvh - 34px)); }
.titlebar { display: flex; align-items: center; justify-content: space-between; flex: none; height: 40px; padding: 0 12px 0 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
h2 { margin: 0; font-size: 14px; font-weight: 600; }
.titlebar h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button, input, select { box-sizing: border-box; min-height: 32px; border: 1px solid var(--border); border-radius: 4px; color: var(--text); background: var(--field); font: inherit; }
button { padding: 4px 12px; cursor: pointer; }
button:hover:not(:disabled) { background: var(--hover); }
button:active:not(:disabled) { background: var(--active); }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, [role=option]:focus-visible, .listing:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
input:hover:not(:disabled):not(:focus-visible), select:hover:not(:disabled):not(:focus-visible) { border-color: var(--muted); }
input:focus-visible, select:focus-visible { border-color: var(--focus); }
input, select { min-width: 0; width: 100%; padding: 4px 8px; caret-color: var(--text); }
input::placeholder { color: var(--placeholder); }
input::selection { color: var(--selected-text); background: var(--selected); }
button.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary-border); }
button.primary:hover:not(:disabled) { background: var(--primary-hover); }
button.primary:focus-visible { outline-color: var(--on-primary); outline-offset: -4px; }
.icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; min-width: 32px; padding: 0; border-color: transparent; background: transparent; }
.toolbar { flex: none; display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.navigation { display: flex; gap: 2px; }
.address-bar { display: flex; min-width: 0; flex: 1; height: 32px; border: 1px solid var(--border); border-radius: 4px; background: var(--field); }
.address-bar > .icon-button { min-height: 30px; height: 30px; width: 28px; min-width: 28px; }
.breadcrumbs { display: flex; align-items: center; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.breadcrumbs > svg { width: 12px; color: var(--muted); }
.breadcrumbs button { display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 2px 6px; white-space: nowrap; border: 0; background: transparent; }
.address-form { flex: 1; min-width: 0; }
.address-form input { height: 30px; min-height: 30px; border: 0; }
.address-bar:has(.address-form input:focus-visible) { border-color: var(--focus); outline: 2px solid var(--focus); outline-offset: -2px; }
.address-form input:focus-visible { outline: none; }
.search { display: flex; align-items: center; gap: 6px; width: 175px; padding-left: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--field); color: var(--muted); }
.search input { border: 0; min-height: 30px; padding-left: 0; background: transparent; }
.search:hover:not(:has(input:disabled)):not(:focus-within) { border-color: var(--muted); }
.search:focus-within { color: var(--accent); border-color: var(--focus); outline: 2px solid var(--focus); outline-offset: -2px; }
.search input:focus-visible { outline: none; }
.browser-body { display: grid; grid-template-columns: 164px minmax(0, 1fr); flex: 1; min-height: 100px; }
.places { padding: 10px 6px; background: var(--panel); border-right: 1px solid var(--line); overflow-y: auto; }
.place { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 5px 8px; margin-bottom: 3px; background: transparent; border: 1px solid transparent; }
.place span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.place.share { padding-left: 20px; }
.place.active { background: var(--selected); color: var(--selected-text); }
.place svg, .folder { color: var(--folder); }
.place:first-child svg { color: var(--muted); }
.roots-retry { width: 100%; white-space: normal; }
.file-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--canvas); }
.column-head, .file-row { display: grid; grid-template-columns: minmax(0, 1fr) 100px 64px 66px; align-items: center; gap: 12px; padding: 0 12px; }
.column-head { flex: none; height: 30px; color: var(--muted); border-bottom: 1px solid var(--line); font-size: 12px; }
.listing { flex: 1; min-height: 0; overflow: auto; }
.file-row { min-height: 34px; cursor: default; user-select: none; border: 1px solid transparent; padding-inline: 11px; }
.file-row:hover { background: var(--row-hover); }
.file-row.selected { background: var(--selected); color: var(--selected-text); }
.entry-name { display: flex; align-items: center; min-width: 0; gap: 8px; }
.entry-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.date-column, .type-column, .size-column { font-size: 12px; color: var(--muted); white-space: nowrap; }
.size-column { text-align: right; font-variant-numeric: tabular-nums; }
.list-status { display: flex; gap: 16px; flex-wrap: wrap; padding: 5px 12px; min-height: 20px; flex: none; color: var(--muted); font-size: 12px; border-top: 1px solid var(--row-line); }
.list-message { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; min-height: 110px; color: var(--muted); text-align: center; }
.list-message > svg { width: 28px; height: 28px; }
.list-message p { margin: 10px 0; }
.error { color: var(--error); }
.bottom-panel { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px 16px; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--panel); }
.fields { display: grid; gap: 8px; }
.fields label { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 12px; }
.actions { display: grid; gap: 8px; min-width: 90px; }
.footer-error { grid-column: 1 / -1; margin: 0; font-size: 12px; }
.message { padding: 24px; }
.missing-actions { margin-top: auto; padding: 16px; text-align: right; }
.touch-open { display: none; }
.tos-overwrite-dialog { width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
.overwrite-content { display: flex; align-items: flex-start; gap: 16px; padding: 24px; }
.warning-icon { width: 30px; height: 30px; color: var(--folder); }
.overwrite-content > div { min-width: 0; }
.overwrite-content h2 { font-size: 16px; }
.overwrite-content p { margin: 10px 0 0; }
.overwrite-path { color: var(--muted); overflow-wrap: anywhere; }
.overwrite-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 24px; border-top: 1px solid var(--line); background: var(--panel); }
.overwrite-actions button { min-width: 80px; }
.listing, .places { scrollbar-color: var(--scrollbar) transparent; scrollbar-width: thin; }
@media (max-width: 720px) { .date-column { display: none; } .column-head, .file-row { grid-template-columns: minmax(0, 1fr) 64px 66px; } .search { width: 150px; } .browser-body { grid-template-columns: 142px minmax(0, 1fr); } }
@media (max-width: 620px) {
  .tos-file-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
  .dialog-layout { height: min(640px, calc(100dvh - 18px)); }
  button, input, select, .icon-button { min-height: 44px; }
  .titlebar { height: 48px; }
  .toolbar { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px; padding: 8px; }
  .navigation { gap: 0; }
  .navigation .icon-button { width: 36px; }
  .navigation .icon-button:nth-child(2) { display: none; }
  .address-bar { height: 44px; }
  .address-bar > .icon-button { height: 42px; min-height: 42px; }
  .address-form input { min-height: 42px; }
  .breadcrumbs button { min-height: 40px; }
  .search { grid-column: 1 / -1; width: auto; }
  .search input { min-height: 40px; }
  .browser-body { grid-template-columns: minmax(0, 1fr); }
  .places { display: none; }
  .column-head, .file-row { grid-template-columns: minmax(0, 1fr) 56px; gap: 8px; }
  .type-column, .size-column { display: none; }
  .file-row { min-height: 44px; }
  .touch-open { display: inline-flex; justify-self: end; width: 44px; }
  .bottom-panel { grid-template-columns: minmax(0, 1fr); padding: 10px 12px; gap: 10px; }
  .fields label { grid-template-columns: 68px minmax(0, 1fr); gap: 8px; }
  .actions { display: flex; flex-direction: row-reverse; }
  .actions button { min-width: 88px; }
  .overwrite-content { padding: 20px; gap: 12px; }
  .overwrite-actions { padding: 12px 20px; }
}
</style>
