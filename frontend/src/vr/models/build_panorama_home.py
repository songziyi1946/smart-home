"""Build a walkable, explicitly estimated interpretation of the supplied panoramas.

Run: blender -b -t 4 --python-exit-code 1 --python frontend/src/vr/models/build_panorama_home.py
The P-07 drawing establishes the main exterior dimensions and concave outline.
Unlabelled recess depths are traced; internal partitions, ceiling height and
furniture remain panorama-based estimates, not construction measurements.
"""

import json
import math
import struct
import tempfile
import zlib
from collections import deque
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
WIDTH, DEPTH, HEIGHT = 12.91, 7.53, 2.7
FOOTPRINT = [[0, 0], [5.94, 0], [5.94, .89], [12.91, .89], [12.91, 6.14], [9.68, 6.14], [9.68, 5.80], [8.26, 5.80], [8.26, 6.32], [5.74, 6.32], [5.74, 7.53], [0, 7.53]]
FOOTPRINT_AREA = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(FOOTPRINT, FOOTPRINT[1:] + FOOTPRINT[:1]))) / 2
PLAN = {
    "title": "埠印贤府 · 图纸外轮廓与全景内装重建",
    "estimated": True,
    "dimensionBasis": "外轮廓总宽12.91m、总进深7.53m、上凹口5.94m/0.89m、右侧底边Z=6.14m按用户尺寸图；中央底边Z≈6.32m、入口凹口Z≈5.80m按图像比例追踪。",
    "estimationNote": "外轮廓主要尺寸参考用户图纸；内部分隔、家具、层高仍按全景估算。外轮廓投影面积含墙，不是产权面积或建筑面积。",
    "width": WIDTH, "depth": DEPTH, "height": HEIGHT,
    "footprint": FOOTPRINT, "footprintArea": round(FOOTPRINT_AREA, 4),
    "rooms": [
        {"id": "entry", "name": "入户", "controlRoom": "入户", "bounds": [8.26, 3.7, 10.99, 5.8], "position": [9.1, 1.62, 5.3], "target": [6.6, 1.1, 4.8], "sourceSceneIds": ["25152992"]},
        {"id": "dining", "name": "餐厅", "controlRoom": "餐厨", "bounds": [5.94, 3.7, 8.26, 6.32], "position": [7.75, 1.62, 4.0], "target": [6.9, .9, 5.0], "sourceSceneIds": ["25152992"]},
        {"id": "living", "name": "客厅", "controlRoom": "客厅", "bounds": [0, 3.635, 5.74, 6.25], "position": [4.35, 1.62, 5.1], "target": [1.8, 1.0, 3.9], "sourceSceneIds": ["25152958", "25152960", "25152959"]},
        {"id": "balcony", "name": "阳台", "controlRoom": "阳台", "bounds": [0, 6.25, 5.74, 7.53], "position": [3.8, 1.62, 6.85], "target": [1.0, 1.0, 6.9], "sourceSceneIds": ["25152960"]},
        {"id": "kitchen", "name": "厨房", "controlRoom": "餐厨", "bounds": [5.94, .89, 7.82, 3.7], "position": [7.12, 1.62, 2.8], "target": [6.25, 1.1, 1.9], "sourceSceneIds": ["25152956"]},
        {"id": "bedroom", "name": "主卧", "controlRoom": "主卧", "bounds": [0, 0, 3.96, 3.635], "position": [3.35, 1.62, 2.7], "target": [1.8, .8, 1.3], "sourceSceneIds": ["25152991"]},
        {"id": "ensuite", "name": "主卫", "controlRoom": "主卫", "bounds": [3.96, 0, 5.94, 2.14], "position": [4.55, 1.62, 1.55], "target": [5.5, 1.0, 1.35], "sourceSceneIds": ["25152963"]},
        {"id": "second-bedroom", "name": "次卧", "controlRoom": "次卧", "bounds": [7.82, .89, 9.89, 3.7], "position": [8.20, 1.62, 2.9], "target": [9.15, .8, 2.1], "sourceSceneIds": ["25152957"]},
        {"id": "bath", "name": "次卫", "controlRoom": "次卫", "bounds": [10.99, 4.17, 12.91, 6.14], "position": [11.55, 1.62, 4.75], "target": [12.5, 1.0, 4.85], "sourceSceneIds": ["25152962"]},
        {"id": "study", "name": "书房", "controlRoom": "书房", "bounds": [9.89, .89, 12.91, 4.17], "position": [10.5, 1.62, 3.6], "target": [11.9, .8, 2.5], "sourceSceneIds": ["25152961"]},
    ],
    "walls": [], "furniture": [],
}

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
SCENE.unit_settings.system = "METRIC"
SCENE.unit_settings.length_unit = "METERS"


def linear(channel):
    return channel / 12.92 if channel <= .04045 else ((channel + .055) / 1.055) ** 2.4


def material(name, color, roughness=.65, metallic=0, alpha=1, glow=0):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*map(linear, rgb), alpha)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = result.diffuse_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        result.surface_render_method = "DITHERED"
    if glow:
        shader.inputs["Emission Color"].default_value = (*rgb, 1)
        shader.inputs["Emission Strength"].default_value = glow
    return result


