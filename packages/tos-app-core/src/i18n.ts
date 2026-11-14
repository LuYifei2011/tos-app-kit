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
