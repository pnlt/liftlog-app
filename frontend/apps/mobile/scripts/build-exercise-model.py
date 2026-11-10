"""Run with Blender: blender -b --python scripts/build-exercise-model.py -- FIGHTER_BLEND TEXTURES_DIR.

FIGHTER_BLEND is the rigged Fighter model, TEXTURES_DIR holds its *_normal.png map.
"""

import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

SCALE = 87
SIDES = {"Left": 1, "Right": -1}
HAIR_CENTER, HAIR_RADII = Vector((0, -0.5, 168)), Vector((9, 10.5, 10))
GREY, IRON, ARROW = (0.3, 0.31, 0.33), (0.08, 0.08, 0.09), (0.05, 0.6, 1.0)
ZONES = ("forearms", "biceps", "triceps", "shoulders", "traps", "calves", "hamstrings", "quads", "glutes", "lowerBack")
FPS, FRAMES = 30, 121
STANCE = 12.5
HANDLE_RADIUS, FINGER_DEPTH, THUMB_OFFSET = 2.0, 2.6, 3.0
REST_PROP = Vector((0, 0, 100))
STEP_HEIGHT = 15
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
HIPS, SPINE, NECK = "mixamorig:Hips", ("mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2"), "mixamorig:Neck"


def bone(side, part):
    return f"mixamorig:{side}{part}"


def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)


def frame(first, second):
    first = first.normalized()
    second = (second - first * second.dot(first)).normalized()
    return Matrix((first, second, first.cross(second))).transposed()


def mirror(v, x):
    return Vector((v.x * x, v.y, v.z))


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * u * (u * (6 * u - 15) + 10)


def lerp(a, b, u):
    return a + (b - a) * u


def solve(f, lo, hi):
    rising = f(lo) < f(hi)
    assert (f(lo) < 0) == rising and (f(hi) > 0) == rising, f"No root between {f(lo):.3f} and {f(hi):.3f}"
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if (f(mid) < 0) == rising else (lo, mid)
    return (lo + hi) / 2


def held_phase(t):
    return ease((t - 0.5) / 1.1) - ease((t - 2.0) / 1.5)


