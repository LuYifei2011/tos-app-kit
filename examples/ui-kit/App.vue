<script setup lang="ts">
import { ref } from 'vue'
import type { TosFileDialogOptions, TosFileDialogResult } from 'tos-app-core'
import { useTosApp } from 'tos-app-core/vue'
import { TosAppShell, TosConnectionReport, TosPreferencesForm, TosFileDialog, TosPathInput } from 'tos-app-ui-kit'

const { core, language } = useTosApp()
const filePath = ref('/共享文档/说明.md')
const folderPath = ref('/共享文档')
const savePath = ref('/共享文档/工作记录.txt')
const editablePath = ref(false)
const disablePath = ref(false)
const dialogOpen = ref(false)
const dialogOptions = ref<TosFileDialogOptions>({})
const result = ref<TosFileDialogResult>()
function showFiles(mode: 'open' | 'save', kind: 'file' | 'directory') {
  dialogOptions.value = {
    mode, kind, multiple: mode === 'open', initialPath: '/共享文档',
    defaultName: kind === 'file' ? '工作记录.txt' : '新建文件夹',
    filters: kind === 'file' ? [
      { label: language.value === 'en-US' ? 'Text files (.txt, .md)' : '文本文件 (.txt, .md)', extensions: ['.txt', '.md'] },
      { label: language.value === 'en-US' ? 'All files' : '所有文件', extensions: [] },
    ] : [],
  }
  dialogOpen.value = true
}
async function showDiagnostic() {
  try { await core.api.request('/example') } catch { /* The example deliberately returns a local 403. */ }
}
</script>

<template>
  <TosAppShell :title="language === 'en-US' ? 'TOS Kit example' : 'TOS Kit 示例'">
    <template #header-extra>{{ language }}</template>
    <div class="example-content">
    <TosPreferencesForm />
    <div class="actions">
      <button class="button secondary" @click="showDiagnostic">{{ language === 'en-US' ? 'Show sample diagnostic' : '显示示例诊断' }}</button>
      <button class="button secondary" @click="core.api.reset()">{{ language === 'en-US' ? 'Clear diagnostic' : '清除诊断' }}</button>
    </div>
    <section class="file-example">
      <h2>{{ language === 'en-US' ? 'NAS file dialogs' : 'NAS 文件对话框' }}</h2>
      <p>{{ language === 'en-US' ? 'Browse sample shared folders and inspect the returned paths.' : '浏览示例共享文件夹，查看对话框返回的路径。' }}</p>
      <div class="actions">
        <button class="button secondary" @click="showFiles('open', 'file')">{{ language === 'en-US' ? 'Open files' : '打开文件' }}</button>
        <button class="button secondary" @click="showFiles('open', 'directory')">{{ language === 'en-US' ? 'Select folders' : '选择文件夹' }}</button>
        <button class="button secondary" @click="showFiles('save', 'file')">{{ language === 'en-US' ? 'Save file' : '保存文件' }}</button>
        <button class="button secondary" @click="showFiles('save', 'directory')">{{ language === 'en-US' ? 'Save folder' : '保存文件夹' }}</button>
      </div>
      <pre v-if="result" aria-live="polite">{{ JSON.stringify(result, null, 2) }}</pre>
    </section>
    <section class="file-example path-examples">
      <h2>{{ language === 'en-US' ? 'Path input' : '路径输入' }}</h2>
      <label for="example-file-path">{{ language === 'en-US' ? 'File path' : '文件路径' }}</label>
      <TosPathInput id="example-file-path" v-model="filePath" :aria-label="language === 'en-US' ? 'File path' : '文件路径'" @select="result = $event" />
      <label for="example-folder-path">{{ language === 'en-US' ? 'Folder path' : '文件夹路径' }}</label>
      <TosPathInput id="example-folder-path" v-model="folderPath" kind="directory" :editable="editablePath" :disabled="disablePath" :aria-label="language === 'en-US' ? 'Folder path' : '文件夹路径'" @select="result = $event" />
      <div class="path-options"><label><input v-model="editablePath" type="checkbox" />{{ language === 'en-US' ? 'Allow direct editing' : '允许直接编辑' }}</label><label><input v-model="disablePath" type="checkbox" />{{ language === 'en-US' ? 'Disable folder input' : '禁用文件夹输入' }}</label></div>
      <label for="example-save-path">{{ language === 'en-US' ? 'Save path' : '保存路径' }}</label>
      <TosPathInput id="example-save-path" v-model="savePath" mode="save" :aria-label="language === 'en-US' ? 'Save path' : '保存路径'" @select="result = $event" />
    </section>
    <TosFileDialog v-model="dialogOpen" v-bind="dialogOptions" @select="result = $event" />
    <TosConnectionReport />
    </div>
  </TosAppShell>
</template>

<style scoped>
.example-content { max-width: 620px; padding: 24px 20px; margin: auto; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
.file-example { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 20px; }
h2 { font-size: 16px; }
p { color: var(--muted); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; border: 1px solid var(--line); background: var(--panel); }
.path-examples { display: grid; gap: 8px; }
.path-examples h2 { margin: 0 0 8px; }
.path-options { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
.path-options label { display: flex; align-items: center; gap: 6px; }
</style>
