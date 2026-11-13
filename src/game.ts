/**
 * Shared shell for the mini games inside the world chapters: a start button
 * in the chapter copy, a score bar while playing, a result card at the end,
 * and the best score per game kept in localStorage (when it is available).
 */

import { sound } from './audio'
import { formatInt, getLocale, onLocaleChange, t } from './i18n'
import { applyMessages } from './i18n/dom'
import type { AmbienceName } from './types'

export interface GameHooks {
  /** reset and start a round */
  start(): void
  /** leave play mode (back to the showcase) */
  stop(): void
  /** music while playing; the chapter ambience comes back afterwards */
  ambience?: AmbienceName
  base?: AmbienceName
}

const read = (k: string) => {
  try {
    return Number(localStorage.getItem(k)) || 0
  } catch {
    return 0
  }
}
const write = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v))
  } catch {
    /* storage blocked: best score lasts for this visit only */
  }
}

export class GameShell {
  playing = false
  private over = false
  private el: HTMLElement
  private hooks: GameHooks
  private key: string
  private best: number
  private hud: HTMLElement
  private scoreEl: HTMLElement
  private bestEl: HTMLElement
  private extraEl: HTMLElement
  private card: HTMLElement
  private title: () => string
  private scoreValue = 0
  private extraCopy = () => ''
  private extraIsHtml = false
  private result: { score: number; title: () => string; sub: () => string; record: boolean; won: boolean } | null = null

  constructor(el: HTMLElement, id: string, title: () => string, hooks: GameHooks) {
    this.title = title
    this.el = el
    this.hooks = hooks
    this.key = `pixel-atlas:best:${id}`
    this.best = read(this.key)
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="game-hud pix" hidden>
        <span class="g-title"></span>
        <span><span data-i18n="game.score"></span> <b class="g-score">0</b></span>
        <span><span data-i18n="game.best"></span> <b class="g-best">${this.best}</b></span>
        <span class="g-extra"></span>
        <button type="button" class="chip g-quit" data-i18n-html="game.quitHtml"></button>
      </div>
      <div class="game-card" hidden>
        <div class="game-card-box">
          <p class="eyebrow pix g-kind"></p>
          <h3 class="pix g-res"></h3>
          <p class="g-sub"></p>
          <div class="g-btns">
            <button type="button" class="chip hot g-again" data-i18n-html="game.againHtml"></button>
            <button type="button" class="chip g-exit" data-i18n="game.exit"></button>
          </div>
        </div>
      </div>`,
    )
    const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!
    this.hud = q('.game-hud')
    this.scoreEl = q('.g-score')
    this.bestEl = q('.g-best')
    this.extraEl = q('.g-extra')
    this.card = q('.game-card')
    applyMessages(el, getLocale())
    onLocaleChange(() => this.renderText())
    this.renderText()
    el.querySelectorAll<HTMLButtonElement>('.game-start').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.begin()
      })
    })
    q('.g-quit').addEventListener('click', () => this.quit())
    q('.g-again').addEventListener('click', () => this.begin())
    q('.g-exit').addEventListener('click', () => this.quit())
    window.addEventListener('keydown', (e) => {
      if (!this.playing || !el.classList.contains('is-active')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        this.quit()
      } else if (this.over && (e.key === 'r' || e.key === 'R' || e.key === 'Enter')) {
        e.preventDefault()
        this.begin()
      }
    })
  }

  begin() {
    this.playing = true
    this.over = false
    this.result = null
    this.el.classList.add('is-playing')
    document.body.classList.add('is-playing-game')
    this.hud.hidden = false
    this.card.hidden = true
    this.score(0)
    this.extra(() => '')
    sound.select()
    if (this.hooks.ambience) sound.ambience(this.hooks.ambience)
    this.hooks.start()
  }

  score(n: number) {
    this.scoreValue = n
    this.scoreEl.textContent = formatInt(n)
  }

  extra(copy: () => string, html = false) {
    this.extraCopy = copy
    this.extraIsHtml = html
    if (html) this.extraEl.innerHTML = copy()
    else this.extraEl.textContent = copy()
  }

  private renderText() {
    this.hud.querySelector('.g-title')!.textContent = this.title()
    this.scoreEl.textContent = formatInt(this.scoreValue)
    this.bestEl.textContent = formatInt(this.best)
    this.extra(this.extraCopy, this.extraIsHtml)
    if (!this.result) return
    const { score, title, sub, record, won } = this.result
    this.card.querySelector('.g-kind')!.textContent = won ? t('game.clear') : t('game.over')
    this.card.querySelector('.g-res')!.textContent = title()
    const detail = this.card.querySelector('.g-sub')!
    const points = document.createElement('span')
    points.innerHTML = t('game.pointsHtml', { score: formatInt(score) })
    detail.replaceChildren(
      sub(),
      document.createElement('br'),
      points,
      record && score > 0 ? t('game.record') : t('game.bestScore', { score: formatInt(this.best) }),
    )
  }

  /** a round ended: show the result card (play mode stays on underneath) */
  end(score: number, title: () => string, sub: () => string, won = false) {
    if (this.over) return
    this.over = true
    const record = score > this.best
    if (record) {
      this.best = score
      write(this.key, score)
      this.bestEl.textContent = String(score)
    }
    this.result = { score, title, sub, record, won }
    this.renderText()
    this.card.hidden = false
    this.card.querySelector<HTMLButtonElement>('.g-again')!.focus()
    if (won) sound.win()
    else sound.over()
  }

  get ended() {
    return this.over
  }

  quit() {
    if (!this.playing) return
    this.playing = false
    this.over = false
    this.el.classList.remove('is-playing')
    document.body.classList.remove('is-playing-game')
    this.hud.hidden = true
    this.card.hidden = true
    sound.click()
    if (this.hooks.base) sound.ambience(this.hooks.base)
    this.hooks.stop()
  }
}
