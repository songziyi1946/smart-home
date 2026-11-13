"""Run with Blender: blender -b -t 4 --python build_millwork.py."""

import json
import math
from pathlib import Path

import bpy
from mathutils import Euler

HERE = Path(__file__).resolve().parent
PLAN = json.loads((HERE.parent / "millwork.json").read_text(encoding="utf-8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "METERS"


def material(name, color, roughness):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = result.diffuse_color
    shader.inputs["Roughness"].default_value = roughness
    return result


walnut = material("Warm oak veneer", (.38, .235, .135), .68)
ivory = material("Warm ivory doors", (.78, .735, .64), .72)
linen = material("Warm gray backing", (.39, .34, .28), .86)
dark = material("Dark trim", (.038, .041, .045), .5)
glass = material("Oven glass", (.014, .022, .027), .22)
stone = material("Light stone", (.74, .69, .59), .38)


def collection(name):
    result = bpy.data.collections.new(name)
    scene.collection.children.link(result)
    return result


def mesh(name, vertices, faces, finish, group, bevel):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    data.materials.append(finish)
    if bevel:
        modifier = obj.modifiers.new("Soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        normal = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    return obj


def prism(name, outline, bottom, top, finish, group, bevel=.002):
    # Floor plan is X right and Z down. Blender Y points toward the top of the plan.
    vertices = [(x, -z, height) for height in (bottom, top) for x, z in outline]
    n = len(outline)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
    return mesh(name, vertices, faces, finish, group, bevel)


def box(name, x0, z0, x1, z1, bottom, top, finish, group, bevel=.002):
    return prism(name, [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], bottom, top, finish, group, bevel)


def doors(x0, z0, x1, z1, height, group, count, north=False):
    front0, front1 = (z0, z0 + .02) if north else (z1 - .02, z1)
    body0, body1 = (front1, z1) if north else (z0, front0)
    box("Carcass", x0, body0, x1, body1, 0, height, walnut, group)
    width = (x1 - x0) / count
    for i in range(count):
        left = x0 + i * width + .004
        box("Door", left, front0, left + width - .008, front1, .08, height - .012, ivory, group)


def open_unit(x0, z0, x1, z1, height, kind, group):
    edge = .025
    for left in (x0, x1 - edge):
        box("Side", left, z0, left + edge, z1, 0, height, walnut, group)
    box("Back", x0 + edge, z0, x1 - edge, z0 + edge, 0, height, linen, group)
    for top in (edge, height):
        box("End board", x0 + edge, z0, x1 - edge, z1, top - edge, top, walnut, group)
    if kind == "arch":
        for bottom in (.10, .32, .54):
            box("Drawer front", x0 + .04, z1 - .022, x1 - .04, z1, bottom, bottom + .205, ivory, group)
        # The shaped upper fascia follows the arched opening shown in the elevation.
        center = (x0 + x1) / 2
        radius = (x1 - x0) / 2 - .055
        spring = height - radius - .12
        arc = [(center + radius * math.cos(i * math.pi / 24),
                spring + radius * math.sin(i * math.pi / 24)) for i in range(25)]
        profile = [(x0 + edge, height - edge), (x0 + edge, spring), *reversed(arc),
                   (x1 - edge, spring), (x1 - edge, height - edge)]
        vertices = [(x, -z, y) for z in (z1 - .022, z1) for x, y in profile]
        n = len(profile)
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
        mesh("Arched fascia", vertices, faces, walnut, group, .0015)
        levels = (1.20, 1.53)
    else:
        levels = (.42, .81, 1.20, 1.59, 1.98) if kind == "shelves" else (.86, 1.55)
    for y in levels:
        box("Shelf", x0 + edge, z0 + edge, x1 - edge, z1 - .012, y, y + .022, walnut, group)


def entry_floating(x0, z0, x1, z1, group):
    # Image reference: a tall, light door wardrobe held above the floor with a warm wood side panel.
    bottom, height = .28, 2.20
    side = x0 + .22
    box("Floating wardrobe carcass", x0, z0, x1, z1, bottom, height, walnut, group, .006)
    box("Floating wardrobe side panel", x0 + .02, z0 - .01, side, z1 + .01, bottom + .02, height - .02, walnut, group, .002)
    width = (x1 - side) / 2
    for i in range(2):
        left = side + i * width + .006
        # Keep the door skin just proud of the carcass front to avoid z-fighting while orbiting.
        box("Floating wardrobe door", left, z1 + .004, left + width - .012, z1 + .016, bottom + .05, height - .08, ivory, group, .002)
    box("Floating wardrobe plinth shadow", x0 + .10, z0 + .04, x1 - .10, z1 - .04, .22, .28, dark, group, .002)
    box("Floating wardrobe top", x0 - .02, z0 - .01, x1 + .02, z1 + .01, height + .004, height + .045, stone, group, .003)


def entry_wardrobe(x0, z0, x1, z1, group):
    # Image reference: warm wood tall side, open hanging niche, then light full-height doors.
    left = x0 + (x1 - x0) * .27
    niche = left + (x1 - x0) * .30
    box("Entry side carcass", x0, z0, left, z1, .06, 2.12, walnut, group, .006)
    box("Entry side door", x0 + .025, z1 + .004, left - .025, z1 + .016, .12, 2.05, walnut, group, .001)
    box("Entry hanging niche", left, z0, niche, z1, .06, 2.12, walnut, group, .006)
    box("Entry niche backing", left + .025, z0 + .02, niche - .025, z0 + .045, .88, 1.90, linen, group, .001)
    box("Entry hanging rail", left + .07, z0 + .07, niche - .07, z1 - .07, 1.62, 1.67, dark, group, .002)
    box("Entry shoe bench", left + .02, z0 + .02, niche - .02, z1 - .02, .18, .82, walnut, group, .004)
    box("Entry shoe cushion", left - .01, z0 - .01, niche + .01, z1 + .01, .82, .90, stone, group, .003)
    width = (x1 - niche) / 2
    for i in range(2):
        door_left = niche + i * width + .006
        box("Entry wardrobe door", door_left, z1 + .004, door_left + width - .012, z1 + .016, .12, 2.05, ivory, group, .001)


for unit in PLAN["cabinets"]:
    x0, z0, x1, z1 = unit["bounds"]
    kind = unit["kind"]
    height = 1.941 if kind == "entry" else PLAN["height"]
    group = collection(unit["id"])
    if kind in {"arch", "shelves", "niche"}:
        open_unit(x0, z0, x1, z1, height, kind, group)
    elif kind == "entry-floating":
        entry_floating(x0, z0, x1, z1, group)
    elif kind == "entry-wardrobe":
        entry_wardrobe(x0, z0, x1, z1, group)
    elif kind == "oven":
        box("Tower carcass", x0, z0, x1, z1, 0, height, walnut, group)
        for start, end, finish in ((.08, .87, ivory), (.88, 1.34, glass), (1.35, height - .015, ivory)):
            box("Appliance tower front", x1 - .012, z0 + .012, x1 + .006, z1 - .012, start, end, finish, group)
        box("Oven handle", x1, z0 + .095, x1 + .04, z1 - .095, 1.24, 1.267, dark, group)
    else:
        doors(x0, z0, x1, z1, height, group, 4 if kind == "entry" else 2, kind == "reverse")

group = collection("kitchen-island")
x0, z0, x1, z1 = PLAN["island"]
box("Island base", x0 + .10, z0 + .11, x1 - .10, z1 - .022, 0, .87, walnut, group)
for i in range(3):
    left = x0 + .11 + i * (x1 - x0 - .22) / 3
    box("Island door", left, z1 - .022, left + .45, z1 - .003, .07, .85, ivory, group)
corner = .05
prism("Island worktop", [(x0, z0 + corner), (x0, z1 - corner), (x0 + corner, z1),
      (x1 - corner, z1), (x1, z1 - corner), (x1, z0 + corner),
      (x1 - corner, z0), (x0 + corner, z0)], .87, .92, stone, group, .004)

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            view = area.spaces.active.region_3d
            view.view_location = (5.5, -3.5, .9)
            view.view_rotation = Euler((math.radians(44), 0, math.radians(-10))).to_quaternion()
            view.view_distance = 11
            view.view_perspective = "ORTHO"

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "millwork.blend"), compress=True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "millwork.glb"), export_format="GLB", export_apply=True)
