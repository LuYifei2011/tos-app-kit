import { copyFile } from 'node:fs/promises'
for (const name of ['tokens.css', 'base.css']) {
  await copyFile(new URL(`../packages/tos-app-ui-kit/src/${name}`, import.meta.url), new URL(`../packages/tos-app-ui-kit/dist/${name}`, import.meta.url))
}
