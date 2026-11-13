/**
 * Tiny Chinese → English query helper. The dataset subjects are English;
 * this covers the common game-asset words so 中文搜索 works in the prototype.
 */

export interface ColorWord {
  label: string
  en: string
  rgb: [number, number, number]
  /** hue range in degrees (wraps when h[0] > h[1]) */
  h: [number, number]
  /** lightness range 0..1 */
  l: [number, number]
  grey?: boolean
}

const C = (label: string, en: string, rgb: [number, number, number], h: [number, number], l: [number, number] = [0.12, 0.9], grey = false): ColorWord => ({
  label,
  en,
  rgb,
  h,
  l,
  grey,
})

const COLORS: Record<string, ColorWord> = {
  红: C('红色', 'red', [220, 40, 50], [345, 14]),
  橙: C('橙色', 'orange', [240, 130, 40], [14, 38]),
  黄: C('黄色', 'yellow', [240, 210, 60], [42, 66]),
  金: C('金色', 'gold', [230, 180, 60], [36, 56], [0.3, 0.8]),
  绿: C('绿色', 'green', [70, 190, 80], [70, 165]),
  青: C('青色', 'cyan', [40, 190, 200], [165, 200]),
  蓝: C('蓝色', 'blue', [60, 100, 230], [200, 255]),
  紫: C('紫色', 'purple', [150, 70, 220], [255, 300]),
  粉: C('粉色', 'pink', [250, 130, 190], [300, 350], [0.5, 0.92]),
  棕: C('棕色', 'brown', [130, 85, 50], [14, 45], [0.12, 0.45]),
  白: C('白色', 'white', [240, 240, 240], [0, 360], [0.78, 1], true),
  黑: C('黑色', 'black', [24, 22, 30], [0, 360], [0, 0.22], true),
  灰: C('灰色', 'grey', [128, 128, 128], [0, 360], [0.25, 0.75], true),
  银: C('银色', 'silver', [190, 195, 205], [0, 360], [0.55, 0.88], true),
}
const EN_COLORS: Record<string, string> = {
  red: '红',
  orange: '橙',
  yellow: '黄',
  gold: '金',
  golden: '金',
  green: '绿',
  cyan: '青',
  teal: '青',
  blue: '蓝',
  purple: '紫',
  violet: '紫',
  pink: '粉',
  brown: '棕',
  white: '白',
  black: '黑',
  grey: '灰',
  gray: '灰',
  silver: '银',
}

