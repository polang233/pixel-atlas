"""Build the streaming atlas, search index and chapter strips.

Usage: python build_atlas.py <extracted-zip-dir> <atlas-out-dir> <data-out-dir> [--strips-only]

Every sprite gets a *cell*: a position on the colour-wheel disc. The cell
index (y * SIDE + x) is the id the website uses everywhere; the original
dataset index is kept in the caption chunks.

atlas-out-dir (large, not committed):
  overview.png        SIDE x SIDE, one texel = average colour of one sprite
  meta.json           layout constants
  l1/<tx>_<ty>.webp   128x128 cells per tile, 4 px per cell (sprites box-filtered)
  l2/<tx>_<ty>.webp   32x32 cells per tile, 16 px per cell (the real sprites)
  cap/<tx>_<ty>.json  per l2 tile: [[origId, subjectIndex, caption] | null] * 1024
  subjects.json       [[subject, count]], sorted by subject
  cells.bin           uint32 cells grouped in the subjects.json order

data-out-dir (small, committed): ch_<name>.png/json sprite strips per chapter.
"""
import json
import multiprocessing as mp
import os
import sys

import numpy as np
from PIL import Image

SRC, ATLAS, DATA = sys.argv[1], sys.argv[2], sys.argv[3]
STRIPS_ONLY = "--strips-only" in sys.argv
L1_CELLS, L2_CELLS = 128, 32

tok = np.load(f"{SRC}/tokens.npy", mmap_mode="r", allow_pickle=False)
pal = np.load(f"{SRC}/palette.npy", allow_pickle=False).astype(np.float32)
pal8 = pal.astype(np.uint8)
N = tok.shape[0]


def rgba_many(ids):
    """(n,) dataset ids -> (n,16,16,4) uint8."""
    p = np.asarray(tok[np.sort(ids)])[np.argsort(np.argsort(ids))].reshape(-1, 16, 16)
    out = np.empty(p.shape + (4,), np.uint8)
    out[..., :3] = pal8[p]
    out[..., 3] = (p != 0) * 255
    return out


# ---- layout -----------------------------------------------------------------
def build_layout():
    avg = np.zeros((N, 3), np.float32)
    for s in range(0, N, 50_000):
        a = np.asarray(tok[s:s + 50_000])
        m = (a != 0).astype(np.float32)
        avg[s:s + len(a)] = (pal[a] * m[..., None]).sum(1) / np.maximum(m.sum(1), 1)[:, None]

    r, g, b = (avg / 255).T
    mx, mn = avg.max(1) / 255, avg.min(1) / 255
    light = (mx + mn) / 2
    chroma = mx - mn
    hue = np.zeros(N, np.float32)
    nz = chroma > 1e-6
    rr, gg, bb, c = r[nz], g[nz], b[nz], chroma[nz]
    h = np.where(mx[nz] == rr, ((gg - bb) / c) % 6, np.where(mx[nz] == gg, (bb - rr) / c + 2, (rr - gg) / c + 4))
    hue[nz] = h / 6
    grey = chroma < 0.08

    side = int(np.ceil(2 * np.sqrt(N / np.pi))) + 4
    yy, xx = np.mgrid[0:side, 0:side]
    cyx = (side - 1) / 2
    rad = np.hypot(yy - cyx, xx - cyx).ravel()
    ang = ((np.arctan2(yy - cyx, xx - cyx).ravel() / (2 * np.pi)) + 1) % 1
    cells = np.argsort(rad, kind="stable")[:N]
    grid = np.full(side * side, -1, np.int64)

    gid = np.where(grey)[0]
    gid = gid[np.argsort(-light[gid], kind="stable")]
    grid[cells[:len(gid)]] = gid
    ring = cells[len(gid):]
    ring = ring[np.argsort(ang[ring], kind="stable")]
    cid = np.where(~grey)[0]
    cid = cid[np.argsort(hue[cid], kind="stable")]
    for rc, sc in zip(np.array_split(ring, 1500), np.array_split(cid, 1500)):
        grid[rc[np.argsort(rad[rc], kind="stable")]] = sc[np.argsort(-light[sc], kind="stable")]
    return side, grid.reshape(side, side), avg


cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "layout.npz")
if os.path.exists(cache):
    z = np.load(cache)
    SIDE, GRID, AVG = int(z["side"]), z["grid"], z["avg"]
else:
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    SIDE, GRID, AVG = build_layout()
    np.savez(cache, side=SIDE, grid=GRID, avg=AVG)
CELL_OF = np.full(N, -1, np.int64)
flat = GRID.ravel()
CELL_OF[flat[flat >= 0]] = np.nonzero(flat >= 0)[0]


