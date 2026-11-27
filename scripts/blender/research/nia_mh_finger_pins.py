"""Finger key points for a Nia conform attempt (adapted from Crossroads finger_pins.py, Duke pilot).

Finds the 5 finger tips of each hand on the target by a surface trace from the wrist, and pins
the MetaHuman tip vertex and a mid-finger vertex of each finger. Adds the face pins of an earlier file.

  Blender -b --factory-startup -P nia_mh_finger_pins.py -- <work with good hands> <face pins json> <out json>
"""
import bpy, bmesh, sys, json, heapq, math
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
argv = sys.argv[sys.argv.index("--") + 1:]
WORKDIR, FACE, OUTF = argv
bpy.ops.wm.open_mainfile(filepath=f"{WORKDIR}/fit/posed-import.blend")
fit = bpy.data.objects["posed_combined_lod0_mesh"]; rig = bpy.data.objects["posed_body_rig"]
for pb in rig.pose.bones: pb.matrix_basis.identity()
for o in list(bpy.data.objects):
    if o not in (fit, rig): bpy.data.objects.remove(o)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=f"{WORKDIR}/source/fit-source.glb")
tgt = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
bm = bmesh.new(); bm.from_mesh(tgt.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); bm.to_mesh(tgt.data); bm.free()
for x in fit.modifiers: x.show_viewport = False
bpy.context.view_layer.update()
fa=np.array([tuple(fit.matrix_world@v.co) for v in fit.data.vertices]); ta=np.array([tuple(tgt.matrix_world@v.co) for v in tgt.data.vertices])
gi={g.name:g.index for g in fit.vertex_groups}
def grp(n,lo=0.5):
    r=np.array([v.index for v in fit.data.vertices if any(g.group==gi[n] and g.weight>lo for g in v.groups)],int)
    if len(r)==0 and lo>0.1: print("GRPFALLBACK",n); return grp(n,0.1)
    return r
adj=[[] for _ in range(len(ta))]
for e in tgt.data.edges:
    a,b=e.vertices; w=float(np.linalg.norm(ta[a]-ta[b])); adj[a].append((b,w)); adj[b].append((a,w))
tkd=KDTree(len(ta))
for i,p in enumerate(ta): tkd.insert(p,i)
tkd.balance()
F=("thumb","index","middle","ring","pinky")
pins={}; report={}
for S,s in (("L","l"),("R","r")):
    hc=fa[grp(f"hand_{s}")].mean(0); mc=fa[grp(f"middle_01_{s}")].mean(0); d=(mc-hc)/np.linalg.norm(mc-hc)
    proj=(ta-hc)@d
    near=(np.linalg.norm(ta-hc,axis=1)<0.2)&(proj>-0.03)
    st=int(np.argmin(np.where(near,np.linalg.norm(ta-hc,axis=1),9)))
    hand=np.zeros(len(ta),bool); hand[st]=True; q=[st]
    while q:
        u=q.pop()
        for v,_ in adj[u]:
            if near[v] and not hand[v]: hand[v]=True; q.append(v)
    dist=np.linalg.norm(ta-hc,axis=1)
    hi=np.nonzero(hand)[0]
    cand=[i for i in hi if proj[i]>0.0 and dist[i]>=max(dist[j] for _,j,_ in tkd.find_range(ta[i],0.02) if hand[j])]
    cand.sort(key=lambda i:-dist[i]); tips=[]
    for i in cand:
        if all(np.linalg.norm(ta[i]-ta[j])>0.018 for j in tips): tips.append(i)
        if len(tips)==5: break
    if len(tips)!=5: raise RuntimeError(f"finger tips found for {S}: {len(tips)} (expected 5)")
    # Nia A-pose, palms forward: the thumb reaches least along the hand axis.
    thumb=min(tips,key=lambda i:proj[i]); ftips=[t for t in tips if t!=thumb]
    report[S]={"hand_verts":int(hand.sum()),"n_cand":len(cand),"tip_dist_mm":[round(float(dist[t])*1000,1) for t in tips]}
    order=[thumb]+sorted(ftips,key=lambda i:np.linalg.norm(ta[i]-ta[thumb]))
    for f,ti in zip(F,order):
        v3=grp(f"{f}_03_{s}"); c2=fa[grp(f"{f}_02_{s}")].mean(0); c3=fa[v3].mean(0); t=(c3-c2)/np.linalg.norm(c3-c2)
        mtip=int(v3[np.argmax((fa[v3]-c2)@t)])
        pins[f"{f}_tip_{S}"]={"vertex":mtip,"blender_m":ta[ti].tolist()}
        dmid=float(np.linalg.norm(fa[mtip]-c2))
        gd={ti:0.0}; pq=[(0.0,ti)]
        while pq:
            dd,u=heapq.heappop(pq)
            if dd>gd.get(u,9) or dd>dmid+0.01: continue
            for v,w in adj[u]:
                if hand[v] and dd+w<gd.get(v,9): gd[v]=dd+w; heapq.heappush(pq,(dd+w,v))
        sl=[j for j,x in gd.items() if abs(x-dmid)<0.0025]
        c0=ta[sl].mean(0); tt=(ta[ti]-c0)/np.linalg.norm(ta[ti]-c0)
        c=ta[sl].mean(0); n=np.array([0,-1.0,0]); n-=(n@tt)*tt; n/=np.linalg.norm(n)
        dj=sl[int(np.argmax((ta[sl]-c)@n))]
        v2=grp(f"{f}_02_{s}"); nm=np.array([0,-1.0,0]); nm-=(nm@t)*t; nm/=np.linalg.norm(nm)
        mv=int(v2[np.argmax((fa[v2]-c2)@nm)])
        pins[f"{f}_mid_{S}"]={"vertex":mv,"blender_m":ta[dj].tolist()}
for k,v in pins.items():
    x,y,z=v["blender_m"]; v["ue_cm"]=[x*100,-y*100,z*100]
face=json.load(open(FACE))
allp={k:{"vertex":v["vertex"],"ue_cm":v["ue_cm"]} for k,v in face["pins"].items()}
allp.update({k:{"vertex":v["vertex"],"ue_cm":v["ue_cm"]} for k,v in pins.items()})
json.dump({"native_vertex_count":len(fa),"pins":allp,"finger_report":report},open(OUTF,"w"),indent=1)
print("FPREPORT",report); print("NPINS",len(allp),"finger",len(pins))
