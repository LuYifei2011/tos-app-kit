import { createApp } from 'vue'
import { createTosApp } from 'tos-app-core'
import { createTosAppVue } from 'tos-app-core/vue'
import 'tos-app-ui-kit/tokens.css'
import 'tos-app-ui-kit/base.css'
import 'tos-app-ui-kit/style.css'
import App from './App.vue'
import { exampleFiles } from './files'

const core = createTosApp({
  id: 'kit-example', version: '0.3.2',
  files: exampleFiles,
  preferences: { readTheme: async () => null, readLanguage: async () => null },
  api: { fetch: async () => Response.json({ code: 'EXAMPLE_FAILURE' }, { status: 403 }) },
})
const tos = createTosAppVue(core)
tos.start({ title: locale => locale === 'en-US' ? 'TOS Kit example' : 'TOS Kit 示例' })
const app = createApp(App).use(tos)
app.mount('#app')
if (import.meta.hot) import.meta.hot.dispose(() => app.unmount())
