"""Measure one MetaHuman conform attempt of Nia against the fit source (research spike).

Adapted from Crossroads pipeline/metahuman_fit/blender/fit/measure.py, render_faces.py and
common.py (Duke pilot, 1.80 m). The heights of the Duke script scale by K = 1.70 / 1.80.

  Blender -b --factory-startup -P nia_mh_measure.py -- render <work> <attempt>
  <python with mediapipe> crossroads/.../landmarks2d.py   (MHFIT_WORK, MHFIT_FIGHTER point at <work>/..)
  Blender -b --factory-startup -P nia_mh_measure.py -- measure <work> <attempt>

<work> is the unreal_stage work folder: fit/posed-import.blend and source/fit-source.glb.
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:]
MODE, WORKDIR, ATTEMPT = argv[0], os.path.expanduser(argv[1]), int(argv[2])
MEAS = f"{WORKDIR}/measure/a{ATTEMPT:02d}"
os.makedirs(MEAS, exist_ok=True)
K = 1.70 / 1.80
CAM_Z = json.load(open(f"{WORKDIR}/source/portrait-camera.json"))["location_cm"][2] / 100.0


def load():
    bpy.ops.wm.open_mainfile(filepath=f"{WORKDIR}/fit/posed-import.blend")
    fit = bpy.data.objects["posed_combined_lod0_mesh"]
    rig = bpy.data.objects["posed_body_rig"]
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    for o in list(bpy.data.objects):
        if o not in (fit, rig):
            bpy.data.objects.remove(o)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{WORKDIR}/source/fit-source.glb")
    tgt = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
    bm = bmesh.new(); bm.from_mesh(tgt.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(tgt.data); bm.free()
    for x in fit.modifiers:
        x.show_viewport = False; x.show_render = False
    bpy.context.view_layer.update()
    return fit, rig, tgt


def world_mesh(o):
    dg = bpy.context.evaluated_depsgraph_get(); e = o.evaluated_get(dg); me = e.to_mesh()
    vs = [o.matrix_world @ v.co for v in me.vertices]; fs = [tuple(p.vertices) for p in me.polygons]
    e.to_mesh_clear(); return vs, fs


fit, rig, tgt = load()
if MODE == "render":
    sc = bpy.context.scene; sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading; sh.light = "STUDIO"; sh.color_type = "SINGLE"
    sh.single_color = (0.75, 0.6, 0.5); sh.show_cavity = True
    sc.view_settings.view_transform = "Standard"
    cam = bpy.data.objects.new("mcam", bpy.data.cameras.new("mcam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, -0.75, CAM_Z); cam.rotation_euler = (math.pi / 2, 0, 0)
    cam.data.sensor_fit = "HORIZONTAL"; cam.data.angle = math.radians(40)
    sc.render.resolution_x = sc.render.resolution_y = 1024
    rig.hide_render = True
    for show, name in ((fit, "fit"), (tgt, "target")):
        for o in (fit, tgt):
            o.hide_render = o is not show
        sc.render.filepath = f"{MEAS}/face_{name}.png"; bpy.ops.render.render(write_still=True)
    print("RENDER_DONE"); sys.exit(0)
FV,FF=world_mesh(fit); TV,TF=world_mesh(tgt)
fa=np.array([tuple(v) for v in FV]); ta=np.array([tuple(v) for v in TV])
fbvh=BVHTree.FromPolygons(FV,FF); tbvh=BVHTree.FromPolygons(TV,TF)
info={}
Bbone={b.name:(rig.matrix_world@b.head_local) for b in rig.data.bones}
gidx={g.name:g.index for g in fit.vertex_groups}
W={}
for v in fit.data.vertices:
    for g in v.groups:
        if g.weight>0.0: W.setdefault(g.group,[]).append((v.index,g.weight))
def centroid(name,lo=0.5,hi=1.01):
    rows=[(i,w) for i,w in W.get(gidx.get(name,-1),[]) if lo<=w<hi]
    if not rows: return None
    return Vector(tuple(fa[[i for i,_ in rows]].mean(0)))
class _B(dict):
    def __missing__(self,k):
        c=centroid(k); self[k]=c if c is not None else Bbone[k]; return self[k]
B=_B()
info["bone_vs_centroid_mm"]={k:(Bbone[k]-centroid(k)).length*1000 for k in ("hand_l","foot_l","head","index_03_l") if centroid(k) is not None}

side={"L":"l","R":"r"}
# height
h={"source":float((ta[:,2].max()-ta[:,2].min())*1000),"fit":float((fa[:,2].max()-fa[:,2].min())*1000)}
# tips
def tip(arr,p0,d,rad,maxlen=0.07):
    rel=arr-np.array(p0); s=rel@np.array(d); perp=np.linalg.norm(rel-np.outer(s,d),axis=1)
    m=(s>0)&(s<maxlen)&(perp<rad)
    if not m.any(): return None,0
    i=np.argmax(np.where(m,s,-1)); return arr[i],int(m.sum())
tips={}
for S,s in side.items():
    for f in ("thumb","index","middle","ring","pinky"):
        p2,p3=B[f"{f}_02_{s}"],B[f"{f}_03_{s}"]; d=(p3-p2).normalized(); p3=p2
        a,na=tip(fa,p3,d,0.009); r=0.009; b,nb=tip(ta,p3,d,r)
        if b is None: r=0.02; b,nb=tip(ta,p3,d,r)
        tips[f"{f}_{S}"]=None if a is None or b is None else float(np.linalg.norm(a-b)*1000)
        info[f"tip_{f}_{S}"]={"fit_pts":na,"tgt_pts":nb,"tgt_radius_m":r}
    p1,p2=B[f"bigtoe_01_{s}"],B[f"bigtoe_02_{s}"]; d=(p2-p1).normalized(); p2=p1
    a,na=tip(fa,p2,d,0.012); b,nb=tip(ta,p2,d,0.012)
    tips[f"big_toe_{S}"]=None if a is None or b is None else float(np.linalg.norm(a-b)*1000)
    info[f"tip_big_toe_{S}"]={"fit_pts":na,"tgt_pts":nb}
# circumference: tape-measure = convex hull perimeter of the plane section cluster nearest the joint
def hull_perimeter(q):
    p=sorted(map(tuple,q))
    def cr(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo=[];up=[]
    for x in p:
        while len(lo)>=2 and cr(lo[-2],lo[-1],x)<=0: lo.pop()
        lo.append(x)
    for x in reversed(p):
        while len(up)>=2 and cr(up[-2],up[-1],x)<=0: up.pop()
        up.append(x)
    h=np.array(lo[:-1]+up[:-1]); return float(np.linalg.norm(h-np.roll(h,1,axis=0),axis=1).sum())
def cluster_nearest(q,eps):
    seed=int(np.argmin(np.linalg.norm(q,axis=1))); inc=np.zeros(len(q),bool); inc[seed]=True; front=[seed]
    while front:
        i=front.pop(); m=(~inc)&(np.linalg.norm(q-q[i],axis=1)<eps); idx=np.nonzero(m)[0]; inc[idx]=True; front.extend(idx.tolist())
    return q[inc]
def section(arr,faces,P,N,R):
    P=np.array(P);N=np.array(N)/np.linalg.norm(N); dist=(arr-P)@N
    near=np.linalg.norm(arr-P,axis=1)<R
    pts=[]
    for f in faces:
        if not any(near[i] for i in f): continue
        for i in range(len(f)):
            a,b=f[i],f[(i+1)%len(f)]
            if (dist[a]>0)!=(dist[b]>0):
                t=dist[a]/(dist[a]-dist[b]); pts.append(arr[a]+(arr[b]-arr[a])*t)
    if len(pts)<8: return None
    pts=np.array(pts); pts=pts[np.linalg.norm(pts-P,axis=1)<R]
    if len(pts)<8: return None
    u=np.cross(N,[0,0,1.0]);
    if np.linalg.norm(u)<1e-3: u=np.cross(N,[1.0,0,0])
    u/=np.linalg.norm(u); v=np.cross(N,u); q=np.c_[(pts-P)@u,(pts-P)@v]
    qc=cluster_nearest(q,0.006)
    if len(qc)<8: return None
    return hull_perimeter(qc), int(len(qc)), float(np.linalg.norm(qc,axis=1).min())
rings={}
_EDGES={}; _EDGES[id(fa)]=np.array([tuple(e.vertices) for e in fit.data.edges]); _EDGES[id(ta)]=np.array([tuple(e.vertices) for e in tgt.data.edges])

def slab_girth(arr,P,N,R,half=0.003):
    # plane section through mesh edges (vertex slabs undersample the coarser fit mesh)
    E=_EDGES[id(arr)]; P=np.array(P);N=np.array(N)/np.linalg.norm(N)
    da=(arr[E[:,0]]-P)@N; db=(arr[E[:,1]]-P)@N; c=da*db<0
    a=arr[E[c,0]]; b=arr[E[c,1]]; t=(da[c]/(da[c]-db[c]))[:,None]; pts=a+(b-a)*t
    d=pts-P; h=d@N; m=np.linalg.norm(d-np.outer(h,N),axis=1)<R
    if m.sum()<12: return None
    u=np.cross(N,[0,0,1.0])
    if np.linalg.norm(u)<1e-3: u=np.cross(N,[1.0,0,0])
    u/=np.linalg.norm(u); v=np.cross(N,u); q=np.c_[d[m]@u,d[m]@v]
    return hull_perimeter(q), int(m.sum())
def slab_girth_vertices(arr,P,N,R,half=0.003):
    P=np.array(P);N=np.array(N)/np.linalg.norm(N); d=arr-P; h=d@N
    rad=np.linalg.norm(d-np.outer(h,N),axis=1); m=(np.abs(h)<half)&(rad<R)
    if m.sum()<12: return None
    u=np.cross(N,[0,0,1.0])
    if np.linalg.norm(u)<1e-3: u=np.cross(N,[1.0,0,0])
    u/=np.linalg.norm(u); v=np.cross(N,u); q=np.c_[d[m]@u,d[m]@v]
    return hull_perimeter(q), int(m.sum())
def min_girth(arr,axis_fn,N,R,steps):
    best=None
    for k in range(steps):
        P=axis_fn(arr,k)
        if P is None: continue
        r=slab_girth(arr,P,N,R)
        if r and (best is None or r[0]<best[0]): best=(r[0],r[1],[float(x) for x in P])
    return best
def ring(name,axis_fn,N,R,steps):
    a=min_girth(fa,axis_fn,N,R,steps); b=min_girth(ta,axis_fn,N,R,steps)
    info["ring_"+name]={"fit":a,"tgt":b}
    rings[name]={"source":b[0]*1000 if b else None,"fit":a[0]*1000 if a else None}
def slab_center(arr,z,mask_fn):
    m=(np.abs(arr[:,2]-z)<0.003)&mask_fn(arr)
    return arr[m].mean(0) if m.sum()>12 else None
for S,s in side.items():
    hc=np.array(tuple(B[f"hand_{s}"])); N=np.array(tuple((B[f"hand_{s}"]-B[f"lowerarm_twist_02_{s}"]).normalized()))
    def wr(arr,k,hc=hc,N=N):
        P=hc-N*(0.0+0.005*k); d=arr-P; h=d@N; m=(np.abs(h)<0.003)&(np.linalg.norm(d-np.outer(h,N),axis=1)<0.06)
        return arr[m].mean(0) if m.sum()>12 else None
    ring(f"wrist_{S}",wr,N,0.05,17)
    sgn=1 if S=="L" else -1
    ring(f"ankle_{S}",lambda arr,k,sgn=sgn: slab_center(arr,K*0.08+0.005*k,lambda a: a[:,0]*sgn>0.03),np.array([0,0,1.0]),0.07,25)
hy=float(fa[fa[:,2]>K*1.65][:,1].mean())
# Neck: a true plane section (all edge crossings with |x| < 0.08 m), the smallest hull perimeter
# for z from K*1.40 to K*1.56. The Duke slab ring drifted to the chin on Nia (attempts 3 and 4).
def plane_hull(arr,z):
    E=_EDGES[id(arr)]; a,b=arr[E[:,0]],arr[E[:,1]]; c=(a[:,2]-z)*(b[:,2]-z)<0
    t=((z-a[c,2])/(b[c,2]-a[c,2]))[:,None]; q=(a[c]+(b[c]-a[c])*t); q=q[np.abs(q[:,0])<0.08]
    return (hull_perimeter(q[:,:2]),len(q)) if len(q)>=12 else None
def neck_min(arr):
    best=None
    for k in range(33):
        z=K*1.40+0.005*k; r=plane_hull(arr,z)
        if r and (best is None or r[0]<best[0]): best=(r[0],r[1],z)
    return best
na,nb=neck_min(fa),neck_min(ta)
info["ring_neck"]={"fit":na,"tgt":nb,"method":"plane section, min over z"}
rings["neck"]={"source":nb[0]*1000,"fit":na[0]*1000}
chin=hy
info["neck_chin_z"]=chin
# face landmarks via 2D detections ray-cast from the shared camera
lm=json.load(open(f"{MEAS}/landmarks2d.json"))
cam=Vector((0,-0.75,CAM_Z)); t=math.tan(math.radians(20))
def cast(bvh,x,y):
    d=Vector(((x/512-1)*t,1,-(y/512-1)*t)).normalized(); hit=bvh.ray_cast(cam,d,2.0); return hit[0]
face={}
fit_lm=lm.get("fit") or {}; tgt_lm=lm.get("target") or {}
for k in sorted(set(fit_lm)|set(tgt_lm)):
    a=cast(fbvh,*fit_lm[k]) if k in fit_lm else None; b=cast(tbvh,*tgt_lm[k]) if k in tgt_lm else None
    face[k]=None if a is None or b is None else (a-b).length*1000
    info["lm_"+k]={"fit":a and list(a),"tgt":b and list(b)}
# surface, both directions
def nearest(bvh,arr): return np.array([(Vector(p)-bvh.find_nearest(Vector(p))[0]).length for p in arr])*1000
d_ft=nearest(tbvh,fa); d_tf=nearest(fbvh,ta)
info["surface_fit_to_tgt"]={"mean":float(d_ft.mean()),"p95":float(np.percentile(d_ft,95)),"max":float(d_ft.max())}
info["surface_tgt_to_fit"]={"mean":float(d_tf.mean()),"p95":float(np.percentile(d_tf,95)),"max":float(d_tf.max())}
surf={"mean":max(info["surface_fit_to_tgt"]["mean"],info["surface_tgt_to_fit"]["mean"]),"p95":max(info["surface_fit_to_tgt"]["p95"],info["surface_tgt_to_fit"]["p95"]),"samples":int(min(len(d_ft),len(d_tf)))}
# per-region surface (fit->target) for diagnosis
regions={"head":fa[:,2]>K*1.55,"hands":None,"feet":fa[:,2]<0.10}
hand_m=np.zeros(len(fa),bool)
for s in "lr": hand_m|=np.linalg.norm(fa-np.array(B[f"hand_{s}"]),axis=1)<0.14
regions["hands"]=hand_m
regions["torso_arms_legs"]=~(regions["head"]|hand_m|regions["feet"])
info["surface_region_fit_to_tgt"]={k:{"n":int(m.sum()),"mean":float(d_ft[m].mean()),"p95":float(np.percentile(d_ft[m],95))} for k,m in regions.items()}
# finger gaps on the fit
names=[g.name for g in fit.vertex_groups]
def finger_verts(f,s):
    idx=[i for i,n in enumerate(names) if (n.startswith(f+"_02") or n.startswith(f+"_03")) and n.endswith("_"+s)]
    out=[]
    for v in fit.data.vertices:
        w=sum(g.weight for g in v.groups if g.group in idx)
        if w>0.5: out.append(FV[v.index])
    return out
gaps={}
for S,s in side.items():
    sets={f:finger_verts(f,s) for f in ("thumb","index","middle","ring","pinky")}
    for a,b in (("thumb","index"),("index","middle"),("middle","ring"),("ring","pinky")):
        A,Bs=sets[a],sets[b]
        if not A or not Bs: gaps[f"{a}_{b}_{S}"]=None; continue
        kd=KDTree(len(Bs))
        for i,p in enumerate(Bs): kd.insert(p,i)
        kd.balance(); gaps[f"{a}_{b}_{S}"]=min(kd.find(p)[2] for p in A)*1000
        info[f"gap_{a}_{b}_{S}"]={"n":[len(A),len(Bs)]}
out={"character":"nia","attempt":ATTEMPT,"height_mm":h,"tip_error_mm":tips,"circumference_mm":rings,
     "face_landmark_error_mm":face,"surface_mm":surf,"finger_gap_mm":gaps,"diagnostics":info}
json.dump(out,open(f"{MEAS}/measurements_attempt{ATTEMPT:02d}.json","w"),indent=1,default=float)
print("MEASURE_DONE")
