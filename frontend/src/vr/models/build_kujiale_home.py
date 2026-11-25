"""Rebuild the public Kujiale reference as a self-contained, editable GLB.

The source supplies panoramas and a dimensioned plan, not original furniture
meshes. Interior dimensions and furnishings are reconstructed estimates.
"""
from pathlib import Path
import json

# Reuse the original primitive/export helpers without constructing or replacing
# the historical model. Keep its asset and design JSON intact for saved versions.
HERE = Path(__file__).resolve().parent
legacy = HERE / "build_panorama_home.py"
exec(compile(legacy.read_text().split("# Ground and ceiling")[0], str(legacy), "exec"))
PLAN = json.loads((HERE.parent / "kujiale-design-model.json").read_text())
PLAN["walls"] = []
PLAN["furniture"] = []
PLAN["estimated"] = True
PLAN["source"]["layoutDrawing"] = "docs/reference/floor-plan-p07.jpg"
PLAN["source"]["layoutBasis"] = "P-07 dimensions in metres; unlabelled furniture curves and heights estimated from the drawing and panorama"
ROOM_BOUNDS = {
    "living": [1.70, 3.74, 5.74, 7.53],
    "balcony": [0, 3.74, 1.70, 7.53],
    "bedroom": [0, 0, 3.96, 3.50],
    "ensuite": [3.96, 0, 5.94, 2.14],
    "dressing": [3.96, 2.14, 5.94, 3.50],
    "kitchen": [5.94, .89, 9.89, 2.50],
    "dining": [5.94, 2.50, 9.89, 4.24],
    "entry": [5.74, 4.24, 9.89, 5.80],
    "study": [9.89, .89, 12.91, 4.24],
    "washroom": [9.89, 4.24, 10.99, 6.14],
    "bath": [10.99, 4.24, 12.91, 6.14],
}
for room in PLAN["rooms"]:
    room["bounds"] = ROOM_BOUNDS[room["id"]]
    x0, z0, x1, z1 = room["bounds"]
    room["position"] = [(x0+x1)/2, 1.62, (z0+z1)/2]
    room["target"] = [(x0+x1)/2, 1, (z0+z1)/2]
FOOTPRINT = PLAN["footprint"]
HEIGHT = PLAN["height"]
SCENE["sourceUrl"] = PLAN["source"]["url"]
SCENE["estimated"] = True
SCENE["provenance"] = "Reconstructed from public images and drawing; original source geometry unavailable"

CHARCOAL = material("Charcoal woven sofa", "#34312F", .95)
CAMEL = material("Cognac linen cushions", "#B28D68", .91)
GREEN = material("Sage glazed tiles", "#C5CCB9", .38)
BRASS = material("Aged brass", "#B59860", .3, .65)
WALNUT = material("Honey oak veneer", "#A17A50", .59)
TEXTILE = material("Ivory woven rug", "#E4DFCE", .96)
IVORY = material("Warm framed cabinetry", "#F0ECE2", .63)
FLOOR = material("Herringbone oak floor", "#A7825F", .58)
texture_material(WALNUT, "Kujiale honey oak grain", (.64, .47, .31))
texture_material(CHARCOAL, "Kujiale charcoal weave", (.21, .20, .19), True)
texture_material(CAMEL, "Kujiale camel weave", (.68, .51, .34), True)


def packed_pattern(mat, name, rgb):
    h, w, _ = rgb.shape
    image = bpy.data.images.new(name, width=w, height=h)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])