WALL = material("Warm chalk plaster", "#EEEAE2", .91)
IVORY = material("Ivory cabinetry", "#E8E4DC", .7)
FLOOR = material("Warm pale porcelain", "#DAD6CF", .62)
GROUT = material("Fine warm grout", "#BFBAB1", .9)
WALNUT = material("Walnut veneer", "#9E785D", .65)
DARK_WOOD = material("Walnut edge", "#76553F", .7)
LINEN = material("Soft oatmeal linen", "#D5CBBE", .98)
WHITE_LINEN = material("Warm white bedding", "#F1EEE6", .97)
TAUPE = material("Taupe throw", "#AAA08D", .98)
BLACK = material("Charcoal fittings", "#282827", .45)
SCREEN = material("Dark television glass", "#292B2C", .16, .3)
STONE = material("Cream stone top", "#E1D9C9", .42)
CERAMIC = material("White ceramic", "#EEEDE6", .24)
STEEL = material("Brushed stainless steel", "#A5A7A5", .26, .8)
MIRROR = material("Tinted mirror", "#B6C3C1", .08, .92)
GLASS = material("Clear glass", "#D6E0DC", .12, .05, .14)
FROSTED = material("Frosted glass", "#CFD4CC", .6, 0, .37)
SHEER = material("White sheer curtain", "#F3F0E8", .95, 0, .76)
LEAF = material("Soft olive foliage", "#64714C", .9)
GLOW = material("Glow_Warm cove", "#FFE3AC", .6, glow=1.4)


def texture_material(mat, name, rgb, fabric=False):
    """Pack a deterministic small texture; no runtime procedural shaders needed."""
    rng = np.random.default_rng(219)
    h = w = 256
    y, x = np.mgrid[0:h, 0:w]
    if fabric:
        grain = .94 + .04 * np.sin(x * math.pi / 2) * np.sin(y * math.pi / 2) + rng.normal(0, .012, (h, w))
    else:
        grain = .86 + .09 * np.sin(x * .29 + np.sin(y * .035) * 1.8) + .035 * np.sin(x * 1.1) + rng.normal(0, .008, (h, w))
    # Use an explicitly sRGB PNG, avoiding generated-image buffer color-space
    # ambiguity when Blender packs and glTF re-encodes image pixels.
    pixels = np.rint(np.clip(grain[:, :, None] * np.array(rgb), 0, 1) * 255).astype(np.uint8)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    rows = b"".join(b"\0" + row.tobytes() for row in pixels)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"sRGB", b"\0") + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    with tempfile.TemporaryDirectory(prefix="home-model-texture-") as directory:
        path = Path(directory) / (name + ".png")
        path.write_bytes(png)
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = name
        image.colorspace_settings.name = "sRGB"
        image.pack()
        image.filepath = "//" + name + ".png"
    texture = mat.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    mat.node_tree.links.new(texture.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])


texture_material(WALNUT, "Packed walnut grain", (.58, .44, .34))
texture_material(LINEN, "Packed oatmeal weave", (.88, .85, .80), True)


def finish(obj, name, mat, presentation, room=""):
    obj.name = name
    obj.data.materials.append(mat)
    obj["presentation"] = presentation
    if room:
        obj["roomId"] = room
    return obj


def box(name, x, z, y, width, depth, height, mat=WALL, presentation="furniture", bevel=0, room=""):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, mat, presentation, room)
    if mat == WALNUT:
        # Cabinet facades run vertically; cube primitive UV nets rotate some faces.
        uv = obj.data.uv_layers.active.data
        for face in obj.data.polygons:
            for loop_index in face.loop_indices:
                co = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
                if abs(face.normal.z) < .5:
                    u = co.x / width if abs(face.normal.y) > .5 else co.y / depth
                    uv[loop_index].uv = (u + .5, co.z / height + .5)
                else:
                    uv[loop_index].uv = (co.x / width + .5, co.y / depth + .5)
    if bevel:
        mod = obj.modifiers.new("Soft edges", "BEVEL")
        mod.width = min(bevel, min(width, depth, height) * .45)
        mod.segments = 2
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def ellipsoid(name, x, z, y, width, depth, height, mat, presentation="furniture", room=""):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.scale = (width / 2, depth / 2, height / 2)
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, mat, presentation, room)


def cylinder(name, x, z, y, radius, height, mat, presentation="furniture", room="", vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(x, -z, y))
    obj = bpy.context.object
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return finish(obj, name, mat, presentation, room)


def footprint(kind, name, x0, z0, x1, z1):
    PLAN[kind].append({"id": name, "minX": round(x0, 4), "minZ": round(z0, 4), "maxX": round(x1, 4), "maxZ": round(z1, 4)})


def wall(name, x0, z0, x1, z1):
    box(name, (x0 + x1) / 2, (z0 + z1) / 2, HEIGHT / 2, x1 - x0, z1 - z0, HEIGHT, WALL, "wall")
    footprint("walls", name, x0, z0, x1, z1)
    box(name + " skirting", (x0 + x1) / 2, (z0 + z1) / 2, .035, x1 - x0 + .012, z1 - z0 + .012, .07, DARK_WOOD, "wall")


def partition_x(name, x, z0, z1, gap0, gap1, glazed=False):
    """Wall along Z, with a walkable open doorway and visible lintel."""
    wall(name + " north", x - .07, z0, x + .07, gap0)
    wall(name + " south", x - .07, gap1, x + .07, z1)
    box(name + " lintel", x, (gap0 + gap1) / 2, 2.49, .14, gap1 - gap0, .42, WALL, "wall")
    for z in (gap0, gap1):
        box(name + " jamb", x, z, 1.14, .17, .035, 2.28, BLACK if glazed else WALNUT, "wall")
    box(name + " header", x, (gap0 + gap1) / 2, 2.28, .17, gap1 - gap0, .04, BLACK if glazed else WALNUT, "wall")
    # The leaf is parked against the wall, not across the walking opening.
    box(name + " parked door", x + .09, gap1 + .36, 1.12, .035, .68, 2.22, GLASS if glazed else WALNUT, "wall")


