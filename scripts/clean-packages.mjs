import { rm } from 'node:fs/promises'
for (const name of ['tos-app-core', 'tos-app-ui-kit']) {
  await rm(new URL(`../packages/${name}/dist/`, import.meta.url), { recursive: true, force: true })
}
