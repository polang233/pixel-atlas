export type TransitionKind = 'dither' | 'slash' | 'crt' | 'iris' | 'wave' | 'glitch' | 'melt' | 'fade'

export type AmbienceName = 'space' | 'crt' | 'cart' | 'dungeon' | 'ocean' | 'neon' | 'cthulhu' | 'outro' | 'workshop' | 'depth'

export interface Chapter {
  id: string
  num: string
  title: string
  /** colour the transition paints with while this chapter comes in */
  color: string
  /** transition used when this chapter is entered */
  transition: TransitionKind
  /** background sound loop while the chapter is active */
  ambience?: AmbienceName
  el: HTMLElement
  /**
   * Scroll input inside the chapter. Positive = forward.
   * Return true while the chapter still wants input in that direction;
   * false when it is at its end (or start) so navigation may move on.
   */
  consume?(delta: number): boolean
  /** called once the chapter is visible; dir = 1 forward, -1 backward */
  enter?(dir: 1 | -1): void
  leave?(): void
  focusSearch?(): void
  /** true while a mini game owns the keyboard and scroll */
  playing?(): boolean
}

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
