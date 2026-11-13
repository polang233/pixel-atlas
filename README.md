<p align="center">
  <img src="docs/readme-banner.png" alt="Pixel Atlas · 像素星图 — Every pixel a star" width="100%" />
</p>

# Pixel Atlas · 像素星图

English · [简体中文](README.zh-CN.md)

<p>
  <a href="https://pixelatlas.org"><img alt="Website: pixelatlas.org" src="https://img.shields.io/badge/site-pixelatlas.org-ffcc4d?labelColor=07060c" /></a>
  <a href="LICENSE"><img alt="Code licence: MPL-2.0" src="https://img.shields.io/badge/code-MPL--2.0-4c8bf5" /></a>
  <a href="#licences"><img alt="Data licence: CC BY 4.0" src="https://img.shields.io/badge/data-CC%20BY%204.0-8a8a8a" /></a>
  <a href="https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m"><img alt="Sprites: Angais/pixel-art-atlas-1.4m on Hugging Face" src="https://img.shields.io/badge/%F0%9F%A4%97%20sprites-pixel--art--atlas--1.4m-ffd21e" /></a>
  <a href="https://x.com/polang233"><img alt="X: @polang233" src="https://img.shields.io/badge/X-%40polang233-000000?logo=x" /></a>
</p>

**Millions of pixel-art resources, in one place.**

It starts with every 16×16 sprite of [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m) laid out on one zoomable map and sorted by colour, so you can fly from orbit down to a single sprite. Around it are themed worlds with small playable retro games and short pieces on pixel art: colour depth, palettes, squash and stretch.

Live at <https://pixelatlas.org> (Chinese) and <https://pixelatlas.org/en/> (English). Still a work in progress.

> Pixel Atlas is an independent project. It is not made by, or affiliated with, the author of the original dataset.

## What is in it

- **The map.** All 1,409,404 sprites on one zoomable world, split into eight lands by average colour. Zoom out and the lands close up into a planet.
- **Search.** Type a subject or a colour, in English or Chinese (`slime`, `蓝色宝箱`, `#ff4d6d`); the matches gather in front of you, and each one can fly you to its home on the map.
- **Worlds.** Themed chapters with small playable retro games and short pieces on pixel-art craft.
- **Workshop.** Try colour depth, lighting, outlines, palette swaps, upscaling, rotation and hit effects on any sprite, or on an image of your own.

## Get the sprites

| How many | How |
|---|---|
| One | Open a sprite on the map and save it at 16×16, or enlarged 16 times. |
| A batch | Search, then press **Download batch**: up to 256 sprites in one sprite sheet, with a `manifest.json` listing each sprite's dataset index, subject and caption. |
| All of them | Straight from [the dataset on Hugging Face](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m): Parquet shards (about 430 MB) or one 259 MB ZIP. |

```python
from datasets import load_dataset
sprites = load_dataset("Angais/pixel-art-atlas-1.4m", split="train")
```

The *dataset index* shown on the site is the sprite's row in the dataset ZIP (`tokens.npy`, `captions.json`, `objects.json`).

Coming next: our additions (the colour layout, search index and Chinese subject names) as a dataset of their own on Hugging Face, a command-line tool and a dsh skill.

## Run it locally

```bash
npm install
npm run dev
```

The streaming atlas under `public/atlas/` (about 340 MB) is not in the repo. Generate it with `pipeline/build_atlas.py`, which reads the Hugging Face dataset; its Python dependencies are in `pipeline/requirements.txt`.

Before sending a change, run `npm run ci`: it checks formatting and lint with [Biome](https://biomejs.dev), type-checks and builds.

## Licences

| What | Licence |
|---|---|
| Code in this repo (site and pipeline) | [MPL-2.0](LICENSE) |
| Data we add on top of the dataset: layout, colour index, translations, sprite sheets | CC BY 4.0 |
| The sprites themselves | CC0, as released by the dataset author, to the extent of the rights they can waive |

The sprites were generated with Krea 2. CC0 does not override the Krea 2 Community License or the Krea Acceptable Use Policy. Some sprites may resemble existing characters or trademarks, so check before using them commercially.

## Credits

- Sprites: [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m)
- Pixel fonts: Fusion Pixel (OFL-1.1, see `public/fonts/OFL-fusion-pixel.txt`), Press Start 2P (OFL-1.1, via Fontsource)

## Citing

If Pixel Atlas helps your work, please cite it. GitHub's "Cite this repository" button reads [`CITATION.cff`](CITATION.cff); the same in BibTeX:

```bibtex
@misc{pixelatlas2026,
  title        = {Pixel Atlas: millions of pixel-art resources, in one place},
  author       = {polang233},
  year         = {2026},
  howpublished = {\url{https://pixelatlas.org}},
  note         = {Source code: \url{https://github.com/polang233/pixel-atlas}}
}
```

Please also credit the sprites' source, [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m).

## Feedback

Bugs and ideas are welcome in [issues](https://github.com/polang233/pixel-atlas/issues). Updates are posted on X: [@polang233](https://x.com/polang233).
