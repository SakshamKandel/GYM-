import argparse
import bpy, sys, os, json, math, mathutils, tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
sys.path.insert(0, SCRIPT_DIR)
from classify import classify, GROUPS
from surface_regions import groups_for_region

cli = argparse.ArgumentParser(description="Build the mobile Z-Anatomy muscle GLB")
cli.add_argument(
    "--output",
    default=os.path.join(MOBILE_DIR, "assets", "anatomy", "muscles.glb"),
    help="Destination .glb path",
)
cli.add_argument(
    "--preview-dir",
    default=None,
    help="Optional directory for front/back PNGs and build_report.json (defaults to a temp folder)",
)
cli.add_argument("--decimate-ratio", type=float, default=0.45)
cli.add_argument("--forearm-cut", type=float, default=0.75)
cli.add_argument("--calf-cut", type=float, default=0.12)
cli.add_argument("--shorts-top", type=float, default=0.955)
cli.add_argument("--shorts-hem", type=float, default=0.67)
cli.add_argument("--shorts-offset", type=float, default=0.010)
script_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
args = cli.parse_args(script_args)

OUTPUT = os.path.abspath(args.output)
PREVIEW_DIR = os.path.abspath(args.preview_dir) if args.preview_dir else tempfile.mkdtemp(prefix="gym-anatomy-")
DECIM_RATIO = max(0.05, min(1.0, args.decimate_ratio))
FOREARM_CUT = args.forearm_cut
CALF_CUT = args.calf_cut
# Real garment band (model space, feet at z=0): waistband just below the
# navel, straight hem at mid-thigh, fabric standing off the skin.
SHORTS_TOP = args.shorts_top
SHORTS_HEM = args.shorts_hem
SHORTS_OFFSET = args.shorts_offset
CROTCH_Z = 0.76     # above: one torso tube; below: two leg tubes
LEG_X = 0.09        # thigh centreline for the radial outward reference
CORE_Y = 0.02       # body cross-section centre (depth axis)
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
os.makedirs(PREVIEW_DIR, exist_ok=True)

def log(*a):
    print("BUILD:", *a); sys.stdout.flush()

# distinct viewport colors per group so the render reveals the grouping
COLORS = {
 "chest":(0.90,0.20,0.20,1), "lats":(0.20,0.55,0.95,1), "middle back":(0.30,0.75,0.90,1),
 "lower back":(0.15,0.35,0.80,1), "shoulders":(0.98,0.60,0.10,1), "traps":(0.75,0.40,0.95,1),
 "biceps":(0.95,0.85,0.20,1), "triceps":(0.60,0.85,0.25,1), "forearms":(0.20,0.80,0.55,1),
 "quadriceps":(0.95,0.35,0.55,1), "hamstrings":(0.55,0.25,0.85,1), "glutes":(0.85,0.50,0.70,1),
 "calves":(0.25,0.70,0.80,1), "abdominals":(0.95,0.75,0.45,1), "adductors":(0.70,0.90,0.40,1),
 "abductors":(0.50,0.60,0.95,1), "neck":(0.90,0.55,0.55,1),
}

# --- make every collection operable + every object visible ---
def enable_all(lc):
    lc.exclude = False
    for ch in lc.children:
        enable_all(ch)
enable_all(bpy.context.view_layer.layer_collection)
for o in bpy.data.objects:
    try:
        o.hide_viewport = False; o.hide_select = False; o.hide_render = False
        o.hide_set(False)
    except Exception:
        pass

# --- find muscular system collection ---
target = None
for c in bpy.data.collections:
    if c.name.strip().startswith("4:") and "uscular system" in c.name:
        target = c; break
if not target:
    log("ERROR no muscular collection"); raise SystemExit

def all_mesh(col, acc):
    for o in col.objects:
        if o.type == 'MESH' and o.data:
            acc.append(o)
    for ch in col.children:
        all_mesh(ch, acc)
acc = []; all_mesh(target, acc)
log("muscle meshes found:", len(acc))

