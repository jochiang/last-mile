# The Last Mile cars: the three player cars (liftback, hauler, roadster) and the two traffic models
# (sedan, van). Car space and naming: see carlib.py.
# usage: blender -b --python-exit-code 1 -P art/cars.py -- <id> <out.glb> [preview_prefix]

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from carlib import *

PAINT_FIXED = {"liftback": 0xf1f1ee, "hauler": 0xb9c3cc, "roadster": 0xd8262f, "kei": 0x8fc1d4, "interceptor": 0x16181d, "rally": 0x1f4fbf}
HUB_FIXED = {"interceptor": 0x2a2c31, "rally": 0xd4a52a}   # black steelies; gold rally wheels
TRIM, GLASS, TYRE, HUB, INTERIOR = 0x15161a, 0x1c2836, 0x1b1c20, 0xb8bcc4, 0x23252b


def common(cid):
    paint = mat("paint", PAINT_FIXED.get(cid, 0xffffff))   # traffic: white, tinted per car in the game
    return dict(paint=paint, trim=mat("trim", TRIM), glass=mat("glass", GLASS), tyre=mat("tyre", TYRE), hub=mat("hub", HUB_FIXED.get(cid, HUB)),
                panel=mat("panel", 0xf2f2ee),
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


def kei(M):
    # a cab-over micro truck: a flat-faced cab over the front wheels, a drop-side bed behind
    body = body_root()
    W = 1.48
    prism("cab", [(1.68, 0.4), (1.72, 0.95), (1.62, 1.72), (1.45, 1.86), (0.45, 1.86), (0.4, 1.7), (0.4, 0.4)], W, M["paint"], parent=body, bevel=0.06)
    # the windscreen: most of the cab's face, raked back a touch; side windows
    prism("windscreen", [(1.66, 1.0), (1.56, 1.66), (1.58, 1.66), (1.68, 1.0)], 1.3, M["glass"], bevel=0, parent=body)
    for s_ in (-1, 1):
        x = s_ * (W / 2 + 0.005)
        quad(f"sidewin_{s_}", [(0.6, 1.05, x), (1.45, 1.05, x), (1.4, 1.68, x), (0.6, 1.68, x)][::(1 if s_ < 0 else -1)], M["glass"], body)
        block(f"mirror_{s_}", 1.45, 1.58, 1.18, 1.34, s_ * (W / 2 + 0.02), s_ * (W / 2 + 0.16), M["trim"], parent=body) if s_ > 0 else block(f"mirror_{s_}", 1.45, 1.58, 1.18, 1.34, -(W / 2 + 0.16), -(W / 2 + 0.02), M["trim"], parent=body)
        # the bed's drop sides
        block(f"bedside_{s_}", -1.7, 0.36, 0.72, 1.08, s_ * W / 2 - 0.05, s_ * W / 2 + 0.0, M["paint"], parent=body) if s_ > 0 else block(f"bedside_{s_}", -1.7, 0.36, 0.72, 1.08, -W / 2, -W / 2 + 0.05, M["paint"], parent=body)
    block("bedfloor", -1.7, 0.36, 0.42, 0.74, -W / 2, W / 2, M["trim"], parent=body)
    block("tailgate", -1.74, -1.68, 0.5, 1.08, -W / 2, W / 2, M["paint"], parent=body)
    block("rack", 0.3, 0.38, 1.08, 1.75, -0.66, 0.66, M["trim"], parent=body)   # the headache rack behind the cab
    block("bumper_f", 1.66, 1.8, 0.3, 0.46, -0.72, 0.72, M["trim"], bevel=0.03, parent=body)
    block("bumper_r", -1.8, -1.7, 0.3, 0.44, -0.7, 0.7, M["trim"], bevel=0.02, parent=body)
    block("grille", 1.71, 1.73, 0.6, 0.86, -0.32, 0.32, M["trim"], parent=body)
    lamps_pair(M, body, 1.735, 0.62, 0.84, 0.42, 0.66, "head")
    for s_ in (-1, 1):
        quad(f"lamp_tail_{s_}", [(-1.745, 0.62, s_ * 0.72), (-1.745, 0.62, s_ * 0.52), (-1.745, 0.9, s_ * 0.52), (-1.745, 0.9, s_ * 0.72)][::(1 if s_ > 0 else -1)], M["tail"], body)
    block("bag", -1.25, -0.35, 0.74, 1.3, -0.45, 0.45, M["bag"], bevel=0.03, parent=body)   # strapped in the bed
    for f in (-0.55, -1.05):
        block(f"strap_{f}", f - 0.03, f + 0.03, 1.3, 1.32, -0.47, 0.47, M["trim"], parent=body)
    arches(M, body, W, (1.05, -1.1), 0.29)
    wheels(M, 1.05, -1.1, 0.62, 0.29, 0.18)


def interceptor(M):
    # a big ex-police sedan: black with white doors, push bar, a pillar spotlight, steel wheels
    body = body_root()
    W = 1.9
    prism("tub", [(2.5, 0.28), (2.53, 0.6), (2.4, 0.8), (1.1, 0.93), (-1.75, 0.98), (-2.45, 0.94), (-2.52, 0.6), (-2.45, 0.28)], W, M["paint"], parent=body, bevel=0.07)
    prism("glasshouse", [(1.1, 0.92), (0.35, 1.42), (-0.95, 1.43), (-1.6, 0.97)], 1.66, M["glass"], taper_from=1.0, taper=0.84, parent=body, bevel=0.04)
    prism("roof", [(0.33, 1.42), (-0.96, 1.43), (-1.0, 1.48), (0.3, 1.47)], 1.38, M["paint"], parent=body, bevel=0.02)
    for s_ in (-1, 1):
        x0, x1 = (W / 2 - 0.0, W / 2 + 0.012) if s_ > 0 else (-W / 2 - 0.012, -W / 2)
        block(f"doors_{s_}", -1.15, 0.95, 0.42, 0.9, x0, x1, M["panel"], parent=body)
        block(f"door_seam_{s_}", -0.12, -0.09, 0.42, 0.9, x0 - 0.002 * s_, x1 + 0.004 * s_, M["trim"], parent=body)
        block(f"mirror_{s_}", 0.85, 1.0, 1.0, 1.12, s_ * (W / 2 + 0.02), s_ * (W / 2 + 0.15), M["trim"], parent=body) if s_ > 0 else block(f"mirror_{s_}", 0.85, 1.0, 1.0, 1.12, -(W / 2 + 0.15), -(W / 2 + 0.02), M["trim"], parent=body)
    block("spotlight", 0.95, 1.12, 1.02, 1.14, -(W / 2 + 0.12), -(W / 2 - 0.02), M["hub"], parent=body)
    # the push bar: two uprights and two rails on the nose
    for x in (-0.42, 0.42):
        block(f"pb_up_{x}", 2.55, 2.65, 0.32, 0.98, x - 0.05, x + 0.05, M["trim"], parent=body)
    for h in (0.5, 0.86):
        block(f"pb_rail_{h}", 2.6, 2.7, h - 0.05, h + 0.05, -0.55, 0.55, M["trim"], parent=body)
    block("bumper_f", 2.38, 2.6, 0.26, 0.44, -0.94, 0.94, M["trim"], bevel=0.04, parent=body)
    block("bumper_r", -2.6, -2.38, 0.26, 0.44, -0.94, 0.94, M["trim"], bevel=0.04, parent=body)
    lamps_pair(M, body, 2.55, 0.62, 0.74, 0.45, 0.86, "head")
    lamps_pair(M, body, -2.535, 0.66, 0.8, 0.48, 0.88, "tail")
    for x in (-0.5, 0.55):
        block(f"antenna_{x}", -2.1, -2.07, 0.96, 1.5, x - 0.012, x + 0.012, M["trim"], parent=body)
    block("bag", -0.8, 0.15, 1.47, 1.98, -0.5, 0.5, M["bag"], bevel=0.03, parent=body)
    arches(M, body, W, (1.55, -1.5), 0.36)
    wheels(M, 1.55, -1.5, 0.88, 0.36, 0.26)


def rally(M):
    # a boxy all-wheel-drive hatch: hood scoop, big wing, fog lamps, mud flaps, gold wheels
    body = body_root()
    W = 1.82
    prism("tub", [(2.05, 0.3), (2.1, 0.6), (1.98, 0.78), (0.9, 0.92), (-1.85, 0.98), (-2.05, 0.9), (-2.08, 0.55), (-2.0, 0.3)], W, M["paint"], parent=body, bevel=0.07)
    prism("glasshouse", [(0.88, 0.91), (0.15, 1.42), (-1.55, 1.44), (-1.95, 0.97)], 1.6, M["glass"], taper_from=1.0, taper=0.86, parent=body, bevel=0.04)
    prism("roof", [(0.12, 1.42), (-1.56, 1.44), (-1.6, 1.49), (0.1, 1.47)], 1.42, M["paint"], parent=body, bevel=0.02)
    prism("scoop", [(1.5, 0.86), (0.95, 0.93), (0.95, 1.03), (1.3, 0.97)], 0.62, M["trim"], parent=body, bevel=0.02)
    prism("wing", [(-1.62, 1.6), (-2.05, 1.55), (-2.1, 1.62), (-1.66, 1.68)], 1.64, M["paint"], parent=body, bevel=0.01)
    for x in (-0.55, 0.55):
        block(f"wing_strut_{x}", -1.9, -1.8, 1.4, 1.6, x - 0.03, x + 0.03, M["trim"], parent=body)
    for s_ in (-1, 1):
        block(f"rocker_{s_}", -1.45, 1.45, 0.3, 0.42, s_ * W / 2 - 0.03, s_ * W / 2 + 0.03, M["trim"], parent=body)
        block(f"mirror_{s_}", 0.7, 0.85, 0.98, 1.1, s_ * (W / 2 + 0.02), s_ * (W / 2 + 0.14), M["paint"], parent=body) if s_ > 0 else block(f"mirror_{s_}", 0.7, 0.85, 0.98, 1.1, -(W / 2 + 0.14), -(W / 2 + 0.02), M["paint"], parent=body)
        block(f"flap_{s_}", -1.66, -1.62, 0.1, 0.46, s_ * 0.86 - 0.16, s_ * 0.86 + 0.16, M["tail"] if False else M["trim"], parent=body)
        block(f"stripe_{s_}", -1.4, 1.6, 0.6, 0.66, s_ * W / 2 - 0.004, s_ * W / 2 + 0.004, M["panel"], parent=body)
    block("bumper_f", 1.92, 2.18, 0.26, 0.48, -0.92, 0.92, M["trim"], bevel=0.04, parent=body)
    block("bumper_r", -2.16, -1.95, 0.26, 0.46, -0.92, 0.92, M["trim"], bevel=0.04, parent=body)
    lamps_pair(M, body, 2.11, 0.62, 0.72, 0.42, 0.82, "head")
    lamps_pair(M, body, 2.185, 0.32, 0.42, 0.28, 0.5, "head")    # fog lamps in the bumper
    lamps_pair(M, body, -2.09, 0.68, 0.8, 0.5, 0.85, "tail")
    block("bag", -1.05, -0.15, 1.49, 1.98, -0.46, 0.46, M["bag"], bevel=0.03, parent=body)
    arches(M, body, W, (1.32, -1.32), 0.36)
    wheels(M, 1.32, -1.32, 0.84, 0.36, 0.27)


BUILD = {"liftback": liftback, "hauler": hauler, "roadster": roadster, "sedan": sedan, "van": van, "kei": kei, "interceptor": interceptor, "rally": rally}

if __name__ == "__main__":
    a = args()
    cid, out = a[0], a[1]
    setup()
    M = common(cid)
    BUILD[cid](M)
    export(out)
    if len(a) > 2:
        L = {"hauler": 5.0, "van": 5.4, "interceptor": 5.2, "kei": 3.8}.get(cid, 4.4)
        preview(a[2], [((L * 0.95, 1.9, 4.6), (0, 0.7, 0)), ((-L * 0.95, 2.3, -4.2), (0, 0.8, 0))])
