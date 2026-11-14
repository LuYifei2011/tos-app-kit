import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTosApp, createTranslator } from '../src/index.ts'
import { createTosAppVue, useTosApp } from '../src/vue.ts'
import { createApp } from 'vue'
import { cleanups, storage, tick } from './browser-fixture.ts'

test('preferences and translations are isolated between applications', async () => {
  const a = createTosApp({ id: 'first' })
  const b = createTosApp({ id: 'second' })
  storage.set('first.preferences', '{"theme":"dark","language":"en-US"}')
  storage.set('second.preferences', '{"theme":"light","language":"zh-CN"}')
  cleanups.push(a.preferences.start(), b.preferences.start())
  a.preferences.setTheme('light')
  assert.equal(a.preferences.snapshot.themeSource, 'manual')
  assert.equal(b.preferences.snapshot.language, 'zh-CN')
  assert.equal(createTranslator(() => a.preferences.snapshot.language)('主题'), 'Theme')
  assert.equal(createTranslator(() => b.preferences.snapshot.language)('主题'), '主题')
  assert.equal(JSON.parse(storage.get('first.preferences')!).theme, 'light')
  assert.equal(JSON.parse(storage.get('second.preferences')!).language, 'zh-CN')
  await tick()
})
test('Vue injection supplies the matching application context to independent roots', () => {
  for (const id of ['first', 'second']) {
    const core = createTosApp({ id })
    const tos = createTosAppVue(core)
    cleanups.push(tos.dispose)
    const app = createApp({})
    app.use(tos)
    assert.equal(app.runWithContext(() => useTosApp()), tos)
    assert.equal(tos.core, core)
  }
})
