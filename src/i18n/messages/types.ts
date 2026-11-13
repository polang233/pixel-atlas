import type { zh } from './zh-CN.ts'

export type MessagesShape = Record<string, string | ((p: never) => string)>
export type MessageKey = keyof typeof zh
type Names<S extends string> = S extends `${string}{${infer Name}}${infer Tail}` ? Name | Names<Tail> : never
type Params<V> = V extends string ? Record<Names<V>, string | number> : V extends (p: infer P) => string ? P : never
export type MessageParams<K extends MessageKey> = Params<(typeof zh)[K]>
export type MessageArgs<K extends MessageKey> = keyof MessageParams<K> extends never ? [] : [params: MessageParams<K>]
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// Infer literal translations first, then compare placeholder names and function parameters.
export function defineMessages<const M extends Record<MessageKey, string | ((p: never) => string)>>(
  messages: M & { [K in keyof M]: K extends MessageKey ? (Same<Params<M[K]>, MessageParams<K>> extends true ? M[K] : never) : never },
): M {
  return messages
}
