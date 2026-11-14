import type { TosFileEntry, TosFileProvider } from 'tos-app-core'

const entries: TosFileEntry[] = [
  { path: '/共享文档', name: '共享文档', kind: 'directory' },
  { path: '/照片', name: '照片', kind: 'directory' },
  { path: '/共享文档/项目资料', name: '项目资料', kind: 'directory' },
  { path: '/共享文档/空文件夹', name: '空文件夹', kind: 'directory' },
  { path: '/共享文档/无权限目录', name: '无权限目录', kind: 'directory' },
  { path: '/共享文档/工作记录.txt', name: '工作记录.txt', kind: 'file', size: 24576, modifiedAt: '2026-11-13T14:30:00+08:00' },
  { path: '/共享文档/说明.md', name: '说明.md', kind: 'file', size: 2048, modifiedAt: '2026-11-12T09:00:00+08:00' },
  { path: '/共享文档/项目资料/季度报告与相关附件的归档说明（最终确认版本）.txt', name: '季度报告与相关附件的归档说明（最终确认版本）.txt', kind: 'file' },
  { path: '/照片/旅行.jpg', name: '旅行.jpg', kind: 'file' },
]
function parent(path: string) { return path.slice(0, path.lastIndexOf('/')) || null }
async function delay(signal: AbortSignal) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 250)
    signal.addEventListener('abort', cancel, { once: true })
  })
}
/** In-memory NAS fixture: the example never reads or writes the host filesystem. */
export const exampleFiles: TosFileProvider = {
  async list(path, { signal }) {
    await delay(signal)
    if (path === '/共享文档/无权限目录') throw new Error('Permission denied')
    const directory = entries.find(entry => entry.path === path) ?? null
    if (path !== null && directory?.kind !== 'directory') throw new Error('Directory not found')
    return { directory, parentPath: path === null ? null : parent(path), entries: entries.filter(entry => parent(entry.path) === path) }
  },
  async stat(path, { signal }) {
    await delay(signal)
    return entries.find(entry => entry.path === path) ?? null
  },
}
