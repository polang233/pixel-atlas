/**
 * The Toolbox: pixel-art tools and resources from the community.
 *
 * To add one, append an entry here and its description to both message files
 * (`toolbox.item.<id>` in src/i18n/messages). Suggestions arrive through the
 * "Tool suggestion" issue form. Rules of the list:
 *   - commercial tools are welcome, and always show what they cost;
 *   - `aiAssisted` is set only where the creator says AI was involved;
 *   - `checked` is the day someone last confirmed the link, price and description.
 */
import type { MessageKey } from '../i18n'

export type ToolCategory = 'agent' | 'tools' | 'assets'

/** every message the toolbox uses; descriptions and price labels take no parameters */
export type ToolboxKey = Extract<MessageKey, `toolbox.${string}`>

export type PriceKind = 'free' | 'open' | 'paid' | 'mixed'

export interface ToolPrice {
  /** free to use / open source / costs money / some of each */
  kind: PriceKind
  /** what the card says, e.g. "Subscription · from about $12/month" */
  label: Extract<ToolboxKey, `toolbox.price.${string}`>
  /** SPDX id of the licence, for open-source tools */
  licence?: string
}

export interface ToolLink {
  label: Extract<ToolboxKey, `toolbox.link.${string}`>
  url: string
}

export interface ToolExample {
  name: string
  url: string
  desc: ToolboxKey
  /** a post on X by the creator or about the work */
  xPost?: string
  aiAssisted?: boolean
}

export interface ToolItem {
  id: string
  /** as its makers write it; never translated */
  name: string
  url: string
  category: ToolCategory
  desc: Extract<ToolboxKey, `toolbox.item.${string}`>
  price: ToolPrice
  /** GitHub `owner/name`; star counts hang off this */
  repo?: `${string}/${string}`
  /** a post on X by the author or about the tool */
  xPost?: string
  /** more places worth a click, e.g. a gallery */
  links?: ToolLink[]
  /** one thing found there that is worth showing */
  example?: ToolExample
  aiAssisted?: boolean
  /** shown as a large card at the top; `demo` names the live demo it carries */
  featured?: { demo: 'forge' | 'fx' | 'snap' }
  /** ISO date the entry was last verified */
  checked: string
}

export const CATEGORIES: ToolCategory[] = ['agent', 'tools', 'assets']

const CHECKED = '2026-11-16'

