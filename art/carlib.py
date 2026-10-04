# Building blocks for the Last Mile car scripts (art/cars.py).
#
# Conventions: a car is authored in "car space": f forward (metres from the middle), h up from the
# ground, x to the right. Blender gets x = x, y = -f, z = h, so the glTF exporter's Y-up conversion
# leaves the car facing three.js +Z (the game's forward). The origin is on the ground, midway
# between the axles.
#
# Bodywork is side profiles extruded across the car (prism), optionally narrowed toward the top
# (tumblehome), then chamfered by a Bevel modifier for a faceted low-poly look. Every material is
# named for its job (paint, glass, trim, lamp_head, lamp_tail, tyre, hub, interior, bag); the game
# replaces them with its own (night-glowing lamps, per-car paint, flat shading). Wheels are
# separate objects (wheel_FL, wheel_FR, wheel_RL, wheel_RR) with their origin at the hub, so the
# game can steer and spin them.

import bpy, bmesh, math, sys
from mathutils import Vector

D = math.radians


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return a


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    return bpy.context.scene


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


_mats = {}
def mat(name, hexv, emit=False):
    key = name
    if key not in _mats:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        r, g, b = ((hexv >> s) & 255 for s in (16, 8, 0))
        col = (lin(r / 255), lin(g / 255), lin(b / 255), 1)
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = col
        bsdf.inputs["Roughness"].default_value = 0.35 if name == "glass" else 0.5
        if emit:
            bsdf.inputs["Emission Color"].default_value = col
            bsdf.inputs["Emission Strength"].default_value = 2.0
        m["game_color"] = hexv
        _mats[key] = m
    return _mats[key]


def to_bl(f, h, x=0.0):
    return Vector((x, -f, h))


def _obj(name, bm, material, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    if parent: o.parent = parent
    return o


def prism(name, profile, width, material, taper_from=None, taper=1.0, bevel=0.06, parent=None, x0=None):
    """A side profile [(f, h), ...] (any winding) extruded across `width` (centred unless x0 given).
    taper: verts above h = taper_from are pulled in to this fraction of the half-width."""
    bm = bmesh.new()
    xa = -width / 2 if x0 is None else x0
    xb = xa + width
    L = [bm.verts.new(to_bl(f, h, xa)) for f, h in profile]
    R = [bm.verts.new(to_bl(f, h, xb)) for f, h in profile]
    bm.faces.new(L); bm.faces.new(list(reversed(R)))
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([L[i], L[j], R[j], R[i]])
    if taper_from is not None:
        cx = (xa + xb) / 2
        for v in L + R:
            if v.co.z > taper_from + 1e-4:
                v.co.x = cx + (v.co.x - cx) * taper
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, material, parent)
    if bevel:
        m = o.modifiers.new("chamfer", "BEVEL")
        m.width = bevel; m.segments = 1; m.limit_method = "ANGLE"; m.angle_limit = D(25)
    return o


def block(name, f0, f1, h0, h1, x0, x1, material, bevel=0.0, parent=None):
    """An axis-aligned box in car space."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), -(f0 + (v.co.y + 0.5) * (f1 - f0)), h0 + (v.co.z + 0.5) * (h1 - h0)))
    o = _obj(name, bm, material, parent)
    if bevel:
        m = o.modifiers.new("chamfer", "BEVEL"); m.width = bevel; m.segments = 1
    return o


def quad(name, pts, material, parent=None):
    """A single face from car-space corners [(f, h, x), ...] (wound to face outward)."""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(to_bl(f, h, x)) for f, h, x in pts])
    return _obj(name, bm, material, parent)


def wheel(name, f, x, r, width, tyre, hub):
    """A wheel with its origin at the hub: an octagon-ish tyre and a hub cap on the outer face."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=width, location=to_bl(f, r, x), rotation=(0, D(90), 0))
    o = bpy.context.object; o.name = name
    o.data.materials.append(tyre)
    bpy.ops.object.shade_flat()
    side = 1 if x > 0 else -1
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=r * 0.55, depth=0.02, location=to_bl(f, r, x + side * (width / 2 + 0.005)), rotation=(0, D(90), 0))
    h = bpy.context.object; h.name = name + "_hub"; h.data.materials.append(hub)
    h.parent = o; h.matrix_parent_inverse = o.matrix_world.inverted()
    return o


def body_root():
    """An empty that everything but the wheels hangs from: the game leans it."""
    o = bpy.data.objects.new("body", None)
    bpy.context.collection.objects.link(o)
    return o


def export(out):
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_extras=True, export_animations=False,
        export_apply=True, export_yup=True, export_texcoords=False, export_normals=True,
        export_cameras=False, export_lights=False,
    )
    print("EXPORTED", out)


def preview(path, views, size=(640, 400)):
    """Render a few views: [(camera location in car space (f, h, x), look-at (f, h, x)), ...] -> path_0.png ..."""
    scene = bpy.context.scene
    bpy.ops.object.light_add(type="SUN", rotation=(D(50), D(10), D(-140)))
    bpy.context.object.data.energy = 3.5
    scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.object; ground.data.materials.append(mat("ground_preview", 0x5a5d66))
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"; scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = size
    bpy.ops.object.camera_add()
    cam = bpy.context.object; cam.data.lens = 40; scene.camera = cam
    for i, (at, look) in enumerate(views):
        cam.location = to_bl(*at)
        cam.rotation_euler = (to_bl(*look) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{path}_{i}.png"
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)
    print("PREVIEW", path)