# A clean external silhouette lives in the atlas' body-region collection as
# small Skin-material patches. It becomes the visible body, while duplicated
# subsets become fitted highlight overlays. Detailed muscles remain hidden in
# the file solely for accurate raycast hit-testing.
surface_collection = bpy.data.collections.get("9: Regions of human body")
surface_parts = []
if surface_collection:
    for o in surface_collection.objects:
        if o.type != 'MESH' or not o.data or not o.data.polygons:
            continue
        if not any(m and m.name.startswith("Skin") for m in o.data.materials):
            continue
        # These two tiny rear patches are visible through the atlas' open
        # crotch when the one-sided skin regions are rendered DoubleSide. They
        # read as external genitalia from the front, so omit them for a clean,
        # gender-neutral training mannequin without damaging either thigh.
        if o.name.startswith("Anal region."):
            continue
        # Solidify doubles the one-sided atlas shell and is unnecessary in the
        # viewer, which renders the surface DoubleSide.
        for modifier in list(o.modifiers):
            o.modifiers.remove(modifier)
        surface_parts.append(o)
log("skin surface meshes found:", len(surface_parts))

eye_source_groups = {
    "eye whites": [bpy.data.objects.get("Sclera.l"), bpy.data.objects.get("Sclera.r")],
    "eye irises": [bpy.data.objects.get("Iris.l"), bpy.data.objects.get("Iris.r")],
}
eye_source_groups = {
    name: [o for o in objects if o and o.type == 'MESH' and o.data]
    for name, objects in eye_source_groups.items()
}

# --- classify ---
group_objs = {g: [] for g in GROUPS}
for o in acc:
    g = classify(o.name)
    if g:
        group_objs[g].append(o)

# ensure object mode
if bpy.context.view_layer.objects.active is None and bpy.data.objects:
    bpy.context.view_layer.objects.active = bpy.data.objects[0]
try:
    bpy.ops.object.mode_set(mode='OBJECT')
except Exception:
    pass

master = bpy.context.scene.collection
bpy.ops.object.select_all(action='DESELECT')

# --- join each group into one named object ---
joined = {}
for g in GROUPS:
    objs = group_objs[g]
    if not objs:
        log("WARN empty group", g); continue
    for o in objs:
        if o.name not in master.objects:
            try: master.objects.link(o)
            except Exception: pass
    bpy.ops.object.select_all(action='DESELECT')
    n = 0
    for o in objs:
        try:
            o.select_set(True); n += 1
        except Exception:
            pass
    if n == 0:
        log("WARN unselectable group", g); continue
    bpy.context.view_layer.objects.active = objs[0]
    if n > 1:
        try:
            bpy.ops.object.join()
        except Exception as e:
            log("join fail", g, e)
    jo = bpy.context.view_layer.objects.active
    jo.name = g; jo.data.name = g
    joined[g] = jo
log("joined groups:", len(joined))

# Duplicate classified skin patches before joining the base surface. A patch
# may belong to more than one training group (for example the gluteal region
# supports both glutes and abductors), so every overlay owns its mesh data.
overlay_parts = {g: [] for g in GROUPS}
for source in surface_parts:
    for group in groups_for_region(source.name):
        duplicate = source.copy()
        duplicate.data = source.data.copy()
        duplicate.name = "highlight %s part" % group
        master.objects.link(duplicate)
        overlay_parts[group].append(duplicate)

# Duplicate the pelvis/upper-thigh skin patches as the training-short fabric
# before the surface join consumes the originals. The anal patches (omitted
# from the visible skin) are included here so the fabric closes the rear of
# the atlas' open crotch.
SHORTS_TOKENS = (
    "gluteal region", "gluteal fold", "anal region", "hip region",
    "inguinal region", "hypogastric region", "femoral triangle",
    "sacral region", "anterior region of thigh", "posterior region of thigh",
)
shorts_parts = []
if surface_collection:
    for o in surface_collection.objects:
        if o.type != 'MESH' or not o.data or not o.data.polygons:
            continue
        if not any(m and m.name.startswith("Skin") for m in o.data.materials):
            continue
        if not any(t in o.name.lower() for t in SHORTS_TOKENS):
            continue
        duplicate = o.copy()
        duplicate.data = o.data.copy()
        duplicate.name = "shorts part"
        for modifier in list(duplicate.modifiers):
            duplicate.modifiers.remove(modifier)
        master.objects.link(duplicate)
        shorts_parts.append(duplicate)