def partition_z(name, z, x0, x1, gap0, gap1):
    wall(name + " west", x0, z - .07, gap0, z + .07)
    wall(name + " east", gap1, z - .07, x1, z + .07)
    box(name + " lintel", (gap0 + gap1) / 2, z, 2.49, gap1 - gap0, .14, .42, WALL, "wall")
    for x in (gap0, gap1):
        box(name + " jamb", x, z, 1.14, .035, .17, 2.28, WALNUT, "wall")
    box(name + " header", (gap0 + gap1) / 2, z, 2.28, gap1 - gap0, .17, .04, WALNUT, "wall")


def window_wall(name, axis, constant, start, end, opening0, opening1, sill=.65):
    """Perimeter window; sill is included in collision so visitors stay indoors."""
    if axis == "x":
        wall(name + " left", start, constant - .07, opening0, constant + .07)
        wall(name + " right", opening1, constant - .07, end, constant + .07)
        x, z, w, d = (opening0 + opening1) / 2, constant, opening1 - opening0, .14
    else:
        wall(name + " left", constant - .07, start, constant + .07, opening0)
        wall(name + " right", constant - .07, opening1, constant + .07, end)
        x, z, w, d = constant, (opening0 + opening1) / 2, .14, opening1 - opening0
    box(name + " sill wall", x, z, sill / 2, w, d, sill, WALL, "wall")
    footprint("walls", name + " sill", x - w / 2, z - d / 2, x + w / 2, z + d / 2)
    box(name + " lintel", x, z, 2.55, w, d, .3, WALL, "wall")
    box(name + " glass", x, z, (sill + 2.4) / 2, w if axis == "x" else .025, d if axis == "z" else .025, 2.4 - sill, GLASS, "wall")
    for offset in (opening0, (opening0 + opening1) / 2, opening1):
        box(name + " mullion", offset if axis == "x" else x, offset if axis == "z" else z, (sill + 2.4) / 2, .035, .035, 2.4 - sill, BLACK, "wall")
    for y in (sill, 2.4):
        box(name + " frame", x, z, y, w if axis == "x" else .05, d if axis == "z" else .05, .04, BLACK, "wall")


def cabinet(name, x, z, width, depth, height, facing="south", doors=3, base=.08, mat=IVORY):
    box(name + " carcass", x, z, base + height / 2, width, depth, height, WALNUT, room=name.split("_")[0])
    for i in range(doors):
        if facing in ("south", "north"):
            dx = x - width / 2 + (i + .5) * width / doors
            dz = z + (depth / 2 + .007) * (1 if facing == "south" else -1)
            box(name + " door", dx, dz, base + height / 2, width / doors - .012, .02, height - .02, mat)
        else:
            dz = z - depth / 2 + (i + .5) * depth / doors
            dx = x + (width / 2 + .007) * (1 if facing == "east" else -1)
            box(name + " door", dx, dz, base + height / 2, .02, depth / doors - .012, height - .02, mat)
    footprint("furniture", name, x - width / 2, z - depth / 2, x + width / 2, z + depth / 2)


def rug(name, x, z, width, depth):
    box(name, x, z, .012, width, depth, .018, LINEN, "floor")
    for dx in (-width / 2 + .035, width / 2 - .035):
        box(name + " border", x + dx, z, .023, .012, depth - .05, .003, TAUPE, "floor")
    for dz in (-depth / 2 + .035, depth / 2 - .035):
        box(name + " border", x, z + dz, .023, width - .05, .012, .003, TAUPE, "floor")


def plant(name, x, z, height=1.25):
    cylinder(name + " pot", x, z, .19, .17, .38, STONE)
    cylinder(name + " trunk", x, z, height / 2, .018, height, DARK_WOOD)
    for i in range(12):
        angle = i * 2.4
        ellipsoid(name + " leaf", x + math.cos(angle) * .17, z + math.sin(angle) * .17, height * (.53 + .035 * i), .32, .16, .16, LEAF)


def artwork(name, axis, x, z, y=1.6, width=.6, height=.8):
    box(name + " frame", x, z, y, width if axis == "z" else .03, .03 if axis == "z" else width, height, DARK_WOOD, "wall")
    box(name + " canvas", x + (-.018 if axis == "x" else 0), z + (.018 if axis == "z" else 0), y, width - .04 if axis == "z" else .01, .01 if axis == "z" else width - .04, height - .04, IVORY, "wall")
    for i in range(3):
        box(name + " relief", x + (-.027 if axis == "x" else (i - 1) * width / 5), z + (.027 if axis == "z" else (i - 1) * width / 5), y + (i % 2) * .1, width / 5 if axis == "z" else .015, .015 if axis == "z" else width / 5, height * .46, TAUPE, "wall", .008)


def books(name, x, z, y, count=6):
    for i in range(count):
        box(name + " book", x + i * .045, z, y + .1, .035, .14, .19 + (i % 3) * .02, [IVORY, TAUPE, WHITE_LINEN][i % 3], bevel=.002)


def cove(name, bounds):
    x0, z0, x1, z1 = bounds
    for z in (z0 + .2, z1 - .2):
        box(name + " ceiling border", (x0 + x1) / 2, z, HEIGHT - .12, x1 - x0 - .1, .35, .20, WALL, "overhead")
        box(name + " cove strip", (x0 + x1) / 2, z + (.18 if z < (z0 + z1) / 2 else -.18), HEIGHT - .11, x1 - x0 - .5, .025, .025, GLOW, "overhead")
    for x in (x0 + .2, x1 - .2):
        box(name + " ceiling border", x, (z0 + z1) / 2, HEIGHT - .12, .35, z1 - z0 - .1, .20, WALL, "overhead")
        box(name + " cove strip", x + (.18 if x < (x0 + x1) / 2 else -.18), (z0 + z1) / 2, HEIGHT - .11, .025, z1 - z0 - .5, .025, GLOW, "overhead")