# A repeating diagonal parquet weave. UVs are in metres, shared by all floor
# faces, so plank scale and direction do not change between rooms.
y, x = np.mgrid[0:1024, 0:1024]
u, v = (x + y) / 1.4142, (x - y) / 1.4142
gx, gy = np.floor(u / 48).astype(int), np.floor(v / 48).astype(int)
horizontal = (gx + gy) % 8 < 4
grain = np.where(horizontal, np.sin(v * .45) * .015, np.sin(u * .45) * .015)
board = .9 + .12 * np.sin(np.where(horizontal, gy * 37 + gx // 4 * 17, gx * 37 + gy // 4 * 17))
seam = np.where(horizontal, (np.mod(v, 48) < 1.5) | (np.mod(u, 192) < 1.5), (np.mod(u, 48) < 1.5) | (np.mod(v, 192) < 1.5))
shade = np.where(seam, .62, board + grain)
packed_pattern(FLOOR, "Packed diagonal oak parquet", shade[:, :, None] * np.array([.66, .49, .33]))

outline_slab("Oak structural floor", -.16, 0, FLOOR, "floor")
slab = bpy.data.objects["Oak structural floor"]
uv = slab.data.uv_layers.new(name="Metre parquet UV")
for face in slab.data.polygons:
    for idx in face.loop_indices:
        co = slab.data.vertices[slab.data.loops[idx].vertex_index].co
        uv.data[idx].uv = (co.x / 2.8, -co.y / 2.8)
outline_slab("Ceiling", HEIGHT, HEIGHT + .08, WALL, "ceiling")

# Exterior and actual room divisions: a larger primary suite, a study and open
# kitchen/dining occupy the reference's floor plan; there is no second bedroom.
window_wall("Bedroom west bay", "z", .12, 0, 3.74, .55, 3.25, .5)
window_wall("Balcony west glazing", "z", .12, 3.74, 7.53, 4.0, 7.10, .12)
wall("Suite north", 0, 0, 5.94, .24)
wall("Upper step", 5.70, .24, 5.94, .89)
window_wall("Kitchen north windows", "x", 1.01, 5.94, 9.89, 6.34, 9.35, .95)
wall("Study north", 9.89, .89, 12.91, 1.13)
window_wall("Study east window", "z", 12.79, 1.13, 4.24, 1.60, 3.50, .65)
window_wall("Bath east window", "z", 12.79, 4.24, 6.14, 4.90, 5.65, 1.2)
for i, (a, b) in enumerate(zip(FOOTPRINT[4:], FOOTPRINT[5:] + [FOOTPRINT[0]])):
    if a == [0, 7.53]:
        continue
    if a[1] == b[1]:
        wall(f"South outline {i}", min(a[0], b[0]), a[1] - .14, max(a[0], b[0]), a[1])
    elif a[0] == b[0]:
        wall(f"South step {i}", a[0] - .14, min(a[1], b[1]), a[0], max(a[1], b[1]))
partition_z("Primary suite entry", 3.62, .24, 5.94, 2.98, 3.90)
wall("Suite east partition", 5.70, .24, 5.94, 3.74)
partition_x("Ensuite partition", 3.96, .24, 2.14, 1.30, 2.02)
wall("Ensuite south", 4.02, 2.02, 5.70, 2.14)
partition_x("Study glazed divider", 9.955, 1.13, 4.24, 3.08, 4.04, True)
wall("Study bath divider", 9.89, 4.11, 12.67, 4.24)
partition_x("Bathroom door wall", 11.05, 4.24, 5.90, 4.94, 5.69)
# Park these leaves on the north side; the helper's south parking crosses the
# study/vanity wall and the bathroom's exterior boundary at these short returns.
bpy.data.objects["Study glazed divider parked door"].location.y = -(3.08-.36)
bpy.data.objects["Bathroom door wall parked door"].location.y = -(4.94-.36)
bpy.data.objects["Ensuite partition parked door"].location.y = -(1.30-.36)


def framed_panel(name, x, z, width, depth, height, mat=IVORY):
    box(name, x, z, height / 2 + .08, width, depth, height, mat, bevel=.012)
    # Four narrow rails retain the framed cabinet character in the panorama.
    face_z = z + depth / 2 + .012
    for px in [x - width / 2 + .025, x + width / 2 - .025]:
        box(name + " upright", px, face_z, height / 2 + .08, .018, .016, height - .05, mat, bevel=.004)
    for py in [.105, height + .055]:
        box(name + " rail", x, face_z, py, width - .05, .016, .018, mat, bevel=.004)


def curtain(name, x0, x1, z, height=2.5):
    for idx, px in enumerate(np.arange(x0, x1, .065)):
        box(name, float(px), z + .035 * math.sin(idx), height / 2 + .08, .075, .065, height, SHEER, bevel=.025)


def shelf(name, x, z, width, depth=.32, height=2.5):
    box(name + " oak backing", x, z, height / 2, width, .035, height, WALNUT, "wall")
    for py in [.12, .58, 1.04, 1.5, 1.96, 2.42]:
        box(name + " shelf", x, z + depth / 2, py, width, depth, .035, WALNUT, bevel=.006)
    for px in [x - width / 2, x + width / 2]:
        box(name + " side", px, z + depth / 2, height / 2, .035, depth, height, WALNUT)
    books(name + " books", x - width * .25, z + depth / 2, 1.53, 5)
    ellipsoid(name + " ceramic vase", x + .18, z + .13, .77, .14, .14, .34, CERAMIC)


def polygon_slab(name, points, bottom, top, mat, presentation="furniture", bevel=.02):
    # Floor-plan Z points down; reverse clockwise Blender contours before extrusion.
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:]+points[:1])) > 0:
        points = list(reversed(points))
    n = len(points)
    vertices = [(x, -z, y) for y in (bottom, top) for x, z in points]
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, n*2))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="Metre upholstery UV")
    for face in mesh.polygons:
        for idx in face.loop_indices:
            co = mesh.vertices[mesh.loops[idx].vertex_index].co
            uv.data[idx].uv = (co.x, co.y if abs(face.normal.z) > .5 else co.z)
    obj = bpy.data.objects.new(name, mesh)
    SCENE.collection.objects.link(obj)
    finish(obj, name, mat, presentation)
    if bevel:
        modifier = obj.modifiers.new("Soft upholstery edge", "BEVEL")
        modifier.width, modifier.segments = bevel, 3
    return obj