log("shorts source patches:", len(shorts_parts))
if not shorts_parts:
    log("ERROR no shorts source patches"); raise SystemExit

# --- join all skin patches into one clean, non-pickable body surface ---
surface_obj = None
if surface_parts:
    for o in surface_parts:
        if o.name not in master.objects:
            try: master.objects.link(o)
            except Exception: pass
    bpy.ops.object.select_all(action='DESELECT')
    selected_surface = []
    for o in surface_parts:
        try:
            o.select_set(True)
            selected_surface.append(o)
        except Exception:
            pass
    if selected_surface:
        bpy.context.view_layer.objects.active = selected_surface[0]
        if len(selected_surface) > 1:
            try:
                bpy.ops.object.join()
            except Exception as e:
                log("skin join fail", e)
        surface_obj = bpy.context.view_layer.objects.active
        surface_obj.name = "body surface"
        surface_obj.data.name = "body surface"
        log("joined body surface")

overlay_objects = []
overlay_report = {}
for group in GROUPS:
    parts = overlay_parts[group]
    if not parts:
        log("WARN empty surface overlay", group)
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        try:
            bpy.ops.object.join()
        except Exception as e:
            log("overlay join fail", group, e)
    overlay = bpy.context.view_layer.objects.active
    overlay.name = "highlight %s" % group
    overlay.data.name = overlay.name
    overlay_objects.append(overlay)
    overlay_report[group] = sum(len(p.vertices) - 2 for p in overlay.data.polygons)
log("joined surface overlays:", len(overlay_objects))

eye_objects = []
for eye_name, eye_parts in eye_source_groups.items():
    if not eye_parts:
        continue
    for o in eye_parts:
        if o.name not in master.objects:
            try: master.objects.link(o)
            except Exception: pass
        for modifier in list(o.modifiers):
            o.modifiers.remove(modifier)
    bpy.ops.object.select_all(action='DESELECT')
    for o in eye_parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = eye_parts[0]
    if len(eye_parts) > 1:
        try:
            bpy.ops.object.join()
        except Exception as e:
            log("eye join fail", eye_name, e)
    eye_obj = bpy.context.view_layer.objects.active
    eye_obj.name = eye_name
    eye_obj.data.name = eye_name
    eye_objects.append(eye_obj)
log("joined eye meshes:", len(eye_objects))

# Assemble real training shorts from the duplicated patches: join, stitch the
# patch seams, inflate the sheet off the skin so it reads as fabric rather
# than paint, then make straight waistband and hem cuts.
import bmesh

def outward_normal(vert):
    """Vertex normal, sign-corrected to point away from the torso/leg axis.

    The atlas' disconnected patches have inconsistent winding, so a raw
    normal can face into the body; a radial reference makes inflation safe.
    """
    cx = 0.0 if vert.co.z >= CROTCH_Z else (LEG_X if vert.co.x >= 0 else -LEG_X)
    radial = mathutils.Vector((vert.co.x - cx, vert.co.y - CORE_Y, 0.0))
    normal = vert.normal.copy()
    if radial.length_squared > 1e-9 and normal.dot(radial.normalized()) < 0:
        normal.negate()
    return normal

bpy.ops.object.select_all(action='DESELECT')
for o in shorts_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = shorts_parts[0]
if len(shorts_parts) > 1:
    try:
        bpy.ops.object.join()
    except Exception as e:
        log("shorts join fail", e)
shorts_obj = bpy.context.view_layer.objects.active
shorts_obj.name = "modesty shorts"
shorts_obj.data.name = "modesty shorts"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

