<p align="center">
  <img src="docs/readme-banner.png" alt="Pixel Atlas · 像素星图 — Every pixel a star" width="100%" />
</p>

# Pixel Atlas · 像素星图

**Millions of pixel-art resources, in one place.**

It starts with every 16×16 sprite of [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m) laid out on one zoomable map and sorted by colour, so you can fly from orbit down to a single sprite. Around it are themed worlds with small playable retro games and short pieces on pixel art: colour depth, palettes, squash and stretch.

Live at <https://pixelatlas.org>. Still a work in progress.

> Pixel Atlas is an independent project. It is not made by, or affiliated with, the author of the original dataset.

## What is in it

- **The map.** All 1,409,404 sprites on one zoomable world, split into eight lands by average colour. Zoom out and the lands close up into a planet.
- **Search.** Type a subject or a colour, in English or Chinese (`slime`, `蓝色宝箱`, `#ff4d6d`); the matches gather in front of you, and each one can fly you to its home on the map.
- **Worlds.** Themed chapters with small playable retro games and short pieces on pixel-art craft.

## Run it locally

```bash
npm install
npm run dev
```

The streaming atlas under `public/atlas/` (about 340 MB) is not in the repo. Generate it with `pipeline/build_atlas.py`, which reads the Hugging Face dataset.

## Licences

| What | Licence |
|---|---|
| Code in this repo (site and pipeline) | [MPL-2.0](LICENSE) |
| Data we add on top of the dataset: layout, colour index, translations, sprite sheets | CC BY 4.0 |
| The sprites themselves | CC0, as released by the dataset author, to the extent of the rights they can waive |

The sprites were generated with Krea 2. CC0 does not override the Krea 2 Community License or the Krea Acceptable Use Policy. Some sprites may resemble existing characters or trademarks, so check before using them commercially.

## Credits

- Sprites: [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m)
- Pixel fonts: Fusion Pixel (OFL-1.1, see `public/fonts/OFL-fusion-pixel.txt`), Press Start 2P and Silkscreen (OFL-1.1, via Fontsource)

## Feedback

Bugs and ideas are welcome in [issues](https://github.com/polang233/pixel-atlas/issues). Updates are posted on X: [@polang233](https://x.com/polang233).