def curved_strip(name, a0, a1, inner, outer, bottom, top, mat):
    angles = np.linspace(math.radians(a0), math.radians(a1), 42)
    def arc(radii, order):
        return [[3.50+radii[0]*math.cos(a), 6.12+radii[1]*math.sin(a)] for a in order]
    points = arc(outer, angles) + arc(inner, angles[::-1])
    polygon_slab(name, points, bottom, top, mat, bevel=.065)
    return points


# P-07 has a curved seating group opening toward a diagonal freestanding TV.
sofa_outline = curved_strip("living_sofa base", -30, 143, (.81, .45), (1.53, 1.08), .16, .48, CHARCOAL)
curved_strip("living_sofa curved back", -30, 143, (1.31, .90), (1.55, 1.10), .44, .87, CHARCOAL)
for index, (a0, a1) in enumerate([(-27, 12), (15, 54), (57, 96), (99, 140)]):
    curved_strip("living_sofa cushion", a0, a1, (.83, .47), (1.29, .88), .48, .62, CHARCOAL)
    a = math.radians((a0+a1)/2)
    pillow = box("living_sofa camel pillow", 3.50+1.25*math.cos(a), 6.12+.88*math.sin(a), .84, .48, .16, .42, CAMEL if index % 2 else WHITE_LINEN, bevel=.065)
    pillow.rotation_euler.z = -a-math.pi/2
footprint("furniture", "living_sofa", min(p[0] for p in sofa_outline), min(p[1] for p in sofa_outline), max(p[0] for p in sofa_outline), max(p[1] for p in sofa_outline))
PLAN["furniture"][-1]["outline"] = [[round(x, 4), round(z, 4)] for x, z in sofa_outline]
rug_outline = [[3.0+1.72*math.cos(a)*(1+.09*math.sin(3*a)), 5.63+1.60*math.sin(a)] for a in np.linspace(0, 2*math.pi, 100, endpoint=False)]
polygon_slab("living organic cream rug", rug_outline, .006, .02, TEXTILE, "floor", 0)
cylinder("living round coffee pedestal", 3.15, 5.70, .25, .20, .48, IVORY, vertices=40)
cylinder("living oak coffee top", 3.15, 5.70, .51, .37, .055, WALNUT, vertices=64)
for px in [2.87, 3.12]:
    cylinder("Coffee cup", px, 5.66, .58, .05, .09, CERAMIC, vertices=24)
for px, width in [(2.22, 1.52), (4.68, 1.56)]:
    framed_panel("living_white_panel", px, 3.815, width, .35, 2.50)
shelf("living_oak_display", 5.63, 3.76, .28)
tv_x, tv_z, tv_angle = 2.03, 4.53, math.radians(20)
start = set(bpy.data.objects)
box("living TV cream bezel", 0, 0, 1.02, 1.60, .13, .90, IVORY, bevel=.055)
box("living TV dark screen", 0, .075, 1.06, 1.48, .018, .75, SCREEN, bevel=.025)
for px in [-.57, .57]:
    box("living TV tripod", px, 0, .30, .035, .38, .60, BLACK, bevel=.012)
for obj in set(bpy.data.objects)-start:
    x, y, z = obj.location
    obj.location = (tv_x+x*math.cos(tv_angle)-y*math.sin(tv_angle), -tv_z+x*math.sin(tv_angle)+y*math.cos(tv_angle), z)
    obj.rotation_euler.z += tv_angle