# ---- tiles --------------------------------------------------------------------
def tile_block(tx, ty, cells_per_tile):
    sub = GRID[ty * cells_per_tile:(ty + 1) * cells_per_tile, tx * cells_per_tile:(tx + 1) * cells_per_tile]
    full = np.full((cells_per_tile, cells_per_tile), -1, np.int64)
    full[:sub.shape[0], :sub.shape[1]] = sub
    return full


def make_l2(args):
    tx, ty = args
    blk = tile_block(tx, ty, L2_CELLS)
    ok = blk >= 0
    if not ok.any():
        return 0
    img = np.zeros((L2_CELLS, L2_CELLS, 16, 16, 4), np.uint8)
    img[ok] = rgba_many(blk[ok])
    img = img.transpose(0, 2, 1, 3, 4).reshape(L2_CELLS * 16, L2_CELLS * 16, 4)
    path = f"{ATLAS}/l2/{tx}_{ty}.webp"
    Image.fromarray(img).save(path, lossless=True, method=4, exact=True)
    return os.path.getsize(path)


def make_l1(args):
    tx, ty = args
    blk = tile_block(tx, ty, L1_CELLS)
    ok = blk >= 0
    if not ok.any():
        return 0
    spr = np.zeros((L1_CELLS, L1_CELLS, 16, 16, 4), np.float32)
    spr[ok] = rgba_many(blk[ok])
    # premultiplied 4x4 box filter -> 4x4 px per cell
    a = spr[..., 3:] / 255
    pre = np.concatenate([spr[..., :3] * a, a], -1)
    pre = pre.reshape(L1_CELLS, L1_CELLS, 4, 4, 4, 4, 4).mean((3, 5))  # (cy,cx,py,px,4)
    al = pre[..., 3:]
    col = np.where(al > 0, pre[..., :3] / np.maximum(al, 1e-6), 0)
    out = np.concatenate([col, al * 255], -1).round().clip(0, 255).astype(np.uint8)
    out = out.transpose(0, 2, 1, 3, 4).reshape(L1_CELLS * 4, L1_CELLS * 4, 4)
    path = f"{ATLAS}/l1/{tx}_{ty}.webp"
    Image.fromarray(out).save(path, lossless=True, method=4, exact=True)
    return os.path.getsize(path)


