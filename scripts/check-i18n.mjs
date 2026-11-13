// Keeps UI copy in the message dictionaries: run with `npm run check:i18n` (also part of `npm run ci`).
//
// 1. No CJK text in TypeScript outside src/i18n/messages/ and the Chinese search helper.
//    Comments are code too and stay in English.
// 2. Every piece of Chinese in index.html is bound to a message with data-i18n*.
// 3. The English dictionary contains no CJK, except the brand name in the share title.
import { readdir, readFile } from 'node:fs/promises'
import { parseHTML } from 'linkedom'

const CJK = /[㐀-鿿　-〿＀-￯]/u
const ALLOWED_TS = new Set(['src/search-zh.ts'])
const ALLOWED_EN = { 'meta.shareTitle': '像素星图' }
const TRANSLATED_ATTRS = ['title', 'aria-label', 'alt', 'placeholder', 'content', 'data-q', 'data-src', 'data-text', 'data-drop-hint']

let problems = 0
const report = (where, what) => {
  console.error(`${where}: ${what}`)
  problems++
}

async function* tsFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (path !== 'src/i18n/messages') yield* tsFiles(path)
    } else if (path.endsWith('.ts') && !ALLOWED_TS.has(path)) yield path
  }
}
for await (const path of tsFiles('src')) {
  const lines = (await readFile(path, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    if (CJK.test(line)) report(`${path}:${i + 1}`, 'Chinese text belongs in src/i18n/messages/ (comments are written in English).')
  })
}

const { document } = parseHTML(await readFile('index.html', 'utf8'))
for (const el of document.querySelectorAll('*')) {
  if (el.localName === 'script' || el.localName === 'style') continue
  const tag = `<${el.localName}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}>`
  const ownText = [...el.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join('')
  if (CJK.test(ownText) && !el.closest('[data-i18n-html]') && !el.hasAttribute('data-i18n')) report('index.html', `${tag} needs data-i18n or data-i18n-html.`)
  const bound = new Set((el.getAttribute('data-i18n-attr') ?? '').split(';').map((pair) => pair.split(':')[0].trim()))
  for (const attr of TRANSLATED_ATTRS) {
    if (CJK.test(el.getAttribute(attr) ?? '') && !bound.has(attr)) report('index.html', `${tag} needs data-i18n-attr="${attr}:key".`)
  }
}

let key = ''
const english = (await readFile('src/i18n/messages/en.ts', 'utf8')).split('\n')
english.forEach((line, i) => {
  key = line.match(/^\s*'([^']+)':/)?.[1] ?? key
  const rest = ALLOWED_EN[key] ? line.replace(ALLOWED_EN[key], '') : line
  if (CJK.test(rest)) report(`src/i18n/messages/en.ts:${i + 1}`, `Chinese text in English message ${key}.`)
})

if (problems) process.exitCode = 1
else console.log('i18n check passed.')
