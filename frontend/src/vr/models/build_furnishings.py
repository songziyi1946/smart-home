"""Build the living-room furniture and bathroom fixtures with Blender."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Euler

HERE = Path(__file__).resolve().parent
PLAN = json.loads((HERE.parent / "furnishings.json").read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "METERS"


def material(name, color, roughness=.6, metal=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = mat.diffuse_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    return mat


fabric = material("Warm linen", (.42, .38, .32), .95)
pillow = material("Ivory cushions", (.74, .69, .59), .94)
accent = material("Muted olive cushions", (.22, .26, .20), .92)
wood = material("Walnut", (.22, .13, .085))
stone = material("Warm limestone", (.64, .59, .49), .42)
white = material("Glazed ceramic", (.86, .85, .80), .22)
dark = material("Dark fittings", (.035, .043, .047), .35, .5)
inside = material("Basin interior", (.38, .43, .43), .25)
mirror = material("Mirror", (.60, .70, .72), .08, .95)
glass = material("Shower glass", (.53, .72, .76), .12)
glass.diffuse_color = (.53, .72, .76, .16)
glass.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = .16
glass.surface_render_method = "DITHERED"


def group(name, x=0, z=0, rotation=0):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.location = (x, -z, 0)
    obj.rotation_euler.z = math.radians(rotation)
    return obj


def finish(obj, name, parent, mat):
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    return obj


def box(name, x, z, y, w, d, h, mat, parent, radius=.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, parent, mat)
    bevel = obj.modifiers.new("Rounded edges", "BEVEL")
    bevel.width = min(radius, min(w, d, h) * .45)
    bevel.segments = 3
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def ellipsoid(name, x, z, y, w, d, h, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.scale = (w / 2, d / 2, h / 2)
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, parent, mat)


def rim(name, x, z, y, w, d, tube, mat, parent):
    bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=12,
                                   major_radius=1, minor_radius=tube,
                                   location=(x, -z, y))
    obj = bpy.context.object
    obj.scale = (w / 2, d / 2, .18)
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, parent, mat)


s = PLAN["sofa"]
sofa = group("Sofa facing cabinets", s["x"], s["z"])
box("Sofa plinth", 0, 0, .19, s["width"] - .12, s["depth"] - .12, .20, wood, sofa)
box("Upholstered base", 0, 0, .35, s["width"], s["depth"], .28, fabric, sofa, .09)
box("Backrest", 0, .36, .77, s["width"], .22, .68, fabric, sofa, .09)
for x in (-1.27, 1.27):
    box("Armrest", x, 0, .63, .21, .96, .48, fabric, sofa, .085)
for x in (-.79, 0, .79):
    box("Seat cushion", x, -.10, .56, .76, .71, .18, fabric, sofa, .075)
for i, x in enumerate((-.92, -.42, .44, .94)):
    box("Loose cushion", x, .17, .86, .43, .17, .42,
        pillow if i % 2 else accent, sofa, .075)

c = PLAN["coffeeTable"]
table = group("Coffee table", c["x"], c["z"])
box("Table pedestal", 0, 0, .19, .50, .36, .38, wood, table, .09)
box("Stone tabletop", 0, 0, .42, c["width"], c["depth"], .065, stone, table, .03)
box("Book", -.20, 0, .467, .26, .19, .028, pillow, table, .002)
ellipsoid("Ceramic bowl", .22, .02, .485, .22, .22, .09, white, table)

t = PLAN["television"]
tv = group("Television facing sofa", t["x"], t["z"])
box("TV frame", 0, 0, 1.05, t["width"], .065, .79, dark, tv)
box("TV screen", 0, .035, 1.05, t["width"] - .035, .009, .75, inside, tv, .003)
for x in (-.46, .46):
    box("TV support", x, 0, .34, .035, .035, .68, dark, tv)
    box("TV foot", x, 0, .025, .16, t["depth"], .05, dark, tv)

for bath in PLAN["bathrooms"]:
    v = bath["vanity"]
    vanity = group(bath["id"] + " vanity", v["x"], v["z"], v["rotation"])
    box("Floating vanity", 0, 0, .59, v["width"], v["depth"], .40, wood, vanity)
    for x in (-v["width"] / 4, v["width"] / 4):
        box("Drawer front", x, v["depth"] / 2, .59, v["width"] / 2 - .012, .022, .38, pillow, vanity)
    box("Vanity counter", 0, 0, .817, v["width"] + .025, v["depth"] + .02, .045, stone, vanity)
    ellipsoid("Basin body", 0, .035, .86, .46, .32, .095, white, vanity)
    ellipsoid("Basin recess", 0, .035, .899, .35, .235, .015, inside, vanity)
    rim("Basin rim", 0, .035, .905, .405, .275, .085, white, vanity)
    box("Mixer stem", 0, -.17, .96, .025, .025, .22, dark, vanity)
    box("Mixer spout", 0, -.115, 1.055, .025, .14, .025, dark, vanity)
    box("Mirror frame", 0, -v["depth"] / 2 + .015, 1.54, v["width"] - .04, .035, .81, wood, vanity)
    box("Mirror surface", 0, -v["depth"] / 2 + .036, 1.54, v["width"] - .075, .012, .775, mirror, vanity)
    box("Folded towel", -.22, .01, .86, .15, .21, .04, pillow, vanity)

    t = bath["toilet"]
    toilet = group(bath["id"] + " toilet", t["x"], t["z"], t["rotation"])
    ellipsoid("Toilet pedestal", 0, 0, .19, .33, .49, .38, white, toilet)
    ellipsoid("Toilet bowl", 0, .05, .36, .39, .55, .22, white, toilet)
    ellipsoid("Bowl opening", 0, .08, .46, .27, .37, .015, inside, toilet)
    rim("Toilet seat", 0, .07, .47, .34, .46, .105, white, toilet)
    box("Cistern", 0, -.235, .57, .37, .15, .44, white, toilet, .04)
    box("Flush button", .06, -.235, .797, .07, .04, .008, dark, toilet, .005)

    shower = group(bath["id"] + " shower")
    x0, z0, x1, z1 = bath["shower"]
    box("Shower tray", (x0 + x1) / 2, (z0 + z1) / 2, .025, x1 - x0, z1 - z0, .05, stone, shower)
    box("Linear drain", x1 - .12, (z0 + z1) / 2, .053, .035, (z1 - z0) * .65, .006, dark, shower, .001)
    a, b, c, d = bath["screen"]
    box("Shower glass screen", (a + c) / 2, (b + d) / 2, 1.04, c - a, d - b, 2.02, glass, shower, .002)
    if "sideScreen" in bath:
        a, b, c, d = bath["sideScreen"]
        box("Shower side glass", (a + c) / 2, (b + d) / 2, 1.04, c - a, d - b, 2.02, glass, shower, .002)
    box("Shower rail", x1 - .045, (z0 + z1) / 2, 1.35, .025, .025, 1.45, dark, shower)
    box("Shower arm", x1 - .17, (z0 + z1) / 2, 2.08, .28, .025, .025, dark, shower)
    box("Rain shower", x1 - .27, (z0 + z1) / 2, 2.06, .22, .22, .025, dark, shower)
    box("Mixer valve", x1 - .075, (z0 + z1) / 2, 1.04, .08, .18, .045, dark, shower)
    box("Shower shelf", x1 - .12, z1 - .22, 1.3, .22, .28, .025, stone, shower)
    for z in (z1 - .28, z1 - .16):
        box("Bottle", x1 - .12, z, 1.39, .055, .055, .15, pillow, shower)

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            view = area.spaces.active.region_3d
            view.view_location = (6.4, -3.7, .7)
            view.view_rotation = Euler((math.radians(35), 0, 0)).to_quaternion()
            view.view_distance = 16
            view.view_perspective = "ORTHO"

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "furnishings.blend"), compress=True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "furnishings.glb"), export_format="GLB", export_apply=True)