shorts_bm = bmesh.new()
shorts_bm.from_mesh(shorts_obj.data)
bmesh.ops.remove_doubles(shorts_bm, verts=shorts_bm.verts, dist=0.0015)
bmesh.ops.recalc_face_normals(shorts_bm, faces=shorts_bm.faces)
shorts_bm.normal_update()
for v in shorts_bm.verts:
    v.co += outward_normal(v) * SHORTS_OFFSET
for plane_z, clear_outer in ((SHORTS_TOP, True), (SHORTS_HEM, False)):
    bmesh.ops.bisect_plane(
        shorts_bm,
        geom=shorts_bm.verts[:] + shorts_bm.edges[:] + shorts_bm.faces[:],
        plane_co=(0.0, 0.0, plane_z),
        plane_no=(0.0, 0.0, 1.0),
        clear_outer=clear_outer,
        clear_inner=not clear_outer,
    )
shorts_bm.to_mesh(shorts_obj.data)
shorts_bm.free()

# A flat ellipsoid plugs the atlas' patchless pubic triangle, which would
# otherwise stay a see-through hole in both the skin and the fabric.
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=24,
    ring_count=12,
    radius=1.0,
    location=(0.0, -0.055, 0.78),
)
modesty_bridge = bpy.context.object
modesty_bridge.name = "modesty bridge"
modesty_bridge.data.name = "modesty bridge"
modesty_bridge.scale = (0.05, 0.004, 0.06)
for poly in modesty_bridge.data.polygons:
    poly.use_smooth = True
log("created offset training shorts and pubic bridge")

# --- delete everything that is not a joined group (data API: reliable regardless
#     of view-layer/selection state) ---
keepset = set(joined.values())
if surface_obj:
    keepset.add(surface_obj)
keepset.update(eye_objects)
keepset.update(overlay_objects)
keepset.add(shorts_obj)
keepset.add(modesty_bridge)
for o in list(bpy.data.objects):
    if o not in keepset:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass
log("remaining objects:", len(bpy.data.objects))

# --- apply transforms, strip materials, decimate, smooth, color ---
report = {}
for g, o in joined.items():
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    except Exception as e:
        log("apply fail", g, e)
    o.data.materials.clear()
    # weld coincident verts (from joining L/R + duplicate parts) + consistent normals.
    # No smoothing modifier — it blurs the muscle definition; keep the real detail.
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.mesh.merge_by_distance(threshold=0.0006)
        except Exception:
            # Blender 3.x compatibility.
            bpy.ops.mesh.remove_doubles(threshold=0.0006)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as e:
        log("weld fail", g, e)
    t0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if DECIM_RATIO < 1.0:
        m = o.modifiers.new("dec", "DECIMATE"); m.decimate_type = 'COLLAPSE'; m.ratio = DECIM_RATIO
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:
            log("decimate fail", g, e)
    t1 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    report[g] = [t0, t1]
    for poly in o.data.polygons:
        poly.use_smooth = True
    o.hide_render = False; o.hide_viewport = False
    o.color = COLORS.get(g, (0.6, 0.6, 0.6, 1))