/** zh term → english words (matched against subject words) */
const DICT: Record<string, string> = {
  史莱姆: 'slime',
  粘液怪: 'slime',
  宝箱: 'chest',
  箱子: 'chest',
  宝藏: 'treasure',
  金币: 'coin',
  硬币: 'coin',
  钱袋: 'coin pouch',
  宝石: 'gem',
  钻石: 'diamond',
  水晶: 'crystal',
  剑: 'sword',
  刀: 'knife',
  匕首: 'dagger',
  斧: 'axe',
  斧头: 'axe',
  锤: 'hammer',
  弓: 'bow',
  箭: 'arrow',
  盾: 'shield',
  盾牌: 'shield',
  头盔: 'helmet',
  盔甲: 'armor',
  铠甲: 'armor',
  法杖: 'staff',
  魔杖: 'wand',
  长矛: 'spear',
  枪: 'gun',
  炸弹: 'bomb',
  火箭: 'rocket',
  药水: 'potion',
  药瓶: 'potion',
  卷轴: 'scroll',
  书: 'book',
  魔法书: 'tome',
  钥匙: 'key',
  锁: 'lock',
  戒指: 'ring',
  项链: 'necklace',
  护身符: 'amulet',
  王冠: 'crown',
  皇冠: 'crown',
  宝珠: 'orb',
  法球: 'orb',
  火把: 'torch',
  蜡烛: 'candle',
  灯笼: 'lantern',
  灯: 'lamp',
  地图: 'map',
  指南针: 'compass',
  背包: 'backpack',
  绳子: 'rope',
  骷髅: 'skeleton',
  骷髅头: 'skull',
  头骨: 'skull',
  幽灵: 'ghost',
  鬼: 'ghost',
  僵尸: 'zombie',
  吸血鬼: 'vampire',
  恶魔: 'demon',
  魔鬼: 'devil',
  龙: 'dragon',
  巨龙: 'dragon',
  哥布林: 'goblin',
  兽人: 'orc',
  巨人: 'giant',
  巫师: 'wizard',
  法师: 'mage',
  女巫: 'witch',
  骑士: 'knight',
  战士: 'warrior',
  弓箭手: 'archer',
  忍者: 'ninja',
  海盗: 'pirate',
  国王: 'king',
  王后: 'queen',
  公主: 'princess',
  机器人: 'robot',
  外星人: 'alien',
  天使: 'angel',
  精灵: 'elf',
  矮人: 'dwarf',
  蜘蛛: 'spider',
  蝙蝠: 'bat',
  老鼠: 'rat',
  蛇: 'snake',
  狼: 'wolf',
  熊: 'bear',
  猫: 'cat',
  狗: 'dog',
  兔: 'rabbit',
  兔子: 'rabbit',
  狐狸: 'fox',
  鸟: 'bird',
  猫头鹰: 'owl',
  鸡: 'chicken',
  猪: 'pig',
  牛: 'cow',
  马: 'horse',
  羊: 'sheep',
  鱼: 'fish',
  鲨鱼: 'shark',
  鲸: 'whale',
  鲸鱼: 'whale',
  章鱼: 'octopus',
  鱿鱼: 'squid',
  水母: 'jellyfish',
  螃蟹: 'crab',
  虾: 'shrimp',
  海龟: 'sea turtle',
  乌龟: 'turtle',
  海星: 'starfish',
  贝壳: 'shell',
  珊瑚: 'coral',
  海草: 'seaweed',
  海马: 'seahorse',
  青蛙: 'frog',
  蝴蝶: 'butterfly',
  蜜蜂: 'bee',
  甲虫: 'beetle',
  蜗牛: 'snail',
  恐龙: 'dinosaur',
  独角兽: 'unicorn',
  凤凰: 'phoenix',
  狮子: 'lion',
  老虎: 'tiger',
  熊猫: 'panda',
  猴子: 'monkey',
  企鹅: 'penguin',
  鸭: 'duck',
  鸭子: 'duck',
  眼睛: 'eye',
  眼球: 'eye',
  触手: 'tentacle',
  克苏鲁: 'eldritch',
  心: 'heart',
  爱心: 'heart',
  星星: 'star',
  星: 'star',
  月亮: 'moon',
  太阳: 'sun',
  云: 'cloud',
  雨: 'rain',
  雪: 'snow',
  雪人: 'snowman',
  闪电: 'lightning',
  火: 'fire',
  火焰: 'flame',
  冰: 'ice',
  水: 'water',
  树: 'tree',
  花: 'flower',
  玫瑰: 'rose',
  草: 'grass',
  叶子: 'leaf',
  蘑菇: 'mushroom',
  仙人掌: 'cactus',
  石头: 'rock',
  岩石: 'rock',
  矿石: 'ore',
  木头: 'wood',
  木材: 'log',
  苹果: 'apple',
  香蕉: 'banana',
  葡萄: 'grape',
  樱桃: 'cherry',
  草莓: 'strawberry',
  西瓜: 'watermelon',
  橘子: 'tangerine',
  柠檬: 'lemon',
  胡萝卜: 'carrot',
  南瓜: 'pumpkin',
  土豆: 'potato',
  番茄: 'tomato',
  面包: 'bread',
  蛋糕: 'cake',
  饼干: 'cookie',
  甜甜圈: 'donut',
  披萨: 'pizza',
  汉堡: 'burger',
  寿司: 'sushi',
  糖果: 'candy',
  冰淇淋: 'ice cream',
  奶酪: 'cheese',
  肉: 'meat',
  鸡蛋: 'egg',
  蛋: 'egg',
  咖啡: 'coffee',
  茶: 'tea',
  啤酒: 'beer',
  酒: 'wine',
  牛奶: 'milk',
  杯子: 'cup',
  碗: 'bowl',
  房子: 'house',
  城堡: 'castle',
  塔: 'tower',
  门: 'door',
  窗: 'window',
  桥: 'bridge',
  帐篷: 'tent',
  椅子: 'chair',
  桌子: 'table',
  床: 'bed',
  柜子: 'cabinet',
  桶: 'barrel',
  木桶: 'barrel',
  罐子: 'jar',
  花瓶: 'vase',
  镜子: 'mirror',
  时钟: 'clock',
  钟: 'bell',
  车: 'car',
  汽车: 'car',
  自行车: 'bicycle',
  船: 'boat',
  飞机: 'airplane',
  火车: 'train',
  潜艇: 'submarine',
  飞船: 'spaceship',
  锚: 'anchor',
  电脑: 'computer',
  电视: 'tv',
  手机: 'phone',
  游戏机: 'console',
  手柄: 'controller',
  磁带: 'cassette',
  唱片: 'vinyl',
  耳机: 'headphones',
  吉他: 'guitar',
  鼓: 'drum',
  霓虹: 'neon',
  帽子: 'hat',
  衣服: 'shirt',
  鞋: 'boots',
  靴子: 'boots',
  手套: 'gloves',
  披风: 'cloak',
  斗篷: 'cloak',
  面具: 'mask',
  雕像: 'statue',
  图腾: 'totem',
  符文: 'rune',
  祭坛: 'altar',
  棺材: 'coffin',
  墓碑: 'tombstone',
  蜘蛛网: 'web',
  传送门: 'portal',
  陷阱: 'trap',
  宝箱怪: 'mimic',
  礼物: 'gift',
  圣诞: 'christmas',
  万圣节: 'halloween',
}