def swing_phase(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


class Pose:
    def __init__(self, rig):
        self.bones = rig.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in self.bones}
        self.subtree = {b.name: [b.name] + [c.name for c in b.children_recursive] for b in self.bones}
        self.hinge, self.grips, self.palms, self.curls, self.bind = {}, {}, {}, {}, {}
        self.reset()

    def adopt(self, names):
        for name in names:
            self.rest[name], self.subtree[name] = self.bones[name].matrix_local.copy(), [name]
        self.reset()

    def reset(self):
        self.world = {n: m.copy() for n, m in self.rest.items()}

    def head(self, n):
        return self.world[n].translation.copy()

    def rotation(self, n):
        return self.world[n].to_3x3().normalized()

    def transform(self, n, matrix):
        for b in self.subtree[n]:
            self.world[b] = matrix @ self.world[b]

    def rotate(self, n, rotation, pivot=None):
        pivot = self.head(n) if pivot is None else pivot
        self.transform(n, Matrix.Translation(pivot) @ rotation.to_4x4() @ Matrix.Translation(-pivot))

    def orient(self, n, rotation):
        self.rotate(n, rotation @ self.rotation(n).transposed())

    def basis(self, n):
        parent = self.bones[n].parent
        base = self.world[parent.name] @ self.rest[parent.name].inverted() if parent else Matrix()
        return (base @ self.rest[n]).inverted() @ self.world[n]

    def limb(self, upper, lower, end, u, h, direction):
        u0 = (self.head(lower) - self.head(upper)).normalized()
        self.rotate(upper, frame(u, h) @ frame(u0, self.rotation(upper) @ self.hinge[upper]).transposed())
        self.rotate(lower, (self.head(end) - self.head(lower)).rotation_difference(direction).to_matrix())

    def ik(self, upper, lower, end, target, pole):
        origin = self.head(upper)
        a = (self.head(lower) - origin).length
        b = (self.head(end) - self.head(lower)).length
        offset = target - origin
        d = min(max(offset.length, abs(a - b) + 1e-3), (a + b) * 0.9995)
        t = offset.normalized()
        p = (pole - t * pole.dot(t)).normalized()
        cos = (a * a + d * d - b * b) / (2 * a * d)
        u = t * cos + p * math.sqrt(max(0.0, 1 - cos * cos))
        self.limb(upper, lower, end, u, p.cross(t), (origin + t * d - origin - u * a).normalized())

    def set_hand(self, side, rotation):
        fore, hand = bone(side, "ForeArm"), bone(side, "Hand")
        axis = (self.head(hand) - self.head(fore)).normalized()
        q = (rotation @ self.rotation(hand).transposed()).to_quaternion()
        if q.w < 0:
            q.negate()
        twist = 2 * math.atan2(Vector((q.x, q.y, q.z)).dot(axis), q.w)
        self.rotate(fore, Matrix.Rotation(twist / 2, 3, axis))
        self.orient(hand, rotation)

    def twist(self, side, supination):
        axis = (self.head(bone(side, "Hand")) - self.head(bone(side, "ForeArm"))).normalized()
        self.set_hand(side, rot(axis, -supination * SIDES[side]) @ self.rotation(bone(side, "Hand")))

    def grip_rotation(self, side, thumb, palm):
        _, a, p = self.grips[side]
        return frame(thumb, palm) @ frame(a, p).transposed()

    def wrist_for(self, side, center, thumb, palm):
        return center - self.grip_rotation(side, thumb, palm) @ self.grips[side][0]

    def reach(self, side, wrist):
        arm, fore, hand = (bone(side, p) for p in ("Arm", "ForeArm", "Hand"))
        length = (self.head(fore) - self.head(arm)).length + (self.head(hand) - self.head(fore)).length
        return (wrist - self.head(arm)).length / length

    def grip(self, side, center, thumb, palm, pole):
        wrist = self.wrist_for(side, center, thumb, palm)
        self.ik(bone(side, "Arm"), bone(side, "ForeArm"), bone(side, "Hand"), wrist, pole)
        self.set_hand(side, self.grip_rotation(side, thumb, palm))
        miss = (self.head(bone(side, "Hand")) - wrist).length
        assert miss < 0.3, f"{side} hand misses its grip by {miss:.1f} at reach {self.reach(side, wrist):.2f}"

    def held(self, side):
        c, a, p = self.grips[side]
        return self.world[bone(side, "Hand")] @ (Matrix.Translation(c) @ frame(a, p).to_4x4())

    def palm(self, side):
        return self.rotation(bone(side, "Hand")) @ self.palms[side]

    def shrug(self, side, degrees):
        self.rotate(bone(side, "Shoulder"), rot(Y, -degrees * SIDES[side]))

    def relax(self, side, amount):
        delta = self.rotation(bone(side, "Hand")) @ self.rest[bone(side, "Hand")].to_3x3().transposed()
        for name, rotation in reversed(self.curls[side]):
            undo = Quaternion().slerp(rotation.to_quaternion().inverted(), amount).to_matrix()
            self.rotate(name, delta @ undo @ delta.transposed())

    def legs(self, feet, knees_out):
        for side, x in SIDES.items():
            ankle, foot, toe = feet[side]
            self.ik(bone(side, "UpLeg"), bone(side, "Leg"), bone(side, "Foot"), ankle, Vector((knees_out * x, -1, 0)))
            assert (self.head(bone(side, "Foot")) - ankle).length < 0.3, f"{side} foot slides"
            self.orient(bone(side, "Foot"), foot)
            self.orient(bone(side, "ToeBase"), toe)

    def stance(self, width=STANCE, toe_out=0.0):
        feet = {}
        for side, x in SIDES.items():
            ankle, foot, toe = self.bind["feet"][side]
            turn = rot(Z, toe_out * x)
            feet[side] = (Vector((width * x, ankle.y, ankle.z)), turn @ foot, turn @ toe)
        return feet

    def body(self, drop=0.0, back=0.0, pitch=0.0, spine=0.0, neck=0.0, feet=None, knees_out=0.2):
        self.transform(HIPS, Matrix.Translation((0, back, -drop)))
        pivot = (self.head(bone("Left", "UpLeg")) + self.head(bone("Right", "UpLeg"))) / 2
        self.rotate(HIPS, rot(X, pitch), pivot)
        for name in SPINE:
            self.rotate(name, rot(X, spine / 3))
        self.rotate(NECK, rot(X, neck))
        self.legs(feet or self.bind["feet"], knees_out)

    def hang(self, side, flex=6.0, forward=0.0, out=0.0):
        u = rot(X, -forward) @ rot(Y, -out * SIDES[side]) @ self.bind["u"][side]
        h = rot(X, -forward) @ rot(Y, -out * SIDES[side]) @ self.bind["h"][side]
        self.limb(bone(side, "Arm"), bone(side, "ForeArm"), bone(side, "Hand"), u, h, rot(h, flex) @ u)


