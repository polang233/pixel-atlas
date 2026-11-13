export const SITE_URL = 'https://pixelatlas.org'

/** `path` is where the locale lives; the first entry is the default and owns `/`. */
export const LOCALES = {
  'zh-CN': { path: '/', og: 'zh_CN' },
  en: { path: '/en/', og: 'en_US' },
} as const

export type Locale = keyof typeof LOCALES
export const isLocale = (value: string | null | undefined): value is Locale => value != null && Object.hasOwn(LOCALES, value)
