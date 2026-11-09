"""Build prototype assets from the Pixel Art Atlas zip contents.

Usage: python build_proto.py <extracted-zip-dir> <out-dir>

Outputs:
  overview.png   SIDE x SIDE image, one texel = average colour of one sprite,
                 laid out by hue (x) and lightness (y).
  detail.png     WINDOW x WINDOW real sprites around the zoom target (16px each).
  mosaic.json    layout metadata (side, window origin, target cell, captions).
  ch_<name>.png  sprite strips for each chapter + ch_<name>.json captions.
"""
import json
import sys

import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
WINDOW = 96  # real sprites around the target
rng = np.random.default_rng(7)

tok = np.load(f"{SRC}/tokens.npy", mmap_mode="r", allow_pickle=False)
pal = np.load(f"{SRC}/palette.npy", allow_pickle=False).astype(np.float32)
caps = json.load(open(f"{SRC}/captions.json", encoding="utf-8"))
objs = json.load(open(f"{SRC}/objects.json", encoding="utf-8"))
N = tok.shape[0]


def rgba(i):
    p = np.asarray(tok[i]).reshape(16, 16)
    return np.dstack((pal[p].astype(np.uint8), (p != 0).astype(np.uint8) * 255))


# ---- average colour per sprite --------------------------------------------
avg = np.zeros((N, 3), np.float32)
for s in range(0, N, 50_000):
    a = np.asarray(tok[s:s + 50_000])
    m = (a != 0).astype(np.float32)
    col = pal[a]  # (n,256,3)
    avg[s:s + len(a)] = (col * m[..., None]).sum(1) / np.maximum(m.sum(1), 1)[:, None]

r, g, b = (avg / 255).T
mx, mn = avg.max(1) / 255, avg.min(1) / 255
light = (mx + mn) / 2
chroma = mx - mn
hue = np.zeros(N, np.float32)
nz = chroma > 1e-6
rr, gg, bb = r[nz], g[nz], b[nz]
c = chroma[nz]
h = np.where(mx[nz] == rr, ((gg - bb) / c) % 6, np.where(mx[nz] == gg, (bb - rr) / c + 2, (rr - gg) / c + 4))
hue[nz] = h / 6
grey = chroma < 0.08

# ---- colour-wheel layout ---------------------------------------------------
# The N cells closest to the centre form a disc; greys fill the core
# (bright in the middle), coloured sprites wrap around by hue, with
# lighter sprites nearer the core.
SIDE = int(np.ceil(2 * np.sqrt(N / np.pi))) + 4
yy, xx = np.mgrid[0:SIDE, 0:SIDE]
cyx = (SIDE - 1) / 2
rad = np.hypot(yy - cyx, xx - cyx).ravel()
ang = ((np.arctan2(yy - cyx, xx - cyx).ravel() / (2 * np.pi)) + 1) % 1
cells = np.argsort(rad, kind="stable")[:N]
grid = np.full(SIDE * SIDE, -1, np.int64)

gid = np.where(grey)[0]
gid = gid[np.argsort(-light[gid], kind="stable")]
core = cells[:len(gid)]
grid[core] = gid

ring = cells[len(gid):]
ring = ring[np.argsort(ang[ring], kind="stable")]
cid = np.where(~grey)[0]
cid = cid[np.argsort(hue[cid], kind="stable")]
K = 1500
for rc, sc in zip(np.array_split(ring, K), np.array_split(cid, K)):
    rc = rc[np.argsort(rad[rc], kind="stable")]
    sc = sc[np.argsort(-light[sc], kind="stable")]
    grid[rc] = sc
grid = grid.reshape(SIDE, SIDE)

ov = np.zeros((SIDE, SIDE, 4), np.uint8)
valid = grid >= 0
ov[valid, :3] = avg[grid[valid]].astype(np.uint8)
ov[valid, 3] = 255
Image.fromarray(ov).save(f"{OUT}/overview.png", optimize=True)

