import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { defineConfig } from 'vite'
import { applyMessages } from './src/i18n/dom.ts'
import { LOCALES, type Locale } from './src/i18n/locales.ts'

export default defineConfig({
  plugins: [
    {
      name: 'locale-preview-paths',
      apply: 'serve',
      configurePreviewServer(server) {
        // Preview's SPA fallback would otherwise serve the Chinese entry at /en.
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const locale = Object.values(LOCALES).find((item) => item.path !== '/' && `${url.pathname}/` === item.path)
          if (!locale) return next()
          res.writeHead(308, { Location: locale.path + url.search })
          res.end()
        })
      },
    },
    {
      name: 'prerender-locales',
      apply: 'build',
      async writeBundle(options) {
        const out = resolve(options.dir ?? 'dist')
        const source = await readFile(resolve(out, 'index.html'), 'utf8')
        for (const locale of Object.keys(LOCALES) as Locale[]) {
          const { document } = parseHTML(source)
          const inline = [...document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]')].map((el) => ({
            el,
            text: el.textContent,
            html: el.innerHTML,
            attrs: (el.getAttribute('data-i18n-attr') ?? '')
              .split(';')
              .filter((s) => s.trim())
              .map((s) => {
                const [attr, key] = s.split(':').map((part) => part.trim())
                return { attr, key, value: el.getAttribute(attr) }
              }),
          }))
          applyMessages(document, locale)
          if (locale === 'zh-CN') {
            for (const { el, text, html, attrs } of inline) {
              if (el.hasAttribute('data-i18n') && text !== el.textContent) this.warn(`Inline text differs: ${el.getAttribute('data-i18n')}`)
              if (el.hasAttribute('data-i18n-html') && html !== el.innerHTML) this.warn(`Inline HTML differs: ${el.getAttribute('data-i18n-html')}`)
              for (const { attr, key, value } of attrs) if (value !== el.getAttribute(attr)) this.warn(`Inline ${attr} differs: ${key}`)
            }
          }
          const dir = resolve(out, `.${LOCALES[locale].path}`)
          await mkdir(dir, { recursive: true })
          await writeFile(resolve(dir, 'index.html'), document.toString())
        }
      },
    },
  ],
})
