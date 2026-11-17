/**
 * GitHub star counts, fetched on demand from the public API (60 unauthenticated requests an hour
 * per visitor, so nothing is fetched until someone actually hovers) and kept for the session.
 */
import { sound } from './audio'
import { formatInt, onLocaleChange, t } from './i18n'

const TTL = 60 * 60 * 1000
const pending = new Map<string, Promise<number | null>>()

function cached(repo: string): number | null {
  try {
    const raw = sessionStorage.getItem(`gh-stars:${repo}`)
    if (!raw) return null
    const { n, at } = JSON.parse(raw) as { n: number; at: number }
    return Date.now() - at < TTL ? n : null
  } catch {
    return null
  }
}

/** Star count for `owner/name`, or null when GitHub can't be reached or is rate-limiting. */
export function fetchStars(repo: string): Promise<number | null> {
  const hit = cached(repo)
  if (hit !== null) return Promise.resolve(hit)
  let p = pending.get(repo)
  if (!p) {
    p = fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? (r.json() as Promise<{ stargazers_count?: number }>) : null))
      .then((j) => {
        const n = j?.stargazers_count
        if (typeof n !== 'number') return null
        try {
          sessionStorage.setItem(`gh-stars:${repo}`, JSON.stringify({ n, at: Date.now() }))
        } catch {}
        return n
      })
      .catch(() => null)
      .finally(() => pending.delete(repo))
    pending.set(repo, p)
  }
  return p
}

/** The header's repo link: hovering or focusing it pops a pixel tag with the star count under it. */
export function initRepoStars(link: HTMLAnchorElement, repo: string) {
  const tag = document.createElement('span')
  tag.className = 'gh-stars pix'
  tag.setAttribute('aria-hidden', 'true')
  link.append(tag)
  let stars: number | null | undefined
  const paint = () => {
    tag.textContent = stars === undefined ? '★ …' : stars === null ? t('gh.stars.unknown') : t('gh.stars', { n: formatInt(stars) })
  }
  const show = () => {
    link.classList.add('is-open')
    if (stars !== undefined) return
    paint()
    fetchStars(repo).then((n) => {
      stars = n
      paint()
      if (n !== null && link.classList.contains('is-open')) sound.tick(2200, 0.012)
    })
  }
  const hide = () => link.classList.remove('is-open')
  link.addEventListener('pointerenter', show)
  link.addEventListener('focus', show)
  link.addEventListener('pointerleave', hide)
  link.addEventListener('blur', hide)
  onLocaleChange(() => {
    if (stars !== undefined) paint()
  })
}