tv_outline = [[tv_x+x*math.cos(tv_angle)+z*math.sin(tv_angle), tv_z-x*math.sin(tv_angle)+z*math.cos(tv_angle)] for x,z in [(-.80,-.20),(.80,-.20),(.80,.20),(-.80,.20)]]
footprint("furniture", "living_tv", min(p[0] for p in tv_outline), min(p[1] for p in tv_outline), max(p[0] for p in tv_outline), max(p[1] for p in tv_outline))
PLAN["furniture"][-1]["outline"] = tv_outline

# Laundry belongs in the southwest corner, not beside the bedroom doorway.
cabinet("balcony_laundry", .80, 6.97, .72, .64, 2.5, "north", 1)
cabinet("balcony_sink", 1.43, 6.97, .54, .64, .82, "north", 1)
box("balcony sink basin", 1.43, 6.97, .94, .40, .44, .05, STEEL, bevel=.04)
for py in [.45, 1.18]:
    box("balcony white laundry machine", .80, 6.97, py, .66, .62, .66, IVORY, bevel=.035)
    door = cylinder("balcony laundry porthole", .80, 6.64, py, .22, .025, SCREEN, vertices=40)
    door.rotation_euler.x = math.pi / 2
    bpy.ops.mesh.primitive_torus_add(major_radius=.22, minor_radius=.018, major_segments=32, minor_segments=8, location=(.80, -6.62, py), rotation=(math.pi/2, 0, 0))
    finish(bpy.context.object, "balcony laundry rim", STEEL, "furniture")
plant("balcony_plant", .55, 4.4, 1.25)

# Open U-shaped kitchen with honey oak worktops, white framed fronts and island.
cabinet("kitchen_north", 7.435, 1.43, 2.99, .60, .80, "south", 5)
box("kitchen north oak worktop", 7.435, 1.43, .93, 2.99, .60, .055, WALNUT, bevel=.018)
cabinet("kitchen_west", 6.27, 2.17, .60, 1.08, .80, "east", 2)
box("kitchen west oak worktop", 6.27, 2.17, .93, .66, 1.12, .055, WALNUT, bevel=.018)
box("kitchen inset sink", 8.33, 1.43, .967, .72, .43, .025, STEEL, bevel=.035)
cylinder("kitchen chrome faucet", 8.33, 1.23, 1.12, .022, .35, STEEL)
box("kitchen hob", 6.28, 2.05, .97, .47, .69, .018, SCREEN, bevel=.018)
for zz in [1.86, 2.23]:
    cylinder("kitchen burner", 6.28, zz, .985, .115, .018, STEEL, vertices=28)
cabinet("kitchen_upper_west", 6.13, 2.1, .30, 1.6, .68, "east", 3, 1.60)
box("kitchen window oak mullion", 7.85, 1.1, 1.5, .23, .12, 2.45, WALNUT, "wall")
cabinet("kitchen_tall_oven", 6.18, 3.54, .48, .69, 2.5, "east", 1, mat=WALNUT)
for py in [1.10, 1.80]:
    box("kitchen oven black front", 6.43, 3.54, py, .025, .52, .40, SCREEN, bevel=.015)
cabinet("kitchen_fridge", 9.40, 1.48, .95, .70, 2.5, "south", 2)
box("kitchen fridge inset panel", 9.40, 1.84, 1.4, .88, .02, 2.28, IVORY, bevel=.01)
cabinet("dining_island", 8.12, 2.865, 1.60, .60, .86, "south", 3, mat=WALNUT)
box("dining pale stone island", 8.12, 2.865, .99, 1.60, .60, .10, STONE, bevel=.025)
for px in [7.72, 8.52]:
    for dx in [-.16, .16]:
        box("dining chair legs", px + dx, 2.29, .27, .03, .40, .52, BLACK, bevel=.008)
    box("dining upholstered seat", px, 2.29, .56, .46, .43, .12, WHITE_LINEN, bevel=.07)
    box("dining upholstered back", px, 2.08, .83, .46, .10, .43, WHITE_LINEN, bevel=.06)
cylinder("dining fruit bowl", 8.12, 2.865, 1.07, .20, .05, WALNUT, vertices=40)
for dx, dz in [(-.08, 0), (.06, .05), (0, -.05)]:
    ellipsoid("dining oranges", 8.12 + dx, 2.865 + dz, 1.13, .11, .11, .11, CAMEL)
