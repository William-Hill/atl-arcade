import bpy
bpy.ops.wm.open_mainfile(filepath="/Users/william-meroxa/Development/atl-arcade-epic/assets/skaters/marcus/raw/marcus-rig-work.blend")
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
col=bpy.data.collections['MARCUS_RIG_WORK']
# rigid keep-list by centroid rules: very low (toe stops/wheels z<0.05) stay rigid
import mathutils
soft=[]
for o in col.objects:
    if o.type!='MESH': continue
    ws=[o.matrix_world@v.co for v in o.data.vertices]
    z=sum(v.z for v in ws)/len(ws)
    if z>=0.05: soft.append(o)
print("soft parts:",[o.name for o in soft])
for m in soft:
    bpy.ops.object.select_all(action='DESELECT')
    m.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    nz=sum(1 for v in m.data.vertices for g in v.groups if g.weight>0.01)
    print(m.name,"verts:",nz,"/",len(m.data.vertices))
bpy.ops.wm.save_as_mainfile(filepath="/Users/william-meroxa/Development/atl-arcade-epic/assets/skaters/marcus/raw/marcus-rig-work.blend")
