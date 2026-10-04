# The Last Mile cars: the three player cars (liftback, hauler, roadster) and the two traffic models
# (sedan, van). Car space and naming: see carlib.py.
# usage: blender -b --python-exit-code 1 -P art/cars.py -- <id> <out.glb> [preview_prefix]

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from carlib import *

PAINT_FIXED = {"liftback": 0xf1f1ee, "hauler": 0xb9c3cc, "roadster": 0xd8262f}
TRIM, GLASS, TYRE, HUB, INTERIOR = 0x15161a, 0x1c2836, 0x1b1c20, 0xb8bcc4, 0x23252b


def common(cid):
    paint = mat("paint", PAINT_FIXED.get(cid, 0xffffff))   # traffic: white, tinted per car in the game
    return dict(paint=paint, trim=mat("trim", TRIM), glass=mat("glass", GLASS), tyre=mat("tyre", TYRE), hub=mat("hub", HUB),
                head=mat("lamp_head", 0xfff4d6, emit=True), tail=mat("lamp_tail", 0xff2a2a, emit=True), interior=mat("interior", INTERIOR),
                bag=mat("bag", 0xff7a1a))


def wheels(M, fF, fR, x, r, w):
    for nm, f, s in (("wheel_FL", fF, -1), ("wheel_FR", fF, 1), ("wheel_RL", fR, -1), ("wheel_RR", fR, 1)):
        wheel(nm, f, s * x, r, w, M["tyre"], M["hub"])


def arches(M, body, W, wheels_at, r):
    # a dark wheel well on each side: a half-octagon plate just proud of the body side
    import math as _m
    for f in wheels_at:
        for s in (-1, 1):
            pts = [(f + (r + 0.07) * _m.cos(a), r + (r + 0.07) * _m.sin(a)) for a in [k * _m.pi / 6 for k in range(7)]]
            pts.append((f - r - 0.07, 0.2)); pts.append((f + r + 0.07, 0.2))
            o = prism(f"arch_{f:+.1f}_{s}", pts, 0.012, M["trim"], bevel=0, parent=body, x0=s * W / 2 - (0.012 if s < 0 else 0) + s * 0.002)


def lamps_pair(M, body, f, h0, h1, xin, xout, which):
    m = M["head"] if which == "head" else M["tail"]
    for s in (-1, 1):
        a, b = s * xin, s * xout
        if which == "head":
            pts = [(f, h0, min(a, b)), (f, h0, max(a, b)), (f, h1, max(a, b)), (f, h1, min(a, b))]
        else:
            pts = [(f, h0, max(a, b)), (f, h0, min(a, b)), (f, h1, min(a, b)), (f, h1, max(a, b))]
        quad(f"lamp_{which}_{'L' if s < 0 else 'R'}", pts, m, body)


def liftback(M):
    body = body_root()
    W = 1.78
    prism("tub", [(2.15, 0.25), (2.18, 0.55), (2.06, 0.74), (0.85, 0.93), (-1.9, 0.98), (-2.13, 0.88), (-2.17, 0.55), (-2.1, 0.25)], W, M["paint"], parent=body, bevel=0.07)
    prism("glasshouse", [(0.84, 0.92), (0.05, 1.37), (-0.75, 1.39), (-1.95, 0.97)], 1.56, M["glass"], taper_from=1.0, taper=0.82, parent=body, bevel=0.04)
    prism("roof", [(0.02, 1.37), (-0.76, 1.39), (-0.82, 1.43), (0.0, 1.415)], 1.3, M["trim"], parent=body, bevel=0.02)
    prism("spoiler", [(-1.62, 1.12), (-2.08, 1.04), (-2.12, 1.09), (-1.66, 1.17)], 1.42, M["trim"], parent=body, bevel=0.01)
    block("bumper_f", 1.98, 2.24, 0.22, 0.42, -0.9, 0.9, M["trim"], bevel=0.04, parent=body)
    block("bumper_r", -2.22, -1.98, 0.22, 0.42, -0.9, 0.9, M["trim"], bevel=0.04, parent=body)
    for s in (-1, 1):
        block(f"rocker_{s}", -1.55, 1.55, 0.25, 0.36, s * W / 2 - 0.02, s * W / 2 + 0.02, M["trim"], parent=body)
        block(f"mirror_{s}", 0.65, 0.8, 0.96, 1.08, s * (W / 2 + 0.02), s * (W / 2 + 0.14), M["trim"], parent=body)
    # a bonnet stripe following the hood's slope (white and black is the brief)
    prism("stripe", [(2.03, 0.748), (0.9, 0.93), (0.9, 0.95), (2.03, 0.768)], 0.44, M["trim"], bevel=0, parent=body)
    lamps_pair(M, body, 2.19, 0.6, 0.7, 0.42, 0.8, "head")
    quad("lamp_tail_bar", [(-2.18, 0.72, 0.82), (-2.18, 0.72, -0.82), (-2.18, 0.8, -0.82), (-2.18, 0.8, 0.82)], M["tail"], body)
    block("bag", -0.65, 0.15, 1.415, 1.95, -0.48, 0.48, M["bag"], bevel=0.03, parent=body)
    arches(M, body, W, (1.3, -1.3), 0.36)
    wheels(M, 1.3, -1.3, 0.83, 0.36, 0.26)