const ZH_TERMS = Object.keys(DICT).sort((a, b) => b.length - a.length)
const ZH_COLORS = Object.keys(COLORS)

export function translateQuery(q: string): { english: string; color: ColorWord | null } {
  let color: ColorWord | null = null
  let s = q
  // dictionary words first so 金币 doesn't become 金 + 币
  const parts: string[] = []
  let rest = ''
  for (let i = 0; i < s.length; ) {
    const term = ZH_TERMS.find((t) => s.startsWith(t, i))
    if (term) {
      parts.push(DICT[term])
      rest += ' '
      i += term.length
      continue
    }
    const ch = s[i]
    if (ZH_COLORS.includes(ch)) {
      color = COLORS[ch]
      i += s[i + 1] === '色' ? 2 : 1
      rest += ' '
      continue
    }
    rest += ch
    i++
  }
  s = `${parts.join(' ')} ${rest.replace(/[　-〿＀-￯]/g, ' ')}`
  let words = s.split(/\s+/).filter((w) => w && !/[一-鿿]/.test(w))
  const colorIdx = words.findIndex((w) => EN_COLORS[w])
  if (colorIdx >= 0 && !color && words.length > 1) {
    color = COLORS[EN_COLORS[words[colorIdx]]]
    words = words.filter((_, i) => i !== colorIdx)
  } else if (colorIdx >= 0 && words.length === 1) {
    color = COLORS[EN_COLORS[words[0]]]
    words = []
  }
  return { english: words.join(' '), color }
}

/** best-effort Chinese label for a subject, for display */
const REVERSE = new Map<string, string>()
for (const [zh, en] of Object.entries(DICT)) if (!REVERSE.has(en)) REVERSE.set(en, zh)
export function zhLabel(subject: string): string {
  const exact = REVERSE.get(subject)
  if (exact) return exact
  const last = subject.split(' ').pop()!
  return REVERSE.get(last) ?? ''
}
