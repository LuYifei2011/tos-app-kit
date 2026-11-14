import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const output = new URL('../build/release/', import.meta.url)
await mkdir(output, { recursive: true })
const checksums = []
for (const name of ['tos-app-core', 'tos-app-ui-kit']) {
  const directory = new URL(`../packages/${name}/`, import.meta.url)
  const pkg = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))
  if (pkg.version !== manifest.version) throw new Error(`${name} version must match ${manifest.version}`)
  for (const entry of ['dist/index.js', 'dist/index.d.ts']) await access(new URL(entry, directory))
  const result = JSON.parse(execFileSync('npm', ['pack', '--workspace', name, '--pack-destination', fileURLToPath(output), '--json'], { cwd: root, encoding: 'utf8' }))[0]
  if (result.files.some(file => file.path.startsWith('src/'))) throw new Error('Release packages must contain compiled entries')
  const bytes = await readFile(new URL(result.filename, output))
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${result.filename}`)
}
await writeFile(new URL('SHA256SUMS', output), checksums.join('\n') + '\n')
process.stdout.write(checksums.join('\n') + '\n')