for px in [6.75, 8.52]:
    for py in np.arange(1.05, 2.45, .11):
        box("Kitchen window blind", px, 1.1, float(py), 1.4, .014, .025, IVORY, "wall")

# Entry cabinetry and bench leave the central passage clear.
cabinet("entry_wardrobe", 6.71, 5.82, 2.42, .52, 2.5, "north", 4)
cabinet("dining_low_divider", 8.87, 4.065, 1.275, .35, .87, "south", 3, mat=WALNUT)
cabinet("washroom_south_storage", 10.44, 5.72, 1.01, .35, 2.5, "north", 2)
box("entry dark front door", 8.94, 5.73, 1.13, 1.02, .07, 2.26, BLACK, "wall", bevel=.02)

# Primary suite: a dark buttoned leather headboard, warm bed throw, bay seating,
# dressing cabinetry and the second source viewpoint retained as a separate zone.
bed("bedroom_bed", 2.32, 1.29, 1.8, 2.10, throw=CAMEL)
box("bedroom leather headboard", 2.32, .32, .84, 2.45, .12, 1.10, CHARCOAL, bevel=.035)
for px in np.arange(1.25, 3.42, .27):
    for py in [.55, .85, 1.15]:
        ellipsoid("bedroom leather tuft", float(px), .40, py, .22, .055, .25, CHARCOAL)
for side, px in [("left", 1.15), ("right", 3.57)]:
    cabinet("bedroom_bedside_" + side, px, .62, .44, .42, .40, "south", 1, .12, WALNUT)
cabinet("bedroom_bay_storage", .545, 1.55, .61, 2.20, .48, "east", 4)
box("bedroom bay seat pad", .545, 1.55, .61, .61, 2.2, .12, WHITE_LINEN, bevel=.04)
curtain("bedroom sheer curtains", .16, .64, 3.21)
cabinet("bedroom_south_wardrobe", 2.415, 3.34, 1.13, .60, 2.5, "north", 2)
cabinet("dressing_tall", 4.80, 3.34, 1.80, .60, 2.5, "north", 3)
cabinet("dressing_east", 5.40, 2.59, .60, .90, 2.5, "west", 2)

# Study has a long worktop and pegboard, with no invented spare bed.
cabinet("study_wardrobe", 11.345, 1.43, 2.65, .60, 2.5, "south", 5)
box("study oak desk", 11.345, 3.81, .76, 2.62, .60, .075, WALNUT, bevel=.025)
footprint("furniture", "study_desk", 10.035, 3.51, 12.655, 4.11)
for px in [10.10, 12.59]:
    box("study desk support", px, 3.81, .37, .045, .55, .72, WALNUT)
box("study pegboard", 11.345, 4.08, 1.25, 2.62, .035, .76, IVORY, "wall")
for xx in np.arange(10.15, 12.60, .10):
    for py in np.arange(.98, 1.57, .10):
        box("study pegboard hole", float(xx), 4.054, float(py), .018, .008, .018, BLACK, "wall")
for px in [10.72, 11.97]:
    box("study monitor", px, 3.95, 1.08, .65, .035, .43, SCREEN, bevel=.015)
    box("study monitor stand", px, 3.95, .86, .05, .05, .18, BLACK)
    box("study desk chair seat", px, 3.06, .48, .56, .56, .13, WHITE_LINEN, bevel=.08)
    box("study desk chair back", px, 2.82, .83, .56, .13, .57, WHITE_LINEN, bevel=.07)
    for dx in [-.20, .20]:
        box("study chair legs", px+dx, 3.06, .23, .035, .43, .46, BLACK, bevel=.008)
for py in [1.75, 2.12]:
    box("study oak floating shelf", 11.345, 3.94, py, 2.50, .30, .045, WALNUT)
    books("study books", 11.20, 3.94, py + .04, 6)

# Bathrooms: glazed small tiles, dark framed glass and independent outer vanity.
for name, bounds in [("ensuite", [4.02, .24, 5.70, 2.02]), ("bath", [11.11, 4.24, 12.67, 5.90])]:
    x0, z0, x1, z1 = bounds
    box(name + " tile floor", (x0+x1)/2, (z0+z1)/2, .009, x1-x0-.08, z1-z0-.08, .018, GREEN, "floor")
    for zz in np.arange(z0+.15, z1-.1, .13):
        box(name + " tile grout", (x0+x1)/2, float(zz), .021, x1-x0-.09, .008, .004, IVORY, "floor")
    for xx in np.arange(x0+.15, x1-.1, .13):
        box(name + " tile grout", float(xx), (z0+z1)/2, .021, .008, z1-z0-.09, .004, IVORY, "floor")
