import bpy, re
bpy.ops.wm.open_mainfile(filepath="/Users/william-meroxa/Development/atl-arcade-epic/assets/skaters/nia/raw/nia-animated.blend")
obj=[o for o in bpy.data.objects if o.type=='MESH'][0]
mesh=obj.data
print("layers before:",len(mesh.uv_layers))
layers={l.name:l for l in mesh.uv_layers}
def part_num(mt):
    # from material's base color image name
    for n in (mt.node_tree.nodes if mt and mt.use_nodes and mt.node_tree else []):
        if n.type=='TEX_IMAGE' and n.image:
            m=re.search(r'tripo_part_(\d+)_base',n.image.name)
            if m: return int(m.group(1))
    m=re.search(r'(\d+)',mt.name or '')
    return int(m.group(1)) if m else None
mat_layer={}
for i,slot in enumerate(obj.material_slots):
    p=part_num(slot.material)
    l=layers.get(f'tripo_part_{p}_NewUVMap') if p is not None else None
    if l: mat_layer[i]=l
    else: print("no layer for slot",i,slot.material.name if slot.material else '?',"part",p)
uv=layers['tripo_part_0_NewUVMap']; uv.name='UVMap'; uv=mesh.uv_layers['UVMap']
copied=0
for poly in mesh.polygons:
    src=mat_layer.get(poly.material_index)
    if src is None: continue
    for li in poly.loop_indices:
        uv.data[li].uv=src.data[li].uv
    copied+=1
print("polys copied:",copied,"of",len(mesh.polygons))
mesh.uv_layers.active=uv
for l in list(mesh.uv_layers):
    if l.name!='UVMap': mesh.uv_layers.remove(l)
print("layers after:",len(mesh.uv_layers))
bpy.ops.wm.save_as_mainfile(filepath="/Users/william-meroxa/Development/atl-arcade-epic/assets/skaters/nia/raw/nia-animated.blend")