def hauler(M):
    body = body_root()
    W = 1.94
    prism("tub", [(2.4, 0.32), (2.45, 0.66), (2.3, 0.95), (1.6, 1.1), (-2.35, 1.14), (-2.45, 1.02), (-2.45, 0.45), (-2.35, 0.32)], W, M["paint"], parent=body, bevel=0.08)
    prism("glasshouse", [(1.6, 1.08), (0.9, 1.76), (-2.2, 1.8), (-2.4, 1.15)], 1.86, M["glass"], taper_from=1.2, taper=0.9, parent=body, bevel=0.05)
    prism("roof", [(0.92, 1.76), (-2.2, 1.8), (-2.22, 1.88), (0.85, 1.84)], 1.7, M["paint"], parent=body, bevel=0.03)
    for f in (0.25, -1.0, -2.15):   # pillars, in the body colour
        for s in (-1, 1):
            block(f"pillar_{f}_{s}", f - 0.08, f + 0.08, 1.12, 1.78, s * 0.86 - 0.04, s * 0.86 + 0.04, M["paint"], parent=body)
    for s in (-1, 1):
        block(f"rail_{s}", -2.0, 0.6, 1.88, 1.96, s * 0.72 - 0.04, s * 0.72 + 0.04, M["trim"], parent=body)
        block(f"rocker_{s}", -1.9, 1.9, 0.32, 0.5, s * W / 2 - 0.02, s * W / 2 + 0.02, M["trim"], parent=body)
        block(f"door_seam_{s}", -0.95, -0.92, 0.55, 1.1, s * W / 2 - 0.01, s * W / 2 + 0.01, M["trim"], parent=body)
        block(f"mirror_{s}", 1.35, 1.52, 1.15, 1.3, s * (W / 2 + 0.02), s * (W / 2 + 0.16), M["trim"], parent=body)
    block("bumper_f", 2.28, 2.52, 0.28, 0.52, -0.98, 0.98, M["trim"], bevel=0.05, parent=body)
    block("bumper_r", -2.52, -2.3, 0.28, 0.52, -0.98, 0.98, M["trim"], bevel=0.05, parent=body)
    lamps_pair(M, body, 2.46, 0.68, 0.84, 0.5, 0.92, "head")
    for s in (-1, 1):
        quad(f"lamp_tail_{s}", [(-2.46, 0.6, s * 0.97), (-2.46, 0.6, s * 0.78), (-2.46, 1.05, s * 0.78), (-2.46, 1.05, s * 0.97)][::(1 if s > 0 else -1)], M["tail"], body)
    block("bag", -1.2, -0.2, 1.96, 2.45, -0.5, 0.5, M["bag"], bevel=0.03, parent=body)
    arches(M, body, W, (1.5, -1.45), 0.4)
    wheels(M, 1.5, -1.45, 0.9, 0.4, 0.28)