if surface_obj:
    bpy.ops.object.select_all(action='DESELECT')
    surface_obj.select_set(True)
    bpy.context.view_layer.objects.active = surface_obj
    try:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    except Exception as e:
        log("skin transform fail", e)
    surface_obj.data.materials.clear()
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.mesh.merge_by_distance(threshold=0.00001)
        except Exception:
            bpy.ops.mesh.remove_doubles(threshold=0.00001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as e:
        log("skin weld fail", e)
    skin_before = sum(len(p.vertices) - 2 for p in surface_obj.data.polygons)
    skin_after = skin_before
    for poly in surface_obj.data.polygons:
        poly.use_smooth = True
    surface_obj.hide_render = False
    surface_obj.hide_viewport = False
    surface_obj.color = (0.48, 0.34, 0.28, 1)
    log("body surface tris:", skin_after)

for overlay in overlay_objects:
    bpy.ops.object.select_all(action='DESELECT')
    overlay.select_set(True)
    bpy.context.view_layer.objects.active = overlay
    try:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    except Exception as e:
        log("overlay transform fail", overlay.name, e)
    overlay.data.materials.clear()
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.mesh.merge_by_distance(threshold=0.00001)
        except Exception:
            bpy.ops.mesh.remove_doubles(threshold=0.00001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as e:
        log("overlay weld fail", overlay.name, e)
    for poly in overlay.data.polygons:
        poly.use_smooth = True
    overlay.hide_viewport = False
    overlay.hide_render = True
    overlay.color = (0.95, 0.12, 0.08, 1)

# Lift the highlight zones that sit under the shorts clear of the fabric
# inside the garment band (with a smooth ramp at the hem and waistband) so
# glute/quad/hamstring heat maps stay visible on top of the shorts instead of
# underneath them. Uncovered groups (the forearms hang through the same
# z-band) must stay fitted to the skin.
OVERLAY_LIFT = SHORTS_OFFSET + 0.004
SHORTS_COVERED = {
    "quadriceps", "hamstrings", "glutes", "adductors", "abductors",
    "abdominals", "lower back",
}

def _smooth(edge0, edge1, value):
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)

def shorts_band_weight(z):
    # Fully lifted just BELOW the hem: if the ramp were centred on the hem,
    # the overlay would still sit under the fabric where it crosses the edge
    # and the dark hem line would cut across the glow.
    rise = _smooth(SHORTS_HEM - 0.045, SHORTS_HEM - 0.005, z)
    fall = 1.0 - _smooth(SHORTS_TOP - 0.005, SHORTS_TOP + 0.03, z)
    return rise * fall

for overlay in overlay_objects:
    if overlay.name[len("highlight "):] not in SHORTS_COVERED:
        continue
    lift_bm = bmesh.new()
    lift_bm.from_mesh(overlay.data)
    lift_bm.normal_update()
    lifted = 0
    for v in lift_bm.verts:
        weight = shorts_band_weight(v.co.z)
        if weight <= 0.0:
            continue
        v.co += outward_normal(v) * (OVERLAY_LIFT * weight)
        lifted += 1
    if lifted:
        lift_bm.to_mesh(overlay.data)
        log("lifted overlay verts", overlay.name, lifted)
    lift_bm.free()

for eye_obj in eye_objects:
    bpy.ops.object.select_all(action='DESELECT')
    eye_obj.select_set(True)
    bpy.context.view_layer.objects.active = eye_obj
    try:
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    except Exception as e:
        log("eye transform fail", eye_obj.name, e)
    eye_obj.data.materials.clear()
    for poly in eye_obj.data.polygons:
        poly.use_smooth = True
    eye_obj.hide_render = False
    eye_obj.hide_viewport = False
    eye_obj.color = (0.92, 0.91, 0.88, 1) if eye_obj.name == "eye whites" else (0.08, 0.07, 0.06, 1)

for modesty_obj in (shorts_obj, modesty_bridge):
    bpy.ops.object.select_all(action='DESELECT')
    modesty_obj.select_set(True)
    bpy.context.view_layer.objects.active = modesty_obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    modesty_obj.data.materials.clear()
    modesty_obj.hide_render = False
    modesty_obj.hide_viewport = False
    modesty_obj.color = (0.055, 0.060, 0.068, 1)
    for poly in modesty_obj.data.polygons:
        poly.use_smooth = True

# --- normalize: center X & depth, feet to floor ---
export_objects = (
    list(joined.values())
    + ([surface_obj] if surface_obj else [])
    + overlay_objects
    + eye_objects
    + [shorts_obj, modesty_bridge]
)
mn = [1e9]*3; mx = [-1e9]*3
for o in export_objects:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
cx = (mn[0]+mx[0])/2; cy = (mn[1]+mx[1])/2; cz = mn[2]
for o in export_objects:
    o.location.x -= cx; o.location.y -= cy; o.location.z -= cz
bpy.ops.object.select_all(action='DESELECT')
for o in export_objects: o.select_set(True)
bpy.context.view_layer.objects.active = export_objects[0]
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
height = mx[2] - mn[2]
log("height", round(height, 3), "tris total", sum(v[1] for v in report.values()))

# --- clean the spidery hands/feet: clip forearm/calf meshes at wrist/ankle ---
import bmesh
for g, o in joined.items():
    zs = [v.co.z for v in o.data.vertices]
    if zs:
        log("zrange", g, round(min(zs), 3), round(max(zs), 3))
def clip_below(o, zcut):
    me = o.data; bm = bmesh.new(); bm.from_mesh(me)
    dead = [v for v in bm.verts if v.co.z < zcut]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context='VERTS')
    bm.to_mesh(me); bm.free()
