import bpy
bpy.ops.wm.open_mainfile(filepath="/Users/william-meroxa/Development/atl-arcade-epic/assets/skaters/nia/raw/nia-animated.blend")
fixed=0
for mt in bpy.data.materials:
    if not mt.use_nodes or not mt.node_tree: continue
    for n in mt.node_tree.nodes:
        if n.type!='BSDF_PRINCIPLED': continue
        mi=n.inputs.get('Metallic')
        if mi:
            for l in list(mi.links): mt.node_tree.links.remove(l)
            mi.default_value=0.0; fixed+=1
        sp=n.inputs.get('Specular IOR Level')
        if sp is None: sp=n.inputs.get('Specular')
        if sp is not None:
            for l in list(sp.links): mt.node_tree.links.remove(l)
            sp.default_value=0.3
print("materials fixed:",fixed)
bpy.ops.wm.save_as_mainfile(filepath="/Users/william-meroxa/Development/atl-arcade-epic/assets/skaters/nia/raw/nia-animated.blend")