def roadster(M):
    body = body_root()
    W = 1.66
    prism("tub", [(1.95, 0.22), (1.98, 0.45), (1.86, 0.62), (0.6, 0.79), (-1.5, 0.82), (-1.9, 0.74), (-1.95, 0.44), (-1.88, 0.22)], W, M["paint"], parent=body, bevel=0.08)
    block("cockpit", -1.0, 0.32, 0.62, 0.815, -0.64, 0.64, M["interior"], parent=body)
    for s in (-1, 1):
        block(f"seat_{s}", -0.9, -0.55, 0.62, 1.15, s * 0.12, s * 0.56, M["interior"], bevel=0.03, parent=body) if s > 0 else block(f"seat_{s}", -0.9, -0.55, 0.62, 1.15, -0.56, -0.12, M["interior"], bevel=0.03, parent=body)
        block(f"hoop_{s}", -1.05, -0.97, 0.8, 1.22, s * 0.34 - 0.04, s * 0.34 + 0.04, M["trim"], parent=body)
        # pop-up headlights, up
        x0, x1 = (0.32, 0.7) if s > 0 else (-0.7, -0.32)
        block(f"popup_{s}", 1.24, 1.56, 0.68, 0.88, x0, x1, M["paint"], bevel=0.02, parent=body)
        quad(f"lamp_head_{s}", [(1.565, 0.7, min(x0, x1) + 0.03), (1.565, 0.7, max(x0, x1) - 0.03), (1.565, 0.86, max(x0, x1) - 0.03), (1.565, 0.86, min(x0, x1) + 0.03)], M["head"], body)
        block(f"mirror_{s}", 0.42, 0.55, 0.82, 0.92, s * (W / 2 + 0.01), s * (W / 2 + 0.12), M["trim"], parent=body) if s > 0 else block(f"mirror_{s}", 0.42, 0.55, 0.82, 0.92, -(W / 2 + 0.12), -(W / 2 + 0.01), M["trim"], parent=body)
    prism("windscreen", [(0.5, 0.79), (0.22, 1.12), (0.16, 1.12), (0.44, 0.79)], 1.36, M["glass"], bevel=0, parent=body)
    block("grin", 1.88, 2.0, 0.3, 0.42, -0.55, 0.55, M["trim"], parent=body)
    lamps_pair(M, body, -1.96, 0.52, 0.64, 0.42, 0.72, "tail")
    block("bag", -0.85, -0.2, 0.8, 1.22, 0.14, 0.56, M["bag"], bevel=0.03, parent=body)   # no roof: the passenger seat
    arches(M, body, W, (1.13, -1.13), 0.33)
    wheels(M, 1.13, -1.13, 0.78, 0.33, 0.24)


def sedan(M):
    body = body_root()
    W = 1.78
    prism("tub", [(2.25, 0.25), (2.28, 0.55), (2.15, 0.72), (1.0, 0.86), (-1.6, 0.92), (-2.2, 0.88), (-2.25, 0.55), (-2.2, 0.25)], W, M["paint"], parent=body, bevel=0.07)
    prism("glasshouse", [(1.0, 0.85), (0.3, 1.32), (-0.85, 1.33), (-1.45, 0.91)], 1.56, M["glass"], taper_from=0.95, taper=0.84, parent=body, bevel=0.04)
    prism("roof", [(0.28, 1.32), (-0.86, 1.33), (-0.9, 1.37), (0.25, 1.36)], 1.3, M["paint"], parent=body, bevel=0.02)
    block("bumper_f", 2.1, 2.32, 0.22, 0.4, -0.88, 0.88, M["trim"], bevel=0.04, parent=body)
    block("bumper_r", -2.32, -2.1, 0.22, 0.4, -0.88, 0.88, M["trim"], bevel=0.04, parent=body)
    lamps_pair(M, body, 2.29, 0.6, 0.7, 0.42, 0.8, "head")
    lamps_pair(M, body, -2.26, 0.65, 0.75, 0.45, 0.82, "tail")
    arches(M, body, W, (1.4, -1.4), 0.34)
    wheels(M, 1.4, -1.4, 0.82, 0.34, 0.24)


def van(M):
    body = body_root()
    W = 2.0
    prism("tub", [(2.6, 0.32), (2.62, 0.8), (2.45, 1.05), (1.5, 1.15), (-2.6, 1.15), (-2.6, 0.32)], W, M["paint"], parent=body, bevel=0.07)
    prism("cab", [(1.5, 1.13), (1.06, 1.85), (0.95, 1.85), (0.95, 1.13)], 1.9, M["glass"], parent=body, bevel=0.03)
    block("box", -2.6, 0.96, 1.15, 2.35, -1.0, 1.0, M["paint"], bevel=0.05, parent=body)
    block("bumper_f", 2.45, 2.7, 0.28, 0.5, -0.98, 0.98, M["trim"], bevel=0.04, parent=body)
    block("bumper_r", -2.7, -2.5, 0.28, 0.5, -0.98, 0.98, M["trim"], bevel=0.04, parent=body)
    lamps_pair(M, body, 2.63, 0.72, 0.86, 0.55, 0.92, "head")
    lamps_pair(M, body, -2.61, 0.5, 0.75, 0.75, 0.95, "tail")
    arches(M, body, W, (1.75, -1.7), 0.4)
    wheels(M, 1.75, -1.7, 0.9, 0.4, 0.28)


BUILD = {"liftback": liftback, "hauler": hauler, "roadster": roadster, "sedan": sedan, "van": van}

if __name__ == "__main__":
    a = args()
    cid, out = a[0], a[1]
    setup()
    M = common(cid)
    BUILD[cid](M)
    export(out)
    if len(a) > 2:
        L = {"hauler": 5.0, "van": 5.4}.get(cid, 4.4)
        preview(a[2], [((L * 0.95, 1.9, 4.6), (0, 0.7, 0)), ((-L * 0.95, 2.3, -4.2), (0, 0.8, 0))])