# ---- detail window around a striking target ---------------------------------
showy = {"magic orb", "crystal shard", "potion bottle", "treasure chest", "crystal cluster",
         "slime", "king slime", "spirit orb", "heart crystal", "power crystal", "ice orb",
         "crystal slime", "void orb", "potion vial"}
R = rad[cells[-1]]
t_ang = None
gr = grid.ravel()
cand = [c for c in ring if 0.6 < hue[gr[c]] < 0.66 and 0.55 * R < rad[c] < 0.7 * R]
mid = cand[len(cand) // 2]
cy, cx = divmod(int(mid), SIDE)
best = None
for dy in range(-40, 41):
    for dx in range(-40, 41):
        i = grid[cy + dy, cx + dx]
        if i >= 0 and objs[i] in showy:
            d = dy * dy + dx * dx
            if best is None or d < best[0]:
                best = (d, cy + dy, cx + dx)
_, ty, tx = best
oy, ox = ty - WINDOW // 2, tx - WINDOW // 2
det = Image.new("RGBA", (WINDOW * 16, WINDOW * 16))
for y in range(WINDOW):
    for x in range(WINDOW):
        i = grid[oy + y, ox + x]
        if i >= 0:
            det.paste(Image.fromarray(rgba(i)), (x * 16, y * 16))
det.save(f"{OUT}/detail.png", optimize=True)
tid = int(grid[ty, tx])
json.dump({"side": int(SIDE), "count": int(N), "window": WINDOW, "origin": [int(ox), int(oy)],
           "target": [int(tx), int(ty)], "targetId": tid, "targetCaption": caps[tid],
           "targetSubject": objs[tid]},
          open(f"{OUT}/mosaic.json", "w"), ensure_ascii=False, indent=1)
print("target", caps[tid], objs[tid])

# ---- chapter strips --------------------------------------------------------
objs_arr = np.array(objs)


def pick(subjects, per):
    out = []
    for s in subjects:
        ids = np.where(objs_arr == s)[0]
        if len(ids) == 0:
            print("missing subject", s)
            continue
        out += [int(i) for i in rng.choice(ids, min(per, len(ids)), replace=False)]
    return out


def strip(name, ids):
    cols = 16
    rows = (len(ids) + cols - 1) // cols
    im = Image.new("RGBA", (cols * 16, rows * 16))
    for k, i in enumerate(ids):
        im.paste(Image.fromarray(rgba(i)), ((k % cols) * 16, (k // cols) * 16))
    im.save(f"{OUT}/ch_{name}.png", optimize=True)
    json.dump([{"id": i, "caption": caps[i], "subject": objs[i]} for i in ids],
              open(f"{OUT}/ch_{name}.json", "w"), ensure_ascii=False)
    print(name, len(ids))


strip("depth", pick(["potion bottle", "treasure chest", "slime", "crown", "magic orb", "torch",
                     "crystal cluster", "heart icon", "lantern", "skull crown", "spirit orb",
                     "king slime", "coin", "candle", "glowcap mushroom", "tome"], 3))
strip("dungeon", pick(["treasure chest", "mimic chest", "torch", "wall sconce torch", "skeleton",
                       "skeleton warrior", "dungeon key", "skeleton key", "potion vial", "candle",
                       "lantern", "barrel", "giant spider", "spider web", "dire rat", "coin",
                       "cellar door", "skull key", "floating skull", "skull idol"], 4))
strip("cthulhu", pick(["eldritch tome", "tentacled eye", "kraken tentacle", "tentacle monster",
                       "octopus", "vampire squid", "giant squid", "eye orb", "eye amulet",
                       "void orb", "summoning tome", "serpent idol", "rune obelisk", "rune stone"
                       if "rune stone" in set(objs) else "holed rune stone", "candle",
                       "shadow tome", "skull idol"], 4))