def bed(name, x, z, width=1.8, length=2.05, rotate=False, throw=TAUPE):
    """Bed head at the north edge, or west edge when rotate=True."""
    group = bpy.data.objects.new(name + " assembly", None)
    SCENE.collection.objects.link(group)
    start = set(bpy.data.objects)
    box(name + " walnut plinth", 0, 0, .20, width, length, .30, WALNUT, bevel=.035)
    box(name + " mattress", 0, 0, .44, width + .03, length, .22, WHITE_LINEN, bevel=.09)
    box(name + " duvet", 0, .21, .59, width + .10, length * .78, .11, WHITE_LINEN, bevel=.045)
    for px in (-width / 4, width / 4):
        pillow = box(name + " pillow", px, -length * .33, .65, width * .43, .45, .16, WHITE_LINEN, bevel=.075)
        pillow.rotation_euler.x = -.08
    box(name + " folded throw", 0, .50, .67, width + .13, .68, .045, throw, bevel=.015)
    for obj in set(bpy.data.objects) - start:
        obj.parent = group
    group.location = (x, -z, 0)
    group.rotation_euler.z = math.pi / 2 if rotate is True else float(rotate)
    w, d = (length, width) if rotate else (width, length)
    footprint("furniture", name, x - w / 2 - .06, z - d / 2 - .06, x + w / 2 + .06, z + d / 2 + .06)



def vanity(name, x, z, width=.9, facing="east"):
    depth = .49
    w, d = (depth, width) if facing in ("east", "west") else (width, depth)
    cabinet(name, x, z, w, d, .47, facing, 2, .29, WALNUT)
    box(name + " porcelain counter", x, z, .81, w + .035, d + .035, .065, CERAMIC, bevel=.025)
    box(name + " inset basin", x, z, .85, w * .66, d * .67, .012, STEEL, bevel=.04)
    rear_x = x + (-w / 2 if facing == "east" else w / 2)
    box(name + " mirror walnut frame", rear_x, z, 1.55, .05, width, .85, WALNUT, "wall")
    box(name + " mirror", rear_x + (.028 if facing == "east" else -.028), z, 1.57, .009, width - .055, .73, MIRROR, "wall")
    box(name + " open mirror shelf", rear_x + (.07 if facing == "east" else -.07), z, 1.15, .16, width, .065, WALNUT, "wall")
    cylinder(name + " faucet", rear_x + (.14 if facing == "east" else -.14), z, .99, .022, .30, STEEL)
    box(name + " faucet spout", x, z, 1.12, .20, .025, .025, STEEL)
    for y in (.44, .67):
        box(name + " drawer reveal", x + (w / 2 + .02 if facing == "east" else -w / 2 - .02), z, y, .01, width - .04, .012, BLACK)


def toilet(name, x, z, rotation=0):
    start = set(bpy.data.objects)
    ellipsoid(name + " pedestal", 0, 0, .20, .35, .53, .40, CERAMIC)
    ellipsoid(name + " bowl", 0, .06, .38, .40, .61, .23, CERAMIC)
    ellipsoid(name + " seat opening", 0, .07, .498, .27, .36, .015, STEEL)
    box(name + " cistern", 0, -.23, .58, .38, .17, .42, CERAMIC, bevel=.045)
    group = bpy.data.objects.new(name + " assembly", None); SCENE.collection.objects.link(group)
    for obj in set(bpy.data.objects) - start - {group}:
        obj.parent = group
    group.location = (x, -z, 0); group.rotation_euler.z = rotation
    footprint("furniture", name, x - .24, z - .36, x + .24, z + .40)


def bathroom_tiles(name, x0, z0, x1, z1):
    for y in (.6, 1.2, 1.8, 2.4):
        box(name + " horizontal grout west", x0 + .09, (z0 + z1) / 2, y, .004, z1 - z0 - .1, .004, GROUT, "wall")
        box(name + " horizontal grout east", x1 - .09, (z0 + z1) / 2, y, .004, z1 - z0 - .1, .004, GROUT, "wall")
        box(name + " horizontal grout south", (x0 + x1) / 2, z1 - .09, y, x1 - x0 - .1, .004, .004, GROUT, "wall")



