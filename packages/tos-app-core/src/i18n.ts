import type { Locale } from './preferences.ts'

export type MessageParams = Record<string, string | number>
export type Translator = (source: string, params?: MessageParams) => string
export const commonEnglish: Record<string, string> = {
  '连接诊断': 'Connection diagnostics', '前端 / 后端版本': 'Frontend / backend version',
  '响应未提供': 'Not provided', '响应': 'Response', '网络失败': 'Network failure',
  '页面可读取': 'Readable by this page', '页面未读取到': 'Not read by this page',
  '页面设置 CSRF 请求头': 'CSRF header set by this page', '是': 'Yes', '否': 'No',
  '报告仅记录凭据是否可读，不包含 Cookie 或令牌值。页面读取结果不能代表系统最终发送的全部凭据。': 'This report records whether credentials are readable, without cookie or token values. What the page can read does not represent all credentials sent by the system.',
  '查看完整报告': 'View full report', '连接诊断报告': 'Connection diagnostic report', '选中报告': 'Select report',
  '语言': 'Language', '跟随浏览器': 'Follow browser', '跟随 TOS': 'Follow TOS',
  '路径': 'Path', '选择文件': 'Choose file', '选择保存位置': 'Choose save location',
  '位置': 'Places', '后退': 'Back', '前进': 'Forward', '目录路径': 'Folder path',
  '当前位置': 'Current location', '编辑路径': 'Edit path', '输入 NAS 绝对路径': 'Enter an absolute NAS path',
  '重新加载位置': 'Reload places', '名称': 'Name', '修改日期': 'Date modified', '类型': 'Type', '大小': 'Size',
  '没有匹配的项目': 'No matching items', '此文件夹为空': 'This folder is empty', '清除筛选': 'Clear filter',
  '共 {count} 项': '{count} items', '请选择项目': 'Select an item', '替换': 'Replace',
  '使用已有文件夹？': 'Use existing folder?', '替换已有文件？': 'Replace existing file?',
  '目标位置已存在同名文件夹，是否使用此文件夹？': 'A folder with this name already exists at this location. Use this folder?',
  '目标位置已存在同名文件，继续保存将替换该文件。': 'A file with this name already exists at this location. Saving will replace it.',
  '打开文件': 'Open file', '选择文件夹': 'Select folder', '保存文件': 'Save file', '保存文件夹': 'Save folder',
  '关闭': 'Close', '取消': 'Cancel', '打开': 'Open', '保存': 'Save', '返回': 'Back', '覆盖': 'Overwrite',
  '共享文件夹': 'Shared folders', '上一级': 'Up', '刷新': 'Refresh', '重试': 'Retry',
  '目录导航': 'Directory navigation', '筛选当前目录': 'Filter this directory',
  '正在读取目录…': 'Loading directory…', '正在检查…': 'Checking…', '目录不可用': 'Directory unavailable',
  '没有可显示的项目': 'No items to display', '文件和文件夹': 'Files and folders',
  '文件': 'File', '文件夹': 'Folder', '文件名': 'File name', '文件夹名称': 'Folder name', '文件类型': 'File type',
  '选择 {name}': 'Select {name}', '进入 {name}': 'Open folder {name}',
  '已选择 {count} 项': '{count} selected', '将选择当前文件夹': 'The current folder will be selected',
  '同名文件已存在，是否覆盖？': 'A file with this name exists. Overwrite it?',
  '同名文件夹已存在，仍要使用此目标？': 'A folder with this name exists. Use this destination?',
  '使用此文件夹': 'Use this folder', '尚未配置文件服务。': 'No file service has been configured.',
  '名称不能为 . 或 ..，也不能包含斜杠或控制字符。': 'The name cannot be . or .. or contain slashes or control characters.',
  '名称与所选文件类型不匹配。': 'The name does not match the selected file type.',
  '无法读取目录，请重试。': 'Unable to read the directory. Please retry.',
  '所选项目已不存在或类型已更改，请刷新目录。': 'A selected item is missing or its type has changed. Refresh the directory.',
  '此名称已被另一类型的项目占用。': 'This name is already used by an item of a different type.',
  '无法检查所选路径，请重试。': 'Unable to check the selected path. Please retry.',
  '主题': 'Theme', '浅色': 'Light', '深色': 'Dark',
}
export function createTranslator(locale: () => Locale, english: Record<string, string> = {}, singular: Record<string, string> = {}): Translator {
  const messages = { ...commonEnglish, ...english }
  return (source, params = {}) => {
    let text = source
    if (locale() === 'en-US' && Object.hasOwn(messages, source)) {
      text = (params.count === 1 || params.count === '1') && Object.hasOwn(singular, source) ? singular[source]! : messages[source]!
    }
    return text.replace(/\{(\w+)\}/g, (token, key: string) => params[key] === undefined ? token : String(params[key]))
  }
}
