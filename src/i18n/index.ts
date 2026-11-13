import { applyMessages, message } from './dom.ts'
import { isLocale, LOCALES, type Locale } from './locales.ts'
import type { MessageArgs, MessageKey } from './messages/types.ts'

export { escapeHtml } from './dom.ts'
export { LOCALES, type Locale } from './locales.ts'
export type { MessageKey, MessageParams } from './messages/types.ts'

let locale: Locale = 'zh-CN'
let integerFormat = new Intl.NumberFormat(locale)
const compactFormats = new Map<string, Intl.NumberFormat>()
const listeners = new Set<() => void>()
export const getLocale = (): Locale => locale
export const t = <K extends MessageKey>(key: K, ...args: MessageArgs<K>): string => message(locale, key, ...args)
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function storedPreference(): Locale | null {
  try {
    const saved = localStorage.getItem('pixel-atlas.locale')
    return isLocale(saved) ? saved : null
  } catch {
    return null
  }
}
function apply(locale: Locale) {
  integerFormat = new Intl.NumberFormat(locale)
  applyMessages(document, locale)
  history.replaceState(history.state, '', LOCALES[locale].path + location.search + location.hash)
}
export function initLocale(): void {
  // The path decides; on the default path a saved choice may override it.
  const dir = `${location.pathname.replace(/\/+$/, '')}/`
  const fromPath = (Object.keys(LOCALES) as Locale[]).find((l) => LOCALES[l].path === dir)
  locale = fromPath && fromPath !== 'zh-CN' ? fromPath : (storedPreference() ?? 'zh-CN')
  apply(locale)
}
export function setLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  apply(locale)
  try {
    localStorage.setItem('pixel-atlas.locale', locale)
  } catch {
    /* Storage can be blocked. */
  }
  listeners.forEach((listener) => {
    listener()
  })
}
export const formatInt = (n: number): string => integerFormat.format(n)
export function formatCount(n: number, style: 'short' | 'long'): string {
  if (locale === 'zh-CN') return t('count.tenThousands', { n: Math.round(n / 1e4) })
  if (style === 'long' && n < 1e6) return formatInt(n)
  const key = `${locale}:${style}:${n >= 1e6 ? 'M' : 'k'}`
  let format = compactFormats.get(key)
  if (!format) {
    // 1.4M keeps a decimal; thousands read better whole (544k, not 543.7k).
    format = new Intl.NumberFormat(locale, { notation: 'compact', compactDisplay: style, maximumFractionDigits: n >= 1e6 ? 1 : 0 })
    compactFormats.set(key, format)
  }
  return format.format(n).replace(/K$/, 'k')
}