def outline_slab(name, bottom, top, mat, presentation):
    """One concave polygon; triangulation preserves the measured recesses."""
    vertices = [(x, -z, y) for y in (bottom, top) for x, z in FOOTPRINT]
    n = len(FOOTPRINT)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [((i + 1) % n, i, i + n, (i + 1) % n + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    assert mesh.polygons[0].normal.z < -.99 and mesh.polygons[1].normal.z > .99
    for polygon, a, b in zip(mesh.polygons[2:], FOOTPRINT, FOOTPRINT[1:] + FOOTPRINT[:1]):
        assert polygon.normal.x * (b[1] - a[1]) + polygon.normal.y * (b[0] - a[0]) > 0, "Slab side must face outward"
    obj = bpy.data.objects.new(name, mesh)
    SCENE.collection.objects.link(obj)
    finish(obj, name, mat, presentation)


# Ground and ceiling follow the drawing's concave outline, not the bounding box.
outline_slab("Drawing outline foundation", -.18, 0, FLOOR, "floor")
outline_slab("Drawing outline ceiling", HEIGHT, HEIGHT + .08, WALL, "ceiling")
for room in PLAN["rooms"]:
    x0, z0, x1, z1 = room["bounds"]
    for x in np.arange(math.ceil(x0 / .8) * .8, x1, .8):
        if x > x0 + .01:
            box("Floor grout X", float(x), (z0 + z1) / 2, .002, .004, z1 - z0, .003, GROUT, "floor")
    for z in np.arange(math.ceil(z0 / .8) * .8, z1, .8):
        if z > z0 + .01:
            box("Floor grout Z", (x0 + x1) / 2, float(z), .002, x1 - x0, .004, .003, GROUT, "floor")

# Measured outer boundary. Window sill collision keeps every outer edge closed.
wall("Bedroom north", 0, 0, 3.96, .14)
window_wall("Ensuite north window", "x", .07, 3.96, 5.94, 4.28, 5.53, 1.1)
wall("Upper notch east return", 5.80, .14, 5.94, .89)
window_wall("Kitchen north window", "x", .96, 5.94, 7.82, 6.25, 7.50, .95)
window_wall("Second north window", "x", .96, 7.82, 9.89, 8.10, 9.58, 1.0)
window_wall("Study north window", "x", .96, 9.89, 12.91, 10.12, 12.50, .85)
wall("Study east", 12.77, .89, 12.91, 4.17)
window_wall("Bath east window", "z", 12.84, 4.17, 6.14, 5.10, 5.80, 1.0)
wall("Right south edge", 9.68, 6.0, 12.77, 6.14)
wall("Entry notch east return", 9.68, 5.80, 9.82, 6.0)
wall("Entry front jamb west", 8.26, 5.66, 8.55, 5.80)
wall("Entry front jamb east", 9.42, 5.66, 9.68, 5.80)
box("Entry security door", 8.985, 5.735, 1.15, .87, .08, 2.30, BLACK, "wall")
footprint("walls", "Entry boundary", 8.55, 5.66, 9.42, 5.80)
wall("Entry notch west return", 8.12, 5.80, 8.26, 6.32)
wall("Central south edge", 5.74, 6.18, 8.12, 6.32)
wall("Balcony east return", 5.60, 6.32, 5.74, 7.53)
window_wall("Balcony glazing", "x", 7.46, 0, 5.60, .32, 5.30, .16)
window_wall("Bedroom west bay", "z", .07, 0, 3.635, .64, 2.78, .52)
wall("Living west", 0, 3.635, .14, 6.25)
wall("Balcony west", 0, 6.25, .14, 7.53)

# Internal divisions remain estimates; door holes are open in both mesh and collision.
partition_x("Primary dressing opening", 3.96, .14, 3.635, 2.24, 3.25)
partition_z("Ensuite entry", 2.14, 4.03, 5.80, 4.18, 5.12)
partition_z("Bedroom entry", 3.635, .14, 4.20, 2.90, 3.80)
partition_z("Dressing living entry", 3.635, 4.20, 5.80, 4.65, 5.65)
wall("Kitchen west", 5.87, .89, 6.01, 3.7)
wall("Kitchen second divider", 7.75, .89, 7.89, 3.7)
partition_z("Kitchen glass opening", 3.7, 6.01, 7.75, 6.45, 7.45)
for x in (6.45, 7.45):
    box("Kitchen slim black door jamb", x, 3.7, 1.14, .025, .04, 2.28, BLACK, "wall")
box("Kitchen parked sliding glass", 6.22, 3.70, 1.12, .40, .02, 2.22, GLASS, "wall")
partition_z("Second bedroom entry", 3.7, 7.89, 9.82, 8.0, 8.95)
wall("Study west", 9.82, .89, 9.96, 4.17)
partition_z("Study entry", 4.17, 9.96, 12.77, 10.10, 10.95)
partition_x("Bath entry", 10.99, 4.24, 6.0, 4.57, 5.53, True)

# Soft-corner balcony opening; the passage on the sofa's east side stays open.
for x0, x1 in ((.14, .40), (5.34, 5.60)):
    wall("Balcony portal pier " + str(x0), x0, 6.17, x1, 6.32)
box("Balcony portal head", 2.87, 6.25, 2.60, 4.94, .16, .20, WALL, "wall")
for sign, center in ((-1, .70), (1, 5.04)):
    points = [(center + sign * .30, 2.12), (center + sign * .30, 2.5), (center, 2.5)]
    points += [(center + sign * .30 * math.cos(a), 2.12 + .30 * math.sin(a)) for a in np.linspace(math.pi / 2, 0, 12)]
    vertices = [(x, -z, y) for z in (6.17, 6.32) for x, y in points]
    n = len(points)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new("Rounded portal profile")
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new("Balcony rounded corner", mesh); SCENE.collection.objects.link(obj)
    finish(obj, obj.name, WALL, "wall")

# Living: sofa faces TV wall, with a clear 1.4 m east-side route to the balcony.
rug("Living woven rug", 1.80, 5.0, 3.05, 2.18)
box("Living sofa plinth", 1.76, 5.82, .15, 2.60, .80, .18, DARK_WOOD, bevel=.025)
box("Living sofa base", 1.76, 5.80, .37, 2.70, .91, .36, LINEN, bevel=.09)
box("Living sofa back", 1.76, 6.15, .72, 2.70, .20, .64, LINEN, bevel=.08)
for x in (.48, 3.04):
    box("Living sofa arm", x, 5.80, .61, .19, .91, .45, LINEN, bevel=.07)
for i in range(3):
    box("Living sofa seat", .93 + i * .83, 5.73, .59, .78, .66, .17, LINEN, bevel=.065)
for i, x in enumerate((.75, 1.2, 2.35, 2.8)):
    box("Living loose cushion", x, 6.01, .90, .42, .18, .42, LINEN if i % 2 else TAUPE, bevel=.07)
footprint("furniture", "living_sofa", .385, 5.345, 3.135, 6.255)
box("Living raised TV panel", 1.58, 3.79, 1.49, 2.39, .12, 1.32, IVORY, "wall", .006)
box("Living TV frame", 1.58, 3.865, 1.50, 1.55, .055, .89, BLACK, "wall", .01)
box("Living TV screen", 1.58, 3.898, 1.50, 1.49, .009, .83, SCREEN, "wall", .003)
cabinet("living_console", 1.58, 3.95, 2.38, .40, .28, "south", 4, .04, WALNUT)
for y in (.81, 2.17):
    box("Living TV backlight", 1.58, 3.79, y, 2.35, .025, .018, GLOW, "overhead")
books("Living console", .62, 4.03, .33, 5)
for y in (.16, .53):
    side = cylinder("Living oval side tray", 3.57, 5.66, y, .32, .035, WALNUT, vertices=32)
    side.scale.x = .62
for z in (5.41, 5.91):
    cylinder("Living trolley upright", 3.57, z, .34, .012, .50, STEEL)
footprint("furniture", "living_side_table", 3.36, 5.33, 3.78, 5.99)
cabinet("living_white_storage", 5.31, 4.16, .56, .66, 2.42, "west", 2)
artwork("Living relief", "z", 1.7, 6.13, 1.77, .65, .80)
cove("Living", [.14, 3.77, 5.60, 6.18])
cylinder("Living disk ceiling light", 2.7, 5.0, 2.56, .27, .06, IVORY, "overhead")
cylinder("Living disk diffuser", 2.7, 5.0, 2.52, .23, .02, GLOW, "overhead")
for i in range(8):
    box("Living linear AC grille", 2.7, 6.02 + i * .015, 2.48, 2.45, .006, .04, BLACK, "overhead")

# Balcony: shallow laundry run and tall cupboard, preserving the measured footprint.
box("Balcony laundry counter", 1.10, 6.90, .91, 1.50, .60, .05, STONE)
box("Balcony washing machine", .72, 6.90, .45, .62, .58, .86, CERAMIC, bevel=.025)
washer = cylinder("Balcony washer black door", .72, 6.595, .46, .22, .025, BLACK, vertices=32)
washer.rotation_euler.x = math.pi / 2
washer_glass = cylinder("Balcony washer glass", .72, 6.577, .46, .17, .025, SCREEN, vertices=32)
washer_glass.rotation_euler.x = math.pi / 2
box("Balcony sink", 1.48, 6.90, .94, .49, .44, .025, STEEL, bevel=.04)
footprint("furniture", "balcony_laundry", .35, 6.58, 1.85, 7.21)
cabinet("balcony_tall_storage", 5.20, 6.91, .62, .88, 2.44, "west", 2)
# Curtains align with the glazing, not across the internal passage.
for i in range(52):
    box("Balcony sheer pleat", .36 + i * .094, 7.31 + math.sin(i * 1.7) * .02, 1.38, .092, .02, 2.42, SHEER, "wall", .006)
for x in (2.2, 4.1):
    box("Balcony drying rail", x, 6.95, 2.48, .025, .70, .025, IVORY, "overhead")

# Dining: compact four-seat independent table, not an island.
box("Dining rounded stone tabletop", 6.95, 4.98, .77, .87, 1.36, .065, STONE, bevel=.12)
for z in (4.55, 5.41):
    box("Dining walnut slab leg", 6.95, z, .37, .66, .10, .74, WALNUT, bevel=.02)
footprint("furniture", "dining_table", 6.515, 4.30, 7.385, 5.66)
for x in (6.27, 7.63):
    for z in (4.60, 5.36):
        box("Dining woven seat", x, z, .46, .39, .39, .07, TAUPE, bevel=.02)
        back = x + (-.185 if x < 6.95 else .185)
        for y in (.68, .79, .90):
            box("Dining black back slat", back, z, y, .03, .41, .03, BLACK, bevel=.006)
        for dx in (-.16, .16):
            for dz in (-.16, .16):
                box("Dining black chair leg", x + dx, z + dz, .24, .025, .025, .48, BLACK)
        for i in range(8):
            box("Dining seat woven stripe", x - .16 + i * .045, z, .499, .008, .35, .003, DARK_WOOD)
        footprint("furniture", "dining_chair_" + str(x) + "_" + str(z), x - .21, z - .21, x + .21, z + .21)
cylinder("Dining pendant cord", 6.95, 4.98, 2.25, .009, .9, BLACK, "overhead")
ellipsoid("Dining mushroom pendant", 6.95, 4.98, 1.83, .62, .62, .30, IVORY, "overhead")
cylinder("Dining pendant diffuser", 6.95, 4.98, 1.72, .26, .015, GLOW, "overhead")
cylinder("Dining vase", 6.95, 4.98, .93, .065, .25, CERAMIC)
for i in range(4):
    a = i * 1.6
    ellipsoid("Dining foliage", 6.95 + math.cos(a) * .12, 4.98 + math.sin(a) * .12, 1.12, .21, .09, .11, LEAF)
cove("Dining", [5.94, 3.77, 8.12, 6.18])
cabinet("entry_white_storage", 10.53, 5.58, .55, .72, 2.42, "west", 2)
plant("Entry olive tree", 9.87, 5.65, .95)

# Compact enclosed kitchen: L counters with realistic .55 m working depth.
cabinet("kitchen_sink_base", 6.80, 1.32, 1.45, .55, .78, "south", 3, .08, WALNUT)
box("Kitchen north stone worktop", 6.80, 1.32, .89, 1.50, .59, .05, STONE)
cabinet("kitchen_cooktop_base", 6.28, 2.40, .54, 1.55, .78, "east", 3, .08, WALNUT)
box("Kitchen west stone worktop", 6.28, 2.40, .89, .58, 1.60, .05, STONE)
box("Kitchen double sink rim", 6.87, 1.35, .925, .74, .42, .025, STEEL, bevel=.02)
for x in (6.69, 7.05):
    box("Kitchen sink basin", x, 1.35, .94, .30, .32, .015, BLACK, bevel=.04)
cylinder("Kitchen tap stem", 6.87, 1.14, 1.08, .023, .30, STEEL)
box("Kitchen tap spout", 6.87, 1.23, 1.22, .03, .19, .03, STEEL)
box("Kitchen black cooktop", 6.31, 2.34, .934, .43, .72, .025, SCREEN, bevel=.01)
for z in (2.14, 2.55):
    cylinder("Kitchen burner", 6.32, z, .96, .09, .025, STEEL)
    box("Kitchen hob support X", 6.32, z, .99, .25, .02, .015, BLACK)
    box("Kitchen hob support Z", 6.32, z, .99, .02, .25, .015, BLACK)
cabinet("kitchen_upper", 6.21, 2.4, .36, 1.55, .67, "east", 3, 1.82)
box("Kitchen hood", 6.41, 2.34, 1.84, .49, .75, .085, STEEL, "overhead")
box("Kitchen upper strip", 6.40, 2.4, 1.81, .02, 1.48, .02, GLOW, "overhead")
box("Kitchen fridge", 7.36, 1.99, 1.04, .64, .66, 2.05, IVORY, bevel=.025)
for z in (1.825, 2.155):
    box("Kitchen fridge door", 7.03, z, 1.07, .025, .31, 1.91, CERAMIC, bevel=.008)
box("Kitchen fridge seam", 7.01, 1.99, 1.07, .01, .015, 1.88, BLACK)
footprint("furniture", "kitchen_fridge", 7.01, 1.65, 7.70, 2.33)
for y in np.arange(1.04, 2.35, .10):
    box("Kitchen blind slat", 6.875, 1.04, float(y), 1.19, .018, .055, SHEER, "wall")

# Main bedroom keeps the bay at the bed's side, and dressing access east of the bed.
rug("Primary rug", 1.91, 1.62, 2.55, 2.85)
bed("bedroom_bed", 1.91, 1.48, width=1.72, length=2.04, throw=BLACK)
box("Bedroom walnut headboard", 1.91, .30, .89, 2.75, .12, 1.02, WALNUT, "wall")
box("Bedroom headboard glow", 1.91, .37, 1.42, 2.72, .025, .02, GLOW, "overhead")
for x in (.69, 3.13):
    cabinet("bedroom_nightstand_" + str(x), x, .64, .46, .46, .47, "south", 1, .12, WALNUT)
cabinet("bedroom_wardrobe", 1.28, 3.25, 1.90, .48, 2.48, "north", 4)
box("Bedroom bay seat", .29, 1.71, .54, .34, 2.10, .12, IVORY)
footprint("furniture", "bedroom_bay", .12, .66, .46, 2.76)
for z in (.65, 2.78):
    box("Bedroom side drape", .22, z, 1.52, .05, .16, 2.10, TAUPE, "wall")
cylinder("Bedroom pendant cord", 3.13, .64, 2.09, .008, .8, BLACK, "overhead")
ellipsoid("Bedroom opal pendant", 3.13, .64, 1.64, .28, .28, .22, IVORY, "overhead")
cylinder("Bedroom ceiling disk", 1.91, 1.60, 2.59, .25, .06, IVORY, "overhead")
cabinet("dressing_wardrobe", 5.57, 2.88, .43, 1.12, 2.48, "west", 2)

# Secondary bedroom: downsized bed and bedside cupboard, rather than stretched furniture.
rug("Second rug", 9.10, 2.49, 1.30, 2.04)
bed("second_bed", 9.13, 2.50, width=1.16, length=1.88)
box("Second upholstered head", 9.13, 1.47, .82, 1.23, .12, .88, LINEN, bevel=.05)
cabinet("second_white_wardrobe", 8.19, 1.65, .40, 1.08, 2.43, "east", 2)
box("Second walnut niche back", 8.45, 1.39, 1.26, .025, .49, .62, WALNUT, "wall")
box("Second niche shelf", 8.52, 1.39, .94, .19, .49, .035, WALNUT)
box("Second niche glow", 8.47, 1.39, 1.58, .02, .46, .015, GLOW, "overhead")
for y in np.arange(1.08, 2.35, .11):
    box("Second roman blind fold", 8.84, 1.045, float(y), 1.42, .02, .065, SHEER, "wall")
box("Second blind valance", 8.84, 1.07, 2.37, 1.46, .06, .27, TAUPE, "wall")
cylinder("Second disk lamp", 8.85, 2.35, 2.59, .23, .06, IVORY, "overhead")

# Study / guest room: bed against east wall, writing desk at the north window.
rug("Study woven rug", 11.70, 2.60, 2.10, 1.55)
bed("study_daybed", 11.85, 2.60, width=1.12, length=1.78, rotate=-math.pi / 2)
cabinet("study_white_wardrobe", 12.18, 1.38, .95, .52, 2.43, "south", 2)
box("Study walnut writing desk", 10.52, 1.37, .76, 1.05, .48, .09, WALNUT, bevel=.025)
box("Study drawers", 10.52, 1.37, .65, 1.0, .44, .18, WALNUT, bevel=.014)
footprint("furniture", "study_desk", 9.995, 1.13, 11.045, 1.61)
ellipsoid("Study upholstered seat", 10.46, 2.10, .46, .50, .50, .17, WHITE_LINEN)
box("Study upholstered back", 10.46, 2.32, .78, .48, .12, .46, WHITE_LINEN, bevel=.055)
for x in (10.28, 10.64):
    for z in (1.93, 2.27):
        cylinder("Study chair leg", x, z, .23, .023, .46, IVORY)
footprint("furniture", "study_chair", 10.19, 1.83, 10.73, 2.39)
for y in np.arange(.98, 2.35, .11):
    box("Study blind fold", 11.3, 1.045, float(y), 2.32, .02, .065, SHEER, "wall")
artwork("Study relief", "x", 12.72, 2.62, 1.77, .6, .44)
books("Study desk", 10.12, 1.37, .81, 4)
cylinder("Study task lamp base", 10.87, 1.37, .82, .075, .025, WALNUT)
box("Study task lamp stem", 10.87, 1.37, 1.0, .025, .025, .36, WALNUT)
ellipsoid("Study lamp shade", 10.87, 1.43, 1.17, .18, .21, .17, WALNUT)
cylinder("Study disk light", 11.45, 2.50, 2.59, .24, .06, IVORY, "overhead")

# Both bathrooms retain walnut drawers, mirrors, pale tiles and shower fittings.
vanity("ensuite_vanity", 5.59, 1.43, .72, "west")
toilet("ensuite_toilet", 4.39, .57)
box("Ensuite glass screen", 4.93, .60, 1.10, .012, .82, 2.2, GLASS, "wall")
footprint("walls", "ensuite_screen", 4.924, .19, 4.936, 1.01)
box("Ensuite glass trim", 4.93, .60, 2.20, .025, .82, .025, STEEL, "wall")
box("Ensuite shower rail", 5.69, .60, 1.40, .03, .03, 1.35, STEEL)
box("Ensuite shower arm", 5.51, .60, 2.08, .4, .025, .025, STEEL)
cylinder("Ensuite rain head", 5.32, .60, 2.06, .12, .025, STEEL)
box("Ensuite linear drain", 5.45, .22, .015, .55, .025, .01, STEEL, "floor")
vanity("bath_vanity", 12.52, 4.83, .75, "west")
toilet("bath_toilet", 11.55, 5.55)
box("Bath shower rail", 12.68, 5.64, 1.40, .03, .03, 1.35, STEEL)
box("Bath shower arm", 12.50, 5.64, 2.08, .4, .025, .025, STEEL)
cylinder("Bath rain head", 12.31, 5.64, 2.06, .12, .025, STEEL)
box("Bath parked frosted leaf", 11.12, 5.74, 1.1, .025, .40, 2.2, FROSTED, "wall")
for z in (5.56, 5.74, 5.92):
    box("Bath frosted black rail", 11.10, z, 1.1, .035, .018, 2.2, BLACK, "wall")
bathroom_tiles("Ensuite", 3.96, 0, 5.94, 2.14)
bathroom_tiles("Bath", 10.99, 4.17, 12.91, 6.14)
for x, z in ((4.7, 1.3), (11.8, 4.9), (6.9, 2.3)):
    box("Utility panel light", x, z, 2.63, .30, .30, .035, GLOW, "overhead")


def validate_plan():
    """Check camera clearance and connectivity against the exported collision plan."""
    obstacles = PLAN["walls"] + PLAN["furniture"]
    radius = .18
    def inside_outline(x, z):
        inside = False
        for a, b in zip(FOOTPRINT, FOOTPRINT[1:] + FOOTPRINT[:1]):
            if min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= z <= max(a[1], b[1]) and abs((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])) < 1e-8:
                return True
            if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
                inside = not inside
        return inside
    def walkable(x, z):
        return all(inside_outline(x + dx, z + dz) for dx in (-radius, 0, radius) for dz in (-radius, 0, radius)) and not any(
            item["minX"] - radius < x < item["maxX"] + radius and item["minZ"] - radius < z < item["maxZ"] + radius
            for item in obstacles)
    for room in PLAN["rooms"]:
        x, _, z = room["position"]
        assert walkable(x, z), f'Blocked camera: {room["id"]}'
    step = .10
    start = tuple(round(value / step) for value in (PLAN["rooms"][0]["position"][0], PLAN["rooms"][0]["position"][2]))
    seen, queue = {start}, deque([start])
    while queue:
        x, z = queue.popleft()
        for key in ((x - 1, z), (x + 1, z), (x, z - 1), (x, z + 1)):
            if key not in seen and walkable(key[0] * step, key[1] * step):
                seen.add(key); queue.append(key)
    for room in PLAN["rooms"]:
        x, _, z = room["position"]
        assert any(abs(ix * step - x) < .15 and abs(iz * step - z) < .15 for ix, iz in seen), f'Unreachable room: {room["id"]}'
    meshes = [obj for obj in SCENE.objects if obj.type == "MESH"]
    allowed = {"wall", "ceiling", "overhead", "furniture", "floor"}
    assert all(obj.get("presentation") in allowed for obj in meshes)
    assert not any(obj.type == "LIGHT" for obj in SCENE.objects)
    assert len(set(item["id"] for item in obstacles)) == len(obstacles)
    print(f'Validated {len(PLAN["rooms"])} reachable room viewpoints, {len(obstacles)} collision bounds, {len(meshes)} meshes.')


validate_plan()
(HERE.parent / "design-model.json").write_text(json.dumps(PLAN, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "panorama-home.blend"), compress=True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "panorama-home.glb"), export_format="GLB", export_apply=True, export_extras=True)
assert (HERE / "panorama-home.glb").stat().st_size < 8_000_000
print('Exported panorama-home.blend and panorama-home.glb; exterior follows P-07, interior details remain estimated.')