export const TOOLBOX: ToolItem[] = [
  // ---- Agent / AI workflows ----
  {
    id: 'agent-sprite-forge',
    name: 'agent-sprite-forge',
    url: 'https://github.com/0x0funky/agent-sprite-forge',
    category: 'agent',
    desc: 'toolbox.item.agent-sprite-forge',
    price: { kind: 'open', label: 'toolbox.price.open', licence: 'MIT' },
    repo: '0x0funky/agent-sprite-forge',
    links: [{ label: 'toolbox.link.author', url: 'https://x.com/0x0funky' }],
    featured: { demo: 'forge' },
    checked: CHECKED,
  },
  {
    id: 'pixelfx',
    name: 'pixelfx',
    url: 'https://github.com/patch-gg/pixelfx',
    category: 'agent',
    desc: 'toolbox.item.pixelfx',
    price: { kind: 'open', label: 'toolbox.price.open', licence: 'MIT' },
    repo: 'patch-gg/pixelfx',
    xPost: 'https://x.com/rehan_shei/status/2116062680121540611',
    links: [{ label: 'toolbox.link.gallery', url: 'https://patch-gg.github.io/pixelfx' }],
    featured: { demo: 'fx' },
    checked: CHECKED,
  },
  {
    id: 'aseprite-ai-artist',
    name: 'Aseprite AI Artist',
    url: 'https://github.com/with-pebbly/aseprite-ai-artist',
    category: 'agent',
    desc: 'toolbox.item.aseprite-ai-artist',
    price: { kind: 'open', label: 'toolbox.price.open', licence: 'MIT' },
    repo: 'with-pebbly/aseprite-ai-artist',
    checked: CHECKED,
  },
  {
    id: 'pixellab',
    name: 'PixelLab',
    url: 'https://www.pixellab.ai/mcp',
    category: 'agent',
    desc: 'toolbox.item.pixellab',
    price: { kind: 'paid', label: 'toolbox.price.pixellab' },
    checked: CHECKED,
  },
  {
    id: 'retro-diffusion',
    name: 'Retro Diffusion',
    url: 'https://www.retrodiffusion.ai',
    category: 'agent',
    desc: 'toolbox.item.retro-diffusion',
    price: { kind: 'paid', label: 'toolbox.price.retro-diffusion' },
    checked: CHECKED,
  },
  {
    id: 'spritecook',
    name: 'SpriteCook',
    url: 'https://spritecook.ai',
    category: 'agent',
    desc: 'toolbox.item.spritecook',
    price: { kind: 'paid', label: 'toolbox.price.spritecook' },
    checked: CHECKED,
  },

  // ---- Tools ----
  {
    id: 'pixel-snapper',
    name: 'Sprite Fusion Pixel Snapper',
    url: 'https://spritefusion.com/pixel-snapper',
    category: 'tools',
    desc: 'toolbox.item.pixel-snapper',
    price: { kind: 'open', label: 'toolbox.price.openFreeWeb', licence: 'MIT' },
    repo: 'Hugo-Dz/spritefusion-pixel-snapper',
    featured: { demo: 'snap' },
    checked: CHECKED,
  },
  {
    id: 'unfake',
    name: 'unfake.js',
    url: 'https://github.com/jenissimo/unfake.js',
    category: 'tools',
    desc: 'toolbox.item.unfake',
    price: { kind: 'open', label: 'toolbox.price.open', licence: 'MIT' },
    repo: 'jenissimo/unfake.js',
    featured: { demo: 'snap' },
    checked: CHECKED,
  },
  {
    id: 'pixel-art-lighter',
    name: 'Pixel Art Lighter',
    url: 'https://moonfell-rpg.com/pixel-lighter',
    category: 'tools',
    desc: 'toolbox.item.pixel-art-lighter',
    price: { kind: 'open', label: 'toolbox.price.freeOpen', licence: 'MIT' },
    checked: CHECKED,
  },
  {
    id: 'aseprite',
    name: 'Aseprite',
    url: 'https://www.aseprite.org',
    category: 'tools',
    desc: 'toolbox.item.aseprite',
    price: { kind: 'paid', label: 'toolbox.price.aseprite' },
    checked: CHECKED,
  },
  {
    id: 'pixelorama',
    name: 'Pixelorama',
    url: 'https://pixelorama.org',
    category: 'tools',
    desc: 'toolbox.item.pixelorama',
    price: { kind: 'open', label: 'toolbox.price.freeOpen' },
    checked: CHECKED,
  },
  {
    id: 'pixieditor',
    name: 'PixiEditor',
    url: 'https://pixieditor.net',
    category: 'tools',
    desc: 'toolbox.item.pixieditor',
    price: { kind: 'open', label: 'toolbox.price.freeOpen' },
    checked: CHECKED,
  },
  {
    id: 'pixelover',
    name: 'PixelOver',
    url: 'https://pixelover.io',
    category: 'tools',
    desc: 'toolbox.item.pixelover',
    price: { kind: 'paid', label: 'toolbox.price.pixelover' },
    checked: CHECKED,
  },
  {
    id: 'pixel-renderer',
    name: 'Pixel Renderer',
    url: 'https://github.com/bukkbeek/GodotPixelRenderer',
    category: 'tools',
    desc: 'toolbox.item.pixel-renderer',
    price: { kind: 'open', label: 'toolbox.price.open', licence: 'MIT' },
    repo: 'bukkbeek/GodotPixelRenderer',
    checked: CHECKED,
  },
  {
    id: 'pixquare',
    name: 'Pixquare',
    url: 'https://pixquare.art',
    category: 'tools',
    desc: 'toolbox.item.pixquare',
    price: { kind: 'mixed', label: 'toolbox.price.pixquare' },
    checked: CHECKED,
  },

  // ---- Assets & inspiration ----
  {
    id: 'lospec-palettes',
    name: 'Lospec Palette List',
    url: 'https://lospec.com/palette-list',
    category: 'assets',
    desc: 'toolbox.item.lospec-palettes',
    price: { kind: 'free', label: 'toolbox.price.free' },
    checked: CHECKED,
  },
  {
    id: 'spriters-resource',
    name: 'The Spriters Resource',
    url: 'https://www.spriters-resource.com',
    category: 'assets',
    desc: 'toolbox.item.spriters-resource',
    price: { kind: 'free', label: 'toolbox.price.free' },
    checked: CHECKED,
  },
  {
    id: 'pixel-joint',
    name: 'Pixel Joint',
    url: 'https://pixeljoint.com',
    category: 'assets',
    desc: 'toolbox.item.pixel-joint',
    price: { kind: 'free', label: 'toolbox.price.free' },
    checked: CHECKED,
  },
  {
    id: 'itch-pixel-art',
    name: 'itch.io pixel-art assets',
    url: 'https://itch.io/game-assets/tag-pixel-art',
    category: 'assets',
    desc: 'toolbox.item.itch-pixel-art',
    price: { kind: 'mixed', label: 'toolbox.price.itch' },
    example: {
      name: 'Dungeon Critters',
      url: 'https://oddhatch.itch.io/dungeon-critters',
      desc: 'toolbox.example.dungeon-critters',
      xPost: 'https://x.com/oddhatch/status/2121179500457443762',
      aiAssisted: true,
    },
    checked: CHECKED,
  },
  {
    id: 'opengameart',
    name: 'OpenGameArt',
    url: 'https://opengameart.org',
    category: 'assets',
    desc: 'toolbox.item.opengameart',
    price: { kind: 'free', label: 'toolbox.price.opengameart' },
    checked: CHECKED,
  },
]

/** where "Recommend a tool" goes: the issue form in .github/ISSUE_TEMPLATE/tool-suggestion.yml */
export const SUGGEST_URL = 'https://github.com/polang233/pixel-atlas/issues/new?template=tool-suggestion.yml'

/** the most recent check across the list, for the "Checked …" note */
export const LAST_CHECKED =
  TOOLBOX.map((item) => item.checked)
    .sort()
    .at(-1) ?? ''
