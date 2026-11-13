import { isLocale, LOCALES, type Locale, SITE_URL } from './locales.ts'
import { en } from './messages/en.ts'
import type { MessageArgs, MessageKey, MessagesShape } from './messages/types.ts'
import { zh } from './messages/zh-CN.ts'

const messages: Record<Locale, MessagesShape> = { 'zh-CN': zh, en }

export function message<K extends MessageKey>(locale: Locale, key: K, ...args: MessageArgs<K>): string {
  return interpolate(locale, key, args[0])
}

function interpolate(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const value = messages[locale][key]
  if (value === undefined) throw new Error(`Unknown message: ${key}`)
  // The public API checks each key's parameters; the DOM uses parameter-free messages only.
  if (typeof value === 'function') return (value as (p: typeof params) => string)(params)
  return value.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in params)) throw new Error(`Missing ${name} in ${key}`)
    return String(params[name])
  })
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function applyMessages(root: Document | Element, locale: Locale): void {
  const nodes = [...root.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]')]
  if ('matches' in root && root.matches('[data-i18n], [data-i18n-html], [data-i18n-attr]')) nodes.unshift(root)
  for (const el of nodes) {
    const target = el.getAttribute('data-locale')
    const language = isLocale(target) ? target : locale
    const text = el.getAttribute('data-i18n')
    const html = el.getAttribute('data-i18n-html')
    if (text) {
      if (text.endsWith('Html')) throw new Error(`Use data-i18n-html for ${text}`)
      el.textContent = interpolate(language, text)
    }
    if (html) {
      if (!html.endsWith('Html')) throw new Error(`HTML message must end in Html: ${html}`)
      el.innerHTML = interpolate(language, html)
    }
    for (const pair of (el.getAttribute('data-i18n-attr') ?? '').split(';')) {
      if (!pair.trim()) continue
      const [attr, key] = pair.split(':').map((s) => s.trim())
      if (!attr || !key || key.endsWith('Html')) throw new Error(`Invalid i18n attribute: ${pair}`)
      el.setAttribute(attr, interpolate(language, key))
    }
  }
  if ('documentElement' in root) {
    root.documentElement.lang = locale
    const url = SITE_URL + LOCALES[locale].path
    root.querySelector('link[rel="canonical"]')?.setAttribute('href', url)
    root.querySelector('meta[property="og:url"]')?.setAttribute('content', url)
    root.querySelector('meta[property="og:locale"]')?.setAttribute('content', LOCALES[locale].og)
    root.querySelectorAll('meta[property="og:locale:alternate"]').forEach((el) => {
      el.remove()
    })
    for (const code of Object.keys(LOCALES) as Locale[]) {
      if (code === locale) continue
      const meta = root.createElement('meta')
      meta.setAttribute('property', 'og:locale:alternate')
      meta.setAttribute('content', LOCALES[code].og)
      root.head.append(meta)
    }
    const ld = root.querySelector('script[type="application/ld+json"]')
    if (ld) {
      const site = JSON.parse(ld.textContent ?? '{}')
      ld.textContent = JSON.stringify({ ...site, url, inLanguage: locale, description: message(locale, 'meta.description') }, null, 2)
    }
  }
  root.querySelectorAll('[data-locale]').forEach((link) => {
    if (link.getAttribute('data-locale') === locale) link.setAttribute('aria-current', 'true')
    else link.removeAttribute('aria-current')
  })
}