def build_tiles():
    os.makedirs(f"{ATLAS}/l1", exist_ok=True)
    os.makedirs(f"{ATLAS}/l2", exist_ok=True)
    n1, n2 = -(-SIDE // L1_CELLS), -(-SIDE // L2_CELLS)
    with mp.get_context("fork").Pool(max(2, os.cpu_count() - 1)) as pool:
        s1 = sum(pool.map(make_l1, [(x, y) for y in range(n1) for x in range(n1)]))
        print(f"l1 {n1}x{n1} tiles, {s1 / 1e6:.1f} MB", flush=True)
        s2 = sum(pool.imap_unordered(make_l2, [(x, y) for y in range(n2) for x in range(n2)], chunksize=8))
        print(f"l2 {n2}x{n2} tiles, {s2 / 1e6:.1f} MB", flush=True)

    ov = np.zeros((SIDE, SIDE, 4), np.uint8)
    valid = GRID >= 0
    ov[valid, :3] = AVG[GRID[valid]].round().astype(np.uint8)
    ov[valid, 3] = 255
    Image.fromarray(ov).save(f"{ATLAS}/overview.png", optimize=True)
    return n1, n2


# ---- captions + search -----------------------------------------------------------
def build_text(n2):
    caps = json.load(open(f"{SRC}/captions.json", encoding="utf-8"))
    objs = json.load(open(f"{SRC}/objects.json", encoding="utf-8"))
    subjects = sorted(set(objs))
    sidx = {s: i for i, s in enumerate(subjects)}
    subj_of = np.array([sidx[s] for s in objs], np.int64)

    os.makedirs(f"{ATLAS}/cap", exist_ok=True)
    for ty in range(n2):
        for tx in range(n2):
            blk = tile_block(tx, ty, L2_CELLS).ravel()
            if (blk < 0).all():
                continue
            rows = [None if i < 0 else [int(i), int(subj_of[i]), caps[i]] for i in blk]
            with open(f"{ATLAS}/cap/{tx}_{ty}.json", "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))

    order = np.argsort(subj_of, kind="stable")
    counts = np.bincount(subj_of, minlength=len(subjects))
    CELL_OF[order].astype(np.uint32).tofile(f"{ATLAS}/cells.bin")
    json.dump([[s, int(n)] for s, n in zip(subjects, counts)],
              open(f"{ATLAS}/subjects.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("subjects", len(subjects))
    return caps, objs


# ---- chapter strips ----------------------------------------------------------------
def build_strips(caps, objs):
    rng = np.random.default_rng(7)
    objs_arr = np.array(objs)
    known = set(objs)

    def pick(subjects, per):
        out = []
        for s in subjects:
            if s not in known:
                print("  missing subject", s)
                continue
            ids = np.where(objs_arr == s)[0]
            out += [int(i) for i in rng.choice(ids, min(per, len(ids)), replace=False)]
        return out

    def strip(name, ids):
        cols = 16
        rows = -(-len(ids) // cols)
        im = np.zeros((rows * 16, cols * 16, 4), np.uint8)
        for k, sp in enumerate(rgba_many(np.array(ids))):
            y, x = divmod(k, cols)
            im[y * 16:(y + 1) * 16, x * 16:(x + 1) * 16] = sp
        Image.fromarray(im).save(f"{DATA}/ch_{name}.png", optimize=True)
        json.dump([{"id": i, "cell": int(CELL_OF[i]), "caption": caps[i], "subject": objs[i]} for i in ids],
                  open(f"{DATA}/ch_{name}.json", "w", encoding="utf-8"), ensure_ascii=False)
        print(" strip", name, len(ids))

    os.makedirs(DATA, exist_ok=True)
    strip("depth", pick(["potion bottle", "treasure chest", "slime", "crown", "magic orb", "torch",
                         "crystal cluster", "heart icon", "lantern", "skull crown", "spirit orb",
                         "king slime", "coin", "candle", "glowcap mushroom", "tome"], 3))
    strip("crt", pick(["slime", "king slime", "knight", "goblin", "dragon", "coin", "heart icon",
                       "treasure chest", "short sword", "potion bottle", "dungeon key", "toadstool",
                       "cave bat", "ghost", "wizard", "skeleton", "star", "castle"], 3))
    strip("workshop", pick(["apple", "magic orb", "potion bottle", "slime", "crystal cluster", "heart crystal",
                            "golden apple", "ice orb", "knight helmet", "round shield", "fly agaric",
                            "cherry", "round bomb", "crown", "lantern", "cat", "ghost", "egg"], 2))
    strip("dungeon", pick(["treasure chest", "mimic chest", "torch", "wall sconce torch", "skeleton",
                           "skeleton warrior", "dungeon key", "skeleton key", "potion vial", "candle",
                           "lantern", "barrel", "giant spider", "spider web", "dire rat", "coin",
                           "cellar door", "skull key", "floating skull", "skull idol"], 4))
    strip("ocean", pick(["blue tang fish", "clownfish", "pufferfish", "seahorse", "jellyfish", "ghost jellyfish",
                         "octopus", "dumbo octopus", "sea turtle", "starfish", "hermit crab", "reef shark",
                         "hammerhead shark", "sperm whale", "anchor", "submarine", "deep sea diver",
                         "brain coral", "staghorn coral", "seaweed strand", "clam shell", "pearl",
                         "sea urchin", "anglerfish", "water bubble", "treasure chest"], 3))
    strip("neon", pick(["neon tube", "arcade cabinet", "cassette tape", "retro tv set", "joystick",
                        "game controller", "floppy disk", "headphones", "vinyl record", "electric guitar",
                        "cybernetic eye", "robot head", "lightning bolt", "ringed planet", "rocket", "heart",
                        "star", "cat", "cup of coffee", "cherry", "flip phone", "crt monitor", "cocktail glass",
                        "crystal skull", "diamond", "chocolate heart", "vampire bat", "humanoid robot", "cyborg ninja"], 2))
    strip("cthulhu", pick(["eldritch tome", "tentacled eye", "kraken tentacle", "tentacle monster",
                           "octopus", "vampire squid", "giant squid", "eye orb", "eye amulet",
                           "void orb", "summoning tome", "serpent idol", "rune obelisk", "holed rune stone",
                           "candle", "shadow tome", "skull idol"], 4))


if __name__ == "__main__":
    if STRIPS_ONLY:
        caps = json.load(open(f"{SRC}/captions.json", encoding="utf-8"))
        objs = json.load(open(f"{SRC}/objects.json", encoding="utf-8"))
        build_strips(caps, objs)
        sys.exit()
    n1, n2 = build_tiles()
    json.dump({"side": SIDE, "count": N, "l1": {"cells": L1_CELLS, "px": 4, "tiles": n1},
               "l2": {"cells": L2_CELLS, "px": 16, "tiles": n2}},
              open(f"{ATLAS}/meta.json", "w"), indent=1)
    caps, objs = build_text(n2)
    build_strips(caps, objs)
