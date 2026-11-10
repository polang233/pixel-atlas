# Pixel Atlas · 像素星图

**1.4 million pixel-art sprites, mapped into a world you can explore.**
*Every pixel a star.*

Pixel Atlas lays out every 16×16 sprite of [Angais/pixel-art-atlas-1.4m](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m) on one zoomable map, sorted by colour, so you can fly from orbit down to a single sprite. Around it are themed worlds with small playable retro games and short pieces on pixel art: colour depth, palettes, squash and stretch.

Status: work in progress. Site: <https://pixelatlas.org> (not live yet).

> Pixel Atlas is an independent project. It is not made by, or affiliated with, the author of the original dataset.

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