def material(name, color, emission=None, roughness=0.55, normal_map=None):
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    if normal_map:
        texture, mapping = nodes.new("ShaderNodeTexImage"), nodes.new("ShaderNodeNormalMap")
        texture.image = normal_map
        links.new(texture.outputs["Color"], mapping.inputs["Color"])
        links.new(mapping.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def load(source, textures):
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    rig, surface = bpy.data.objects["Armature"], bpy.data.objects["file1"]
    assert surface.parent == rig and surface.data.shape_keys is None
    for obj in list(bpy.data.objects):
        if obj not in (rig, surface):
            bpy.data.objects.remove(obj)
    for collection in (bpy.data.actions, bpy.data.materials, bpy.data.images):
        for item in list(collection):
            collection.remove(item)
    rig.animation_data_clear()
    rig.data.animation_data_clear()
    for pb in rig.pose.bones:
        for constraint in list(pb.constraints):
            pb.constraints.remove(constraint)
        pb.custom_shape = None
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix()
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for edit in list(rig.data.edit_bones):
        if not edit.name.startswith("mixamorig:"):
            rig.data.edit_bones.remove(edit)
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.data.transform(Matrix.Scale(SCALE, 4))
    surface.data.transform(Matrix.Scale(SCALE, 4))
    rig.scale = (0.01,) * 3
    surface.name = surface.data.name = "Body"
    bpy.context.view_layer.update()

    mesh = bmesh.new()
    mesh.from_mesh(surface.data)
    hair = [v for v in mesh.verts if v.co.z > HAIR_CENTER.z]
    for vertex in hair:
        offset = vertex.co - HAIR_CENTER
        reach = Vector(o / r for o, r in zip(offset, HAIR_RADII)).length
        if reach > 1:
            vertex.co = HAIR_CENTER + offset / reach
    for _ in range(4):
        bmesh.ops.smooth_vert(mesh, verts=hair, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    mesh.to_mesh(surface.data)
    mesh.free()
    normal_map = bpy.data.images.load(str(next(textures.glob("*_normal.png"))))
    normal_map.colorspace_settings.name = "Non-Color"
    normal_map.scale(1024, 1024)
    normal_map.pack()
    return rig, surface, normal_map


def fist(pose, side):
    hand, x = bone(side, "Hand"), SIDES[side]
    palm = pose.rotation(hand) @ pose.palms[side]
    fingers = pose.head(bone(side, "HandIndex1")) - pose.head(hand)
    fingers = (fingers - palm * fingers.dot(palm)).normalized()
    curl = fingers.cross(palm)
    radius = HANDLE_RADIUS + FINGER_DEPTH
    center = pose.head(bone(side, "HandIndex1")) + palm * radius
    thumb = curl if curl.dot(pose.head(bone(side, "HandThumb1")) - center) > 0 else -curl
    curls = pose.curls[side] = []

    def turn(name, rotation):
        pose.rotate(name, rotation)
        curls.append((name, rotation))

    angle = 0.0
    for joint in "123":
        name = bone(side, f"HandIndex{joint}")
        start, end = pose.head(name), pose.head(bone(side, f"HandIndex{int(joint) + 1}"))
        angle += 2 * math.asin(min(1.0, (end - start).length / (2 * radius)))
        goal = center + radius * (-math.cos(angle) * palm + math.sin(angle) * fingers)
        turn(name, (end - start).rotation_difference(goal - start).to_matrix())
    assert math.radians(200) < angle < math.radians(300), f"Finger wrap {math.degrees(angle):.0f}"

    def over_fingers(theta):
        return center + thumb * THUMB_OFFSET + (radius + 2.2) * (-math.cos(theta) * palm - math.sin(theta) * fingers)

    theta = math.radians(60)
    for joint in "123":
        name = bone(side, f"HandThumb{joint}")
        start, end = pose.head(name), pose.head(bone(side, f"HandThumb{int(joint) + 1}"))
        length = (end - start).length
        theta = solve(lambda t: (over_fingers(t) - start).length - length, theta + 0.05, theta + math.radians(150))
        turn(name, (end - start).rotation_difference(over_fingers(theta) - start).to_matrix())
    assert math.radians(150) < theta < math.radians(230), f"Thumb wrap {math.degrees(theta):.0f}"
    return center, thumb, -palm


def bind(rig, surface):
    pose = Pose(rig)
    for side in SIDES:
        pose.palms[side] = pose.rotation(bone(side, "Hand")).transposed() @ Vector((0, 0, -1))
    up, low, foot = (bone("Left", p) for p in ("UpLeg", "Leg", "Foot"))
    length = (pose.head(low) - pose.head(up)).length + (pose.head(foot) - pose.head(low)).length
    ankle = pose.head(foot)
    target = Vector((STANCE, ankle.y, ankle.z))
    lift = solve(lambda dz: (target - pose.head(up) - Z * dz).length / length - 0.995, 0, 15)
    pose.transform(HIPS, Matrix.Translation(Z * lift))
    for side, x in SIDES.items():
        upper, lower, end = bone(side, "UpLeg"), bone(side, "Leg"), bone(side, "Foot")
        ankle = pose.head(end)
        foot_rotation, toe_rotation = pose.rotation(end), pose.rotation(bone(side, "ToeBase"))
        knee = (pose.head(lower) - pose.head(upper)).normalized()
        pose.hinge[upper] = pose.rotation(upper).transposed() @ (X - knee * X.dot(knee)).normalized()
        pose.ik(upper, lower, end, Vector((STANCE * x, ankle.y, ankle.z)), -Y)
        pose.orient(end, foot_rotation)
        pose.orient(bone(side, "ToeBase"), toe_rotation)

        arm, fore, hand = bone(side, "Arm"), bone(side, "ForeArm"), bone(side, "Hand")
        u = Vector((0.12 * x, -0.03, -1)).normalized()
        pose.rotate(arm, (pose.head(fore) - pose.head(arm)).rotation_difference(u).to_matrix())
        h = (-X - u * -X.dot(u)).normalized()
        pose.rotate(fore, (pose.head(hand) - pose.head(fore)).rotation_difference(rot(h, 6) @ u).to_matrix())
        assert pose.palm(side).dot(-X * x) > 0.85, f"{side} palm must face the thigh"
    grips = {side: fist(pose, side) for side in SIDES}

    for name in pose.world:
        rig.pose.bones[name].matrix_basis = pose.basis(name)
    bpy.context.view_layer.update()
    bpy.context.view_layer.objects.active = surface
    bpy.ops.object.modifier_apply(modifier=next(m.name for m in surface.modifiers if m.type == "ARMATURE"))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode="OBJECT")

    rest = Pose(rig)
    for name in pose.world:
        assert (rest.head(name) - pose.head(name)).length < 1e-3, f"{name} moved while applying the bind pose"
    for side, x in SIDES.items():
        hand = bone(side, "Hand")
        inverse = rest.rotation(hand).transposed()
        center, thumb, palm = grips[side]
        rest.grips[side] = (inverse @ (center - rest.head(hand)), inverse @ thumb, inverse @ palm)
        rest.palms[side] = inverse @ pose.palm(side)
        rest.curls[side] = pose.curls[side]
        arm, fore = bone(side, "Arm"), bone(side, "ForeArm")
        u = (rest.head(fore) - rest.head(arm)).normalized()
        h = (-X - u * -X.dot(u)).normalized()
        rest.hinge[arm] = rest.rotation(arm).transposed() @ h
        rest.bind.setdefault("u", {})[side] = u
        rest.bind.setdefault("h", {})[side] = h
        rest.hinge[bone(side, "UpLeg")] = pose.hinge[bone(side, "UpLeg")]
        rest.bind.setdefault("feet", {})[side] = (
            rest.head(bone(side, "Foot")),
            rest.rotation(bone(side, "Foot")),
            rest.rotation(bone(side, "ToeBase")),
        )
    for side in SIDES:
        upper = bone(side, "UpLeg")
        knee = (rest.head(bone(side, "Leg")) - rest.head(upper)).normalized()
        rest.hinge[upper] = rest.rotation(upper).transposed() @ (X - knee * X.dot(knee)).normalized()
    return rest


def zones(pose, surface):
    groups = {g.index: g.name.removeprefix("mixamorig:") for g in surface.vertex_groups}
    hip = (pose.head(bone("Left", "UpLeg")) + pose.head(bone("Right", "UpLeg"))) / 2
    assigned = {}

    def segment(side, part, child, co):
        start, end = pose.head(bone(side, part)), pose.head(bone(side, child))
        axis = end - start
        along = (co - start).dot(axis) / axis.length_squared
        radial = co - start - along * axis
        return along, radial.normalized()

    for vertex in surface.data.vertices:
        owner = max(vertex.groups, key=lambda g: g.weight, default=None)
        if owner is None:
            continue
        group, co = groups[owner.group], vertex.co
        side = "Left" if group.startswith("Left") else "Right" if group.startswith("Right") else None
        part = group.removeprefix(side) if side else group
        x = SIDES.get(side, 0)
        zone = None
        if part == "ForeArm":
            along, radial = segment(side, "ForeArm", "Hand", co)
            zone = "forearms" if 0.05 < along < 0.75 else None
        elif part == "Arm":
            along, radial = segment(side, "Arm", "ForeArm", co)
            if along < 0.28 and radial.dot(X * x) > -0.3:
                zone = "shoulders"
            elif 0.25 < along < 0.92 and radial.dot(-Y) > 0.35:
                zone = "biceps"
            elif 0.15 < along < 0.92 and radial.dot(Y) > 0.35:
                zone = "triceps"
        elif part == "Shoulder":
            zone = "shoulders" if co.x * x > pose.head(bone(side, "Arm")).x * x - 5 else "traps" if co.y > 2 else None
        elif part in ("Neck", "Spine2") and co.y > pose.head(NECK).y - 1 and co.z > pose.head(NECK).z - 9:
            zone = "traps"
        elif part == "Leg":
            along, radial = segment(side, "Leg", "Foot", co)
            zone = "calves" if 0.08 < along < 0.65 and radial.dot(Y) > 0.15 else None
        elif part == "UpLeg":
            along, radial = segment(side, "UpLeg", "Leg", co)
            if co.z > hip.z - 16 and co.y > hip.y + 3 and along < 0.3:
                zone = "glutes"
            elif 0.3 < along < 0.9 and radial.dot(Y) > 0.45:
                zone = "hamstrings"
            elif 0.12 < along < 0.9 and radial.dot(-Y) > 0.1:
                zone = "quads"
        elif part == "Hips" and co.y > hip.y + 3 and co.z < hip.z + 6 and abs(co.x) > 1.5:
            zone = "glutes"
        elif part in ("Hips", "Spine", "Spine1") and co.y > hip.y + 4 and abs(co.x) < 9 and co.z < pose.head(SPINE[1]).z + 4:
            zone = "lowerBack"
        if zone:
            assigned[vertex.index] = zone

    surface.data.materials.clear()
    for polygon in surface.data.polygons:
        names = {assigned.get(v) for v in polygon.vertices}
        polygon.material_index = ZONES.index(names.pop()) + 1 if len(names) == 1 and None not in names else 0
    counts = {zone: sum(p.material_index == i + 1 for p in surface.data.polygons) for i, zone in enumerate(ZONES)}
    assert all(count > 60 for count in counts.values()), f"Thin muscle zones: {counts}"
    return counts


class Props:
    def __init__(self, rig):
        self.rig = rig
        self.object = bpy.data.objects.new("Props", bpy.data.meshes.new("Props"))
        bpy.context.scene.collection.objects.link(self.object)
        self.object.parent = rig
        self.mesh = bmesh.new()
        self.deform = self.mesh.verts.layers.deform.verify()
        self.bones = {}

    def add_bone(self, name, head):
        bpy.context.view_layer.objects.active = self.rig
        bpy.ops.object.mode_set(mode="EDIT")
        edit = self.rig.data.edit_bones.new(name)
        edit.head, edit.tail, edit.roll = head, head + Vector((0, 10, 0)), 0
        bpy.ops.object.mode_set(mode="OBJECT")
        self.bones[name] = head.copy()

    def skin(self, verts, name, material_index):
        group = self.object.vertex_groups.get(name) or self.object.vertex_groups.new(name=name)
        for vertex in verts:
            vertex[self.deform].clear()
            vertex[self.deform][group.index] = 1
        for face in {f for v in verts for f in v.link_faces}:
            face.material_index = material_index
            face.smooth = True

    def cylinder(self, matrix, radius, depth, segments=20):
        geometry = bmesh.ops.create_cone(self.mesh, segments=segments, radius1=radius, radius2=radius, depth=depth, cap_ends=True)
        bmesh.ops.transform(self.mesh, matrix=matrix @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=geometry["verts"])
        return geometry["verts"]

    def tube(self, points, radius, segments=10):
        rings = []
        for i, point in enumerate(points):
            tangent = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
            ring = bmesh.ops.create_circle(self.mesh, segments=segments, radius=radius)["verts"]
            rotation = Z.rotation_difference(tangent).to_matrix().to_4x4()
            bmesh.ops.transform(self.mesh, matrix=Matrix.Translation(point) @ rotation, verts=ring)
            rings.append(ring)
        for a, b in zip(rings, rings[1:]):
            for j in range(segments):
                self.mesh.faces.new((a[j], a[(j + 1) % segments], b[(j + 1) % segments], b[j]))
        return [v for ring in rings for v in ring]

    def dumbbell(self, name, handle):
        self.add_bone(name, REST_PROP)
        base = Matrix.Translation(REST_PROP)
        verts = self.cylinder(base, HANDLE_RADIUS, handle)
        for offset in (-1, 1):
            verts += self.cylinder(base @ Matrix.Translation((offset * (handle / 2 + 3.5), 0, 0)), 6.5 + handle / 10, 7, 6)
        self.skin(verts, name, 0)

    def barbell(self):
        self.add_bone("barbell", REST_PROP)
        base = Matrix.Translation(REST_PROP)
        verts = self.cylinder(base, HANDLE_RADIUS, 128)
        for offset in (-1, 1):
            verts += self.cylinder(base @ Matrix.Translation((offset * 80, 0, 0)), 2.8, 32)
            verts += self.cylinder(base @ Matrix.Translation((offset * 69, 0, 0)), 22.5, 5, 32)
            verts += self.cylinder(base @ Matrix.Translation((offset * 65.5, 0, 0)), 3.6, 2)
        self.skin(verts, "barbell", 0)

    def kettlebell(self):
        self.add_bone("kettlebell", REST_PROP)
        bell = bmesh.ops.create_uvsphere(self.mesh, u_segments=24, v_segments=14, radius=13)["verts"]
        bmesh.ops.translate(self.mesh, vec=REST_PROP + KB_BELL, verts=bell)
        side = [Vector((10.5, 0, -11)), Vector((12, 0, -4))]
        side += [Vector((8 + 4 * math.cos(a), 0, -4 + 4 * math.sin(a))) for a in (math.radians(d) for d in (30, 60, 90))]
        path = [mirror(p, -1) for p in side] + side[::-1]
        self.skin(bell + self.tube([REST_PROP + p for p in path], HANDLE_RADIUS, 16), "kettlebell", 0)

    def step(self, top, edge):
        center = Vector((0, edge - 22, top / 2))
        self.add_bone("step", center)
        box = bmesh.ops.create_cube(self.mesh, size=1)["verts"]
        bmesh.ops.transform(self.mesh, matrix=Matrix.Translation(center) @ Matrix.Diagonal((70, 44, top, 1)), verts=box)
        self.skin(box, "step", 0)

    def arrow(self, name, points):
        if (points[-1] - points[0]).length < 14:
            middle, direction = (points[0] + points[-1]) / 2, (points[-1] - points[0]).normalized()
            points = [middle + direction * (i / 10 - 0.5) * 14 for i in range(11)]
        lengths = [0.0]
        for a, b in zip(points, points[1:]):
            lengths.append(lengths[-1] + (b - a).length)
        keep = [p for p, d in zip(points, lengths) if 0.08 * lengths[-1] <= d <= 0.82 * lengths[-1]]
        self.add_bone(name, keep[0])
        verts = self.tube(keep, 0.9)
        tangent = (keep[-1] - keep[-2]).normalized()
        head = bmesh.ops.create_cone(self.mesh, segments=16, radius1=2.6, radius2=0, depth=6, cap_ends=True)["verts"]
        matrix = Matrix.Translation(keep[-1] + tangent * 3) @ Z.rotation_difference(tangent).to_matrix().to_4x4()
        bmesh.ops.transform(self.mesh, matrix=matrix, verts=head)
        self.skin(verts + head, name, 1)

    def finish(self):
        bmesh.ops.recalc_face_normals(self.mesh, faces=self.mesh.faces[:])
        self.mesh.to_mesh(self.object.data)
        self.mesh.free()
        modifier = self.object.modifiers.new("Armature", "ARMATURE")
        modifier.object = self.rig


KB_BELL = Vector((0, 0, -19))
KB_SWING_GRIP = 5.5
KB_HORN = (Vector((11.25, 0, -7.5)), Vector((0.21, 0, 0.98)).normalized())


def prop_matrix(center, rotation):
    return Matrix.Translation(center) @ rotation.to_4x4()


def exercises(pose, body_mesh):
    verts = [v.co.copy() for v in body_mesh.vertices]

    def surface(select, pick):
        return pick(co.y for co in verts if select(co))

    shoulder = {side: pose.head(bone(side, "Arm")) for side in SIDES}
    thigh_front = surface(lambda c: abs(c.z - 86) < 3 and 8 < abs(c.x) < 22, min)
    shin_front = surface(lambda c: abs(c.z - 25) < 3 and 8 < abs(c.x) < 22, min)
    back_y = surface(lambda c: abs(c.z - 147) < 2 and abs(c.x) < 6, max)
    chest_y = surface(lambda c: abs(c.z - 146) < 2 and 6 < abs(c.x) < 18, min)
    face_y = surface(lambda c: 158 < c.z < 186 and abs(c.x) < 6, min)
    belly_y = surface(lambda c: 108 < c.z < 128 and abs(c.x) < 10, min)
    head_top = max(co.z for co in verts)
    spine2 = SPINE[2]
    bar_back = Matrix.Translation((0, back_y + 1.2, 147))
    bar_front = Matrix.Translation((0, chest_y - 1.6, 147.5))
    goblet = Matrix.Translation((0, belly_y - 18, 132))
    bind_spine2 = pose.world[spine2].copy()
    floor_bar_y = min(thigh_front, shin_front) - HANDLE_RADIUS - 0.8
    pronated = (-X, -Y)

    def on_spine(local):
        return pose.world[spine2] @ bind_spine2.inverted() @ local

    def both(fn):
        for side, x in SIDES.items():
            fn(side, x)

    def dumbbells():
        return {"dumbbell_l": pose.held("Left"), "dumbbell_r": pose.held("Right")}

    def bar_between():
        left, right = pose.held("Left").translation, pose.held("Right").translation
        return {"barbell": prop_matrix((left + right) / 2, frame(left - right, Y))}

    def curl(s, supination, forward=(0, 8)):
        def arm(side, x):
            pose.hang(side, 6 + 129 * s, lerp(*forward, s))
            pose.twist(side, supination)

        both(arm)

    def db_curl(s):
        curl(s, 90)
        return dumbbells()

    def hammer_curl(s):
        curl(s, 0)
        return dumbbells()

    def barbell_curl(s):
        curl(s, 90, (9, 16))
        return bar_between()

    def lateral_raise(s):
        def arm(side, x):
            pose.shrug(side, 8 * s)
            pose.hang(side, 15, 4, 78 * s)

        both(arm)
        return dumbbells()

    def db_shrug(s):
        def arm(side, x):
            pose.shrug(side, 13 * s)
            pose.hang(side)

        both(arm)
        return dumbbells()

    press_palm = Vector((0, 1, -0.35)).normalized()

    def press_top(center_at, thumb, palm, shrug):
        def miss(z):
            pose.reset()
            for side in SIDES:
                pose.shrug(side, shrug)
            return pose.reach("Left", pose.wrist_for("Left", center_at(z), thumb, palm)) - 0.975

        top = solve(miss, 160, 240)
        pose.reset()
        return top

    def bar_y(z, top):
        clear = min(chest_y - 1.6, face_y - 4.5)
        rise = ease((z - (head_top - 8)) / max(top - head_top + 8, 1))
        return lerp(lerp(chest_y - 1.6, clear, ease((z - 147.5) / 8)), shoulder["Left"].y - 2, rise)

    ohp_top = press_top(lambda z: Vector((30, shoulder["Left"].y - 2, z)), -X, press_palm, 16)
    db_top = press_top(lambda z: Vector((17, 3, z)), -X, press_palm, 14)

    def overhead_press(s):
        z = lerp(147.5, ohp_top, s)
        center = Vector((0, bar_y(z, ohp_top), z))
        palm = lerp(Vector((0, 0.6, -0.8)), press_palm, s)
        pose.rotate(NECK, rot(X, -12 * math.sin(math.pi * min(s * 1.4, 1))))

        def arm(side, x):
            pose.shrug(side, 16 * s)
            pole = lerp(Vector((0.3 * x, -1, -0.5)), Vector((x, 0.1, 0)), s)
            pose.grip(side, center + X * 30 * x, mirror(-X, x), palm, pole)

        both(arm)
        return {"barbell": prop_matrix(center, Matrix())}

    def db_shoulder_press(s):
        def arm(side, x):
            pose.shrug(side, 14 * s)
            center = lerp(Vector((46 * x, 3, 172)), Vector((17 * x, 3, db_top)), s)
            pose.grip(side, center, mirror(-X, x), press_palm, Vector((x, 0.2, -0.5)))

        both(arm)
        return dumbbells()

    def triceps_extension(s):
        beta = math.radians(lerp(8, 128, s))
        center = Vector((0, 9, shoulder["Left"].z + 25)) + 30 * Vector((0, math.sin(beta), math.cos(beta)))
        palm = Vector((0, math.cos(beta), -math.sin(beta)))

        def arm(side, x):
            pose.shrug(side, 16)
            pose.grip(side, center + X * 6.5 * x, mirror(-X, x), palm, Vector((0.25 * x, -0.4, 1)))

        both(arm)
        return {"dumbbell_long": prop_matrix(center, Matrix())}

    def squat(s, drop, back, pitch, spine, toe_out=18, knees_out=0.4):
        pose.body(drop * s, back * s, pitch * s, spine * s, -0.4 * (pitch + spine) * s, pose.stance(19, toe_out), knees_out)

    def back_squat(s):
        squat(s, 46, 16, 28, 10)
        bar = on_spine(bar_back)
        rotation = bar.to_3x3().normalized()

        def arm(side, x):
            palm = rotation @ Vector((0, 0.85, -0.5))
            pose.grip(side, bar @ Vector((42 * x, 0, 0)), rotation @ mirror(-X, x), palm, Vector((0.4 * x, 0.6, -1)))

        both(arm)
        return {"barbell": prop_matrix(bar.translation, rotation)}

    def front_squat(s):
        squat(s, 46, 8, 10, 4)
        bar = on_spine(bar_front)
        rotation = bar.to_3x3().normalized()

        def arm(side, x):
            palm = rotation @ Vector((0, -0.3, -0.95))
            pose.grip(side, bar @ Vector((27 * x, 0, 0)), rotation @ mirror(-X, x), palm, Vector((0.25 * x, -1, 0.15)))

        both(arm)
        return {"barbell": prop_matrix(bar.translation, rotation)}

    def goblet_squat(s):
        squat(s, 48, 12, 15, 5, 20, 0.45)
        bell = on_spine(goblet)
        rotation = bell.to_3x3().normalized()

        def arm(side, x):
            horn, axis = KB_HORN
            center = bell @ mirror(horn, x)
            pose.grip(side, center, rotation @ mirror(axis, x), rotation @ (X * x), Vector((0.2 * x, 0, -1)))

        both(arm)
        return {"kettlebell": prop_matrix(bell.translation, rotation)}

    def bodyweight_squat(s):
        squat(s, 48, 18, 30, 8)

        def arm(side, x):
            u, h = Vector((0.06 * x, -1, 0.02)).normalized(), Vector((-x * 0.06, 0, -1)).normalized()
            pose.limb(bone(side, "Arm"), bone(side, "ForeArm"), bone(side, "Hand"), u, (h - u * h.dot(u)), u)
            pose.relax(side, 0.8)

        both(arm)
        return {}

    def bar_hands(center, width, grip=pronated):
        def arm(side, x):
            thumb, palm = grip
            pose.grip(side, center + X * width * x, mirror(thumb, x), palm, Vector((0.3 * x, 1, 0)))

        both(arm)

    def hinge_reach(z, width, grip=pronated):
        thumb, palm = grip
        return pose.reach("Left", pose.wrist_for("Left", Vector((width, floor_bar_y, z)), thumb, palm)) - 0.975

    def hinge(s, width, props):
        def body():
            pose.reset()
            pose.body(7 * s, 26 * s, 58 * s, 8 * s, -6 * s)

        body()
        z = solve(lambda z: hinge_reach(z, width), 20, 140)
        body()
        center = Vector((0, floor_bar_y, z))
        bar_hands(center, width)
        return {"barbell": prop_matrix(center, Matrix())} if props == "barbell" else dumbbells()

    def romanian_deadlift(s):
        return hinge(s, 27, "barbell")

    def db_rdl(s):
        return hinge(s, 29, "dumbbells")

    def deadlift_body(s, drop):
        knees, hips = 1 - ease(s / 0.7), 1 - ease((s - 0.2) / 0.8)
        pose.reset()
        pose.body(drop * knees, 18 * hips, 62 * hips, 6 * hips, -8 * hips, knees_out=0.25)
        return solve(lambda z: hinge_reach(z, 27), 10, pose.head(bone("Left", "Arm")).z - 20)

    bottom = solve(lambda drop: deadlift_body(0, drop) - 22.5, 0, 60)

    def deadlift(s):
        center = Vector((0, floor_bar_y, deadlift_body(s, bottom)))
        bar_hands(center, 27)
        assert center.z >= 22.5 - 1e-3, "Plates sink into the floor"
        return {"barbell": prop_matrix(center, Matrix())}

    def kb_swing(s):
        alpha = lerp(-25, 90, s)
        tilt = rot(X, -alpha)
        palm = tilt @ -Y

        def body():
            pose.reset()
            pose.body(10 * (1 - s), 22 * (1 - s), 55 * (1 - s), 5 * (1 - s), -10 * (1 - s), pose.stance(22, 15), 0.35)

        def handle(distance):
            middle = (pose.head(bone("Left", "Arm")) + pose.head(bone("Right", "Arm"))) / 2
            return middle + tilt @ (-Z * distance)

        def miss(distance):
            return pose.reach("Left", pose.wrist_for("Left", handle(distance) + X * KB_SWING_GRIP, -X, palm)) - 0.975

        body()
        center = handle(solve(miss, 20, 80))

        def arm(side, x):
            pose.grip(side, center + X * KB_SWING_GRIP * x, mirror(-X, x), palm, Vector((0.2 * x, 1, 0)))

        both(arm)
        return {"kettlebell": prop_matrix(center, tilt)}

    def calf_raise(s):
        theta = lerp(-12, 25, s)
        feet = {}
        for side, (ankle, foot, toe) in pose.bind["feet"].items():
            ball = pose.rest[bone(side, "ToeBase")].translation
            turn = rot(X, theta)
            feet[side] = (ball + turn @ (ankle - ball) + Z * STEP_HEIGHT, turn @ foot, toe)
        lift = feet["Left"][0] - pose.bind["feet"]["Left"][0]
        pose.body(-lift.z, lift.y, feet=feet, knees_out=0.1)

        def arm(side, x):
            pose.hang(side)
            pose.relax(side, 0.7)

        both(arm)
        return {"step": pose.rest["step"]}

    def grip_point(side="Left"):
        return lambda: pose.held(side).translation

    def offset(fn, vector):
        return lambda: fn() + vector

    left_hip = lambda: pose.head(bone("Left", "UpLeg"))
    left_heel = lambda: pose.world[bone("Left", "Foot")] @ Vector((0, -4, 0)) + Vector((0, 6, -9))
    swing_bell = lambda: pose.world[bone("Left", "Hand")].translation
    return [
        ("db-curl", db_curl, offset(grip_point(), X * 20), held_phase),
        ("barbell-curl", barbell_curl, offset(grip_point(), Vector((0, -14, 0))), held_phase),
        ("hammer-curl", hammer_curl, offset(grip_point(), X * 14), held_phase),
        ("overhead-press", overhead_press, offset(grip_point(), Vector((0, -16, 0))), held_phase),
        ("db-shoulder-press", db_shoulder_press, offset(grip_point(), X * 18), held_phase),
        ("lateral-raise", lateral_raise, offset(grip_point(), Vector((0, -14, 0))), held_phase),
        ("overhead-triceps-extension", triceps_extension, offset(grip_point(), X * 30), held_phase),
        ("db-shrug", db_shrug, offset(grip_point(), X * 14), held_phase),
        ("goblet-squat", goblet_squat, offset(left_hip, X * 34), held_phase),
        ("back-squat", back_squat, offset(left_hip, X * 34), held_phase),
        ("front-squat", front_squat, offset(left_hip, X * 34), held_phase),
        ("bodyweight-squat", bodyweight_squat, offset(left_hip, X * 34), held_phase),
        ("romanian-deadlift", romanian_deadlift, offset(grip_point(), Vector((0, -12, 0))), held_phase),
        ("db-rdl", db_rdl, offset(grip_point(), X * 16), held_phase),
        ("deadlift", deadlift, offset(grip_point(), Vector((0, -12, 0))), held_phase),
        ("kb-swing", kb_swing, offset(swing_bell, X * 26), swing_phase),
        ("standing-calf-raise", calf_raise, offset(left_heel, X * 16), held_phase),
    ]


def write_action(rig, name, samples):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    slot = action.slots.new(id_type="OBJECT", name=rig.name)
    bag = action.layers.new("Layer").strips.new(type="KEYFRAME").channelbags.new(slot)
    frames = range(1, len(samples) + 1)
    for name in samples[0]:
        for channel, (path, size) in enumerate((("location", 3), ("rotation_quaternion", 4), ("scale", 3))):
            for index in range(size):
                curve = bag.fcurves.new(f'pose.bones["{name}"].{path}', index=index)
                curve.keyframe_points.add(len(samples))
                curve.keyframe_points.foreach_set("co", [v for f, s in zip(frames, samples) for v in (f, s[name][channel][index])])
                curve.keyframe_points.foreach_set("interpolation", [1] * len(samples))
                curve.update()
    return action, slot


def build(source: Path, textures: Path) -> Path:
    rig, surface, normal_map = load(source, textures)
    pose = bind(rig, surface)
    counts = zones(pose, surface)
    surface.data.materials.append(material("Body", GREY, normal_map=normal_map))
    for zone in ZONES:
        surface.data.materials.append(material(f"muscle:{zone}", GREY, normal_map=normal_map))
    modifier = surface.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig

    props = Props(rig)
    props.object.data.materials.append(material("Equipment", IRON, roughness=0.35))
    props.object.data.materials.append(material("Motion arrow", ARROW, emission=1.0))
    props.dumbbell("dumbbell_l", 16)
    props.dumbbell("dumbbell_r", 16)
    props.dumbbell("dumbbell_long", 26)
    props.barbell()
    props.kettlebell()
    ball = pose.rest[bone("Left", "ToeBase")].translation
    props.step(STEP_HEIGHT, ball.y + 3)
    pose.adopt(props.bones)
    prop_names = ["dumbbell_l", "dumbbell_r", "dumbbell_long", "barbell", "kettlebell", "step"]

    plans = exercises(pose, surface.data)
    arrows = {}
    for key, fn, track, _ in plans:
        path = []
        for i in range(25):
            pose.reset()
            fn(i / 24)
            path.append(track())
        arrows[key] = path
    for key, path in arrows.items():
        props.arrow(f"arrow:{key}:out", path)
        props.arrow(f"arrow:{key}:back", path[::-1])
    props.finish()

    pose.adopt(props.bones)
    names = list(pose.rest)

    first = None
    for key, fn, track, timing in plans:
        samples = []
        previous = {}
        for frame_index in range(FRAMES):
            t = frame_index / FPS
            s = timing(t)
            pose.reset()
            shown = fn(s)
            trend = timing(min(t + 0.2, 4)) - timing(max(t - 0.05, 0))
            sample = {}
            for name in names:
                basis = pose.basis(name)
                scale = (1.0,) * 3
                if name in prop_names:
                    if name in shown:
                        basis = pose.rest[name].inverted() @ shown[name]
                    else:
                        scale = (0.001,) * 3
                elif name.startswith("arrow:"):
                    visible = name == f"arrow:{key}:out" and trend > 0.002 or name == f"arrow:{key}:back" and trend < -0.002
                    scale = (1.0,) * 3 if visible else (0.001,) * 3
                elif name != HIPS:
                    assert basis.translation.length < 1e-2, f"{name} drifted"
                q = basis.to_quaternion()
                if name in previous and previous[name].dot(q) < 0:
                    q.negate()
                previous[name] = q
                sample[name] = (basis.translation if name in prop_names or name == HIPS else Vector(), q, scale)
            samples.append(sample)
        loop = [(samples[0][n][1].rotation_difference(samples[-1][n][1])).angle for n in names]
        assert max(loop) < 1e-3, f"{key} does not loop"
        action, slot = write_action(rig, key, samples)
        first = first or (action, slot)
        print(f"{key}: {len(samples)} frames")

    rig.animation_data_create()
    rig.animation_data.action, rig.animation_data.action_slot = first
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, FRAMES
    print("zones", counts)

    output = Path(__file__).resolve().parents[1] / "assets/models/exercises.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (rig, surface, props.object):
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_cameras=False,
        export_lights=False,
        export_image_format="JPEG",
        export_jpeg_quality=85,
    )
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fighter_blend", type=Path)
    parser.add_argument("textures", type=Path)
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    parsed = parser.parse_args(arguments)
    print(build(parsed.fighter_blend, parsed.textures))