if 'forearms' in joined:
    clip_below(joined['forearms'], FOREARM_CUT)
if 'calves' in joined:
    clip_below(joined['calves'], CALF_CUT)
log("clipped hands/feet")

# Linked left/right objects in the atlas occasionally collapse to one side
# during joining (the deltoid/rotator-cuff group is the known case). After the
# full figure is centred on X=0, mirror only bilateral groups whose complete
# vertex range still sits on one side of that centre line.
BILATERAL = {
    "chest", "lats", "shoulders", "biceps", "triceps", "forearms",
    "quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors",
}
for g in BILATERAL:
    o = joined.get(g)
    if not o or not o.data.vertices:
        continue
    xs = [v.co.x for v in o.data.vertices]
    if max(xs) < -0.001 or min(xs) > 0.001:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        mirror = o.modifiers.new("restore_bilateral_side", "MIRROR")
        mirror.use_axis[0] = True
        mirror.use_clip = False
        try:
            bpy.ops.object.modifier_apply(modifier=mirror.name)
            log("mirrored missing side", g)
        except Exception as e:
            log("mirror fail", g, e)

# Report final geometry after clipping and any bilateral repair.
for g, o in joined.items():
    report[g][1] = sum(len(p.vertices) - 2 for p in o.data.polygons)

# --- render front + back (Workbench, object colors) for visual verification ---
for o in joined.values():
    o.hide_render = True
for o in overlay_objects:
    o.hide_render = True
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = 480; scene.render.resolution_y = 800
scene.render.film_transparent = False
world = scene.world or bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = False; world.color = (1, 1, 1)         # white background
sh = scene.display.shading
sh.light = 'STUDIO'; sh.color_type = 'OBJECT'
cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = height*1.08
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
def render(path, front):
    d = height*2.0
    cam.location = (0, -d if front else d, height*0.52)
    cam.rotation_euler = (math.radians(90), 0, 0 if front else math.radians(180))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
render(os.path.join(PREVIEW_DIR, "front.png"), True)
render(os.path.join(PREVIEW_DIR, "back.png"), False)
log("rendered thumbnails")

for o in joined.values():
    o.hide_render = False
for o in overlay_objects:
    o.hide_render = False

# --- export GLB (normals included to avoid a large on-device startup pass) ---
bpy.ops.object.select_all(action='DESELECT')
for o in export_objects: o.select_set(True)
try:
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT, export_format='GLB', use_selection=True,
        export_apply=True, export_normals=True, export_texcoords=False,
        export_materials='NONE', export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=12,
        export_draco_normal_quantization=10)
    sz = os.path.getsize(OUTPUT)
except Exception as e:
    log("EXPORT FAIL", e); sz = -1

json.dump({
          "report": report,
          "body_surface_tris": skin_after if surface_obj else 0,
          "modesty_shorts_tris": sum(len(p.vertices) - 2 for p in shorts_obj.data.polygons),
          "modesty_bridge_tris": sum(len(p.vertices) - 2 for p in modesty_bridge.data.polygons),
          "surface_overlays": overlay_report,
          "bbox": [mn, mx],
          "height": height,
          "glb_bytes": sz,
          },
          open(os.path.join(PREVIEW_DIR, "build_report.json"), "w"), indent=1)
log("output", OUTPUT)
log("previews", PREVIEW_DIR)
log("DONE total_tris=%d glb_bytes=%d" % (sum(v[1] for v in report.values()), sz))
print("BUILD_DONE")
