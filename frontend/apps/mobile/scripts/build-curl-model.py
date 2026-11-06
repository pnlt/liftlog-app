"""Run with Blender: blender -b --python scripts/build-curl-model.py -- XBOT_GLB.

XBOT_GLB is Mixamo's X Bot as glTF, e.g. three.js examples/models/gltf/Xbot.glb.
"""

import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

MUSCLE = (1.0, 0.18, 0.02)
ARROW = (0.05, 0.6, 1.0)
SIDES = {"Left": 1, "Right": -1}
FINGERS = ["Index", "Middle", "Ring", "Pinky"]
CURL = [(0, 8), (0.5, 8), (1.1, 70), (1.6, 135), (2.0, 135), (2.8, 70), (3.5, 8), (4, 8)]
ARROW_UP = (0.3, 1.6)
ARROW_DOWN = (2.0, 3.5)


def material(name, color, emission=None, roughness=0.55):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def rotate_about(pose_bone, rotation, pivot):
    pose_bone.matrix = (
        Matrix.Translation(pivot)
        @ rotation.to_matrix().to_4x4()
        @ Matrix.Translation(-pivot)
        @ pose_bone.matrix
    )
    bpy.context.view_layer.update()


def build(source: Path) -> Path:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.parent is None:
            bpy.data.objects.remove(obj)
    rig = bpy.data.objects["Armature"]
    surface = bpy.data.objects["Beta_Surface"]
    joints = bpy.data.objects["Beta_Joints"]
    assert abs(rig.scale[0] - 0.01) < 1e-6 and surface.parent == joints.parent == rig
    rig.animation_data_clear()
    pose = rig.pose.bones

    def bone(side, name):
        return pose[f"mixamorig:{side}{name}"]

    for side, x in SIDES.items():
        palm = Vector((0, 0, -1))
        for finger in FINGERS + ["Thumb"]:
            for joint, angle in zip("123", (50, 75, 55) if finger != "Thumb" else (10, 35, 30)):
                pb = bone(side, f"Hand{finger}{joint}")
                along = (bone(side, f"Hand{finger}{int(joint) + 1}").head - pb.head).normalized()
                rotate_about(pb, Quaternion(along.cross(palm).normalized(), math.radians(angle)), pb.head)

        arm, forearm, hand = bone(side, "Arm"), bone(side, "ForeArm"), bone(side, "Hand")
        down = Vector((0.22 * x, -0.06, -1)).normalized()
        rotate_about(arm, (forearm.head - arm.head).rotation_difference(down), arm.head)
        palm = (bone(side, "HandMiddle1").head - hand.head).cross(
            bone(side, "HandIndex1").head - bone(side, "HandPinky1").head
        ).normalized() * x
        axis = (hand.head - forearm.head).normalized()
        forward = Vector((0, -1, 0))
        forward = (forward - axis * forward.dot(axis)).normalized()
        palm = (palm - axis * palm.dot(axis)).normalized()
        twist = math.atan2(axis.dot(palm.cross(forward)), palm.dot(forward))
        rotate_about(forearm, Quaternion(axis, twist), forearm.head)
        assert bone(side, "HandThumb1").head.x * x > bone(side, "HandPinky1").head.x * x, (
            "Thumb must point outward when supinated"
        )

    for mesh in (surface, joints):
        bpy.context.view_layer.objects.active = mesh
        name = next(m.name for m in mesh.modifiers if m.type == "ARMATURE")
        bpy.ops.object.modifier_apply(modifier=name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode="EDIT")
    hips = rig.data.edit_bones["mixamorig:Hips"]
    elbow = rig.data.edit_bones["mixamorig:LeftForeArm"].head.copy()
    for name in ("arrow_up", "arrow_down"):
        edit = rig.data.edit_bones.new(name)
        edit.head, edit.tail, edit.parent = elbow, elbow + Vector((0, 0, 5)), hips
    bpy.ops.object.mode_set(mode="OBJECT")
    for mesh in (surface, joints):
        modifier = mesh.modifiers.new("Armature", "ARMATURE")
        modifier.object = rig

    surface.data.materials[0] = material("Mannequin", (0.3, 0.31, 0.33))
    joints.data.materials[0] = material("Mannequin joints", (0.12, 0.12, 0.13))
    surface.data.materials.append(material("Target muscle", MUSCLE, emission=1.0))
    joints.data.materials.append(material("Dumbbell", (0.08, 0.08, 0.09), roughness=0.35))
    joints.data.materials.append(material("Motion arrow", ARROW, emission=1.0))

    groups = {g.index: g.name for g in surface.vertex_groups}
    selected = set()
    for side in SIDES:
        shoulder, elbow = bone(side, "Arm").head, bone(side, "ForeArm").head
        axis = elbow - shoulder
        forward = Vector((0, -1, 0))
        for vertex in surface.data.vertices:
            owner = max(vertex.groups, key=lambda g: g.weight, default=None)
            if owner is None or groups[owner.group] not in (
                f"mixamorig:{side}Arm",
                f"mixamorig:{side}ForeArm",
            ):
                continue
            along = (vertex.co - shoulder).dot(axis) / axis.length_squared
            radial = vertex.co - shoulder - along * axis
            if 0.22 < along < 0.95 and radial.normalized().dot(forward) > 0.2:
                selected.add(vertex.index)
    for polygon in surface.data.polygons:
        if all(v in selected for v in polygon.vertices):
            polygon.material_index = 1
    assert sum(p.material_index == 1 for p in surface.data.polygons) > 100, "Biceps zone empty"

    mesh = bmesh.new()
    mesh.from_mesh(joints.data)
    deform = mesh.verts.layers.deform.verify()
    added = []

    def add(geometry, group, material_index):
        index = joints.vertex_groups.get(group) or joints.vertex_groups.new(name=group)
        for vertex in geometry["verts"]:
            vertex[deform].clear()
            vertex[deform][index.index] = 1
        for face in {f for v in geometry["verts"] for f in v.link_faces}:
            face.material_index = material_index
            face.smooth = material_index == 2
            added.append(face)

    def place(geometry, matrix):
        bmesh.ops.transform(mesh, matrix=matrix, verts=geometry["verts"])
        return geometry

    for side, x in SIDES.items():
        hand = bone(side, "Hand")
        index, pinky = bone(side, "HandIndex1").head, bone(side, "HandPinky1").head
        axis = (index - pinky).normalized()
        fingers = (bone(side, "HandMiddle1").head - hand.head).normalized()
        palm = axis.cross(fingers).normalized() * -x
        center = (index + pinky) / 2 + palm * 2.4 + fingers * 1.2
        frame = Matrix.Translation(center) @ Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4()
        handle = bmesh.ops.create_cone(mesh, segments=16, radius1=1.6, radius2=1.6, depth=13, cap_ends=True)
        add(place(handle, frame), hand.name, 1)
        for offset in (-9.5, 9.5):
            plate = bmesh.ops.create_cone(mesh, segments=6, radius1=4.8, radius2=4.8, depth=6, cap_ends=True)
            add(place(plate, frame @ Matrix.Translation((0, 0, offset))), hand.name, 1)

    forearm = bone("Left", "ForeArm")
    down = (bone("Left", "Hand").head - forearm.head).normalized()
    forward = Vector((0, -1, 0))
    forward = (forward - down * forward.dot(down)).normalized()
    center = forearm.head + Vector((17, 0, 0))
    radius = 33

    def arc_point(degrees):
        t = math.radians(degrees)
        return center + radius * (math.cos(t) * down + math.sin(t) * forward)

    def arc_tangent(degrees, direction):
        t = math.radians(degrees)
        return direction * (-math.sin(t) * down + math.cos(t) * forward)

    for name, start, end in (("arrow_up", 30, 115), ("arrow_down", 115, 30)):
        steps, direction = 24, math.copysign(1, end - start)
        rings = []
        for i in range(steps + 1):
            degrees = start + (end - start) * i / steps
            ring = bmesh.ops.create_circle(mesh, segments=10, radius=0.9)["verts"]
            rotation = Vector((0, 0, 1)).rotation_difference(arc_tangent(degrees, direction))
            bmesh.ops.transform(
                mesh,
                matrix=Matrix.Translation(arc_point(degrees)) @ rotation.to_matrix().to_4x4(),
                verts=ring,
            )
            rings.append(ring)
        for a, b in zip(rings, rings[1:]):
            for j in range(10):
                mesh.faces.new((a[j], a[(j + 1) % 10], b[(j + 1) % 10], b[j]))
        tip, tangent = arc_point(end), arc_tangent(end, direction)
        head = bmesh.ops.create_cone(mesh, segments=16, radius1=2.6, radius2=0, depth=6, cap_ends=True)
        place(head, Matrix.Translation(tip + tangent * 3) @ Vector((0, 0, 1)).rotation_difference(tangent).to_matrix().to_4x4())
        add({"verts": [v for ring in rings for v in ring] + head["verts"]}, name, 2)
    bmesh.ops.recalc_face_normals(mesh, faces=added)
    mesh.to_mesh(joints.data)
    mesh.free()

    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start, scene.frame_end = 1, 121
    for side in SIDES:
        forearm = bone(side, "ForeArm")
        down = (bone(side, "Hand").head - forearm.head).normalized()
        forward = Vector((0, -1, 0))
        hinge = down.cross((forward - down * forward.dot(down)).normalized()).normalized()
        local_hinge = forearm.bone.matrix_local.to_3x3().inverted() @ hinge
        forearm.rotation_mode = "QUATERNION"
        for seconds, flexion in CURL:
            forearm.rotation_quaternion = Quaternion(local_hinge, math.radians(flexion))
            forearm.keyframe_insert("rotation_quaternion", frame=1 + round(seconds * 30))
    for name, (shown, hidden) in (("arrow_up", ARROW_UP), ("arrow_down", ARROW_DOWN)):
        arrow = pose[name]
        for seconds, size in ((0, 0.001), (shown, 1), (hidden, 0.001)):
            arrow.scale = (size,) * 3
            arrow.keyframe_insert("scale", frame=1 + round(seconds * 30))
    action = rig.animation_data.action
    action.name = "Dumbbell curl"
    for slot in action.slots:
        for curve in action.layers[0].strips[0].channelbag(slot).fcurves:
            for key in curve.keyframe_points:
                if curve.data_path.endswith("scale"):
                    key.interpolation = "CONSTANT"
                else:
                    key.handle_left_type = key.handle_right_type = "AUTO_CLAMPED"

    scene.frame_set(1)
    start = bone("Left", "Hand").head.copy()
    scene.frame_set(1 + round(1.8 * 30))
    top = bone("Left", "Hand").head.copy()
    assert top.z - start.z > 30 and top.y < start.y, "Curl must lift the hand forward and up"
    assert pose["arrow_up"].scale[0] < 0.01 and pose["arrow_down"].scale[0] < 0.01
    scene.frame_set(1 + round(1.0 * 30))
    assert pose["arrow_up"].scale[0] == 1 and pose["arrow_down"].scale[0] < 0.01
    scene.frame_set(121)
    assert (bone("Left", "Hand").head - start).length < 1e-4, "Loop must close"
    scene.frame_set(1)

    output = Path(__file__).resolve().parents[1] / "assets/models/db-curl.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (rig, surface, joints):
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_nla_strips_merged_animation_name="Dumbbell curl",
        export_force_sampling=True,
        export_frame_range=True,
        export_anim_slide_to_zero=True,
        export_cameras=False,
        export_lights=False,
    )
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xbot_glb", type=Path)
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    print(build(parser.parse_args(arguments).xbot_glb))