toilet("ensuite_toilet", 4.39, .70)
box("ensuite shower glass", 4.76, .71, 1.13, .025, .94, 2.2, FROSTED)
box("ensuite shower lower edge", 5.23, 1.18, 1.13, .94, .025, 2.2, FROSTED)
cylinder("ensuite shower head", 5.40, .44, 2.2, .13, .04, BLACK, vertices=32)
cylinder("ensuite shower stem", 5.53, .44, 1.50, .017, 1.25, BLACK)
vanity("ensuite_vanity", 5.45, 1.60, .80, "west")
toilet("bath_toilet", 11.48, 4.70)
box("bath shower glass", 11.77, 4.71, 1.13, .025, .94, 2.2, FROSTED)
box("bath shower edge", 11.77, 4.25, 1.13, .035, .025, 2.2, BLACK)
cylinder("bath shower head", 12.35, 5.66, 2.2, .13, .04, BLACK, vertices=32)
cylinder("bath shower stem", 12.48, 5.66, 1.50, .017, 1.25, BLACK)
cabinet("washroom_vanity", 10.44, 4.49, 1.01, .50, .47, "south", 2, .29, WALNUT)
box("washroom white counter", 10.44, 4.49, .81, 1.01, .50, .065, CERAMIC, bevel=.02)
box("washroom basin", 10.44, 4.49, .85, .66, .34, .02, STEEL, bevel=.04)
box("washroom mirror frame", 10.44, 4.28, 1.55, 1.01, .05, .85, WALNUT, "wall")
box("washroom mirror", 10.44, 4.315, 1.57, .95, .009, .73, MIRROR, "wall")
cylinder("washroom faucet", 10.44, 4.34, .99, .022, .30, STEEL)

# These checks use the dimensioned drawing, not screenshot-dependent styling.
island = next(item for item in PLAN["furniture"] if item["id"] == "dining_island")
assert math.isclose(island["maxX"]-island["minX"], 1.60)
assert math.isclose(island["maxZ"]-island["minZ"], .60)
desk = next(item for item in PLAN["furniture"] if item["id"] == "study_desk")
assert math.isclose(desk["maxX"]-desk["minX"], 2.62)
assert math.isclose(desk["maxZ"]-desk["minZ"], .60)

# All exported resources are embedded. Tag room geometry without inventing live
# device locations or decorative lights linked to real household devices.
for kind in ["walls", "furniture"]:
    assert len({item["id"] for item in PLAN[kind]}) == len(PLAN[kind]), f"Duplicate {kind} identifiers"

# Merge opaque geometry by finish and presentation after applying soft-edge
# modifiers. This keeps mobile draw calls bounded without merging glass sorting.
groups = {}
for obj in list(bpy.data.objects):
    if obj.type != "MESH":
        continue
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    matrix = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = matrix
    mat = obj.data.materials[0]
    if mat.diffuse_color[3] >= 1:
        groups.setdefault((obj.get("presentation", "furniture"), mat.name), []).append(obj)
for (presentation, finish_name), objects in groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = f"{presentation} / {finish_name}"
    obj["presentation"] = presentation

PLAN["footprintArea"] = abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(FOOTPRINT, FOOTPRINT[1:]+FOOTPRINT[:1])))/2
# Keep selectable regions and room/data bindings on the same generated geometry.
seed_path = HERE.parents[3] / "packages/contracts/kujiale-space-model.json"
seed = json.loads(seed_path.read_text())
for room in seed["rooms"]:
    room["bounds"] = ROOM_BOUNDS[room["id"]]
seed_path.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n")
(HERE.parent / "kujiale-design-model.json").write_text(json.dumps(PLAN, ensure_ascii=False, indent=2) + "\n")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "kujiale-home.blend"), compress=True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "kujiale-home.glb"), export_format="GLB", export_apply=True, export_extras=True)
assert (HERE / "kujiale-home.glb").stat().st_size < 20_000_000
print(f'Exported Kujiale reconstruction: {len(PLAN["rooms"])} zones; {len(PLAN["walls"])} wall bounds; original geometry unavailable.')
