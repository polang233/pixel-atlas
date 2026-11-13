import { sound } from '../audio.ts'
import { getLocale, setLocale, storedPreference } from './index.ts'
import { isLocale, type Locale } from './locales.ts'

const links = () => [...document.querySelectorAll<HTMLAnchorElement>('.lang-switch a')]

export function initLanguageSwitch(): void {
  links().forEach((link, i) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      const locale = link.dataset.locale
      if (!isLocale(locale) || locale === getLocale()) return
      setLocale(locale)
      sound.select()
      links().forEach((a) => {
        a.classList.remove('is-suggested')
      })
      // On phones only the other language is shown, so the clicked link just disappeared.
      ;(link.getClientRects().length ? link : links().find((a) => a.getClientRects().length))?.focus({ preventScroll: true })
    })
    link.addEventListener('pointerenter', () => sound.tick(1500 + i * 160, 0.014))
  })
  suggestLanguage()
}

/**
 * A visitor whose browser does not read the page's language sees the other language's
 * link light up in gold (and blink a few times once the page is ready). No pop-up:
 * the switch is already where people look for it.
 */
function suggestLanguage(): void {
  if (storedPreference() || new URLSearchParams(location.search).has('bare')) return
  const languages = navigator.languages.length ? navigator.languages : [navigator.language]
  const reads = (prefix: string) => languages.some((l) => l.toLowerCase().startsWith(prefix))
  const target: Locale | null = getLocale() === 'zh-CN' ? (reads('zh') ? null : 'en') : /^zh/i.test(languages[0] ?? '') ? 'zh-CN' : null
  if (target)
    links()
      .find((a) => a.dataset.locale === target)
      ?.classList.add('is-suggested')
}
