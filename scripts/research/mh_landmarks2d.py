"""Find 8 face landmarks in face_fit.png and face_target.png with MediaPipe Face Mesh.

Same landmark indexes as Crossroads pipeline/metahuman_fit/blender/fit/landmarks2d.py.
Usage: <python with mediapipe 0.10.21 and opencv> mh_landmarks2d.py <measure folder>
"""
import json, sys
import cv2
import mediapipe as mp

MEAS = sys.argv[1]
IDX = {"eye_outer_L": 263, "eye_inner_L": 362, "eye_outer_R": 33, "eye_inner_R": 133,
       "nose_tip": 1, "mouth_corner_L": 291, "mouth_corner_R": 61, "chin": 152}
out = {}
with mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True,
                                     min_detection_confidence=0.3) as fm:
    for n in ("fit", "target"):
        img = cv2.imread(f"{MEAS}/face_{n}.png")
        h, w = img.shape[:2]
        r = fm.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if not r.multi_face_landmarks:
            out[n] = None; print("NOFACE", n); continue
        lm = r.multi_face_landmarks[0].landmark
        out[n] = {k: [lm[i].x * w, lm[i].y * h] for k, i in IDX.items()}
        for x, y in out[n].values():
            cv2.circle(img, (int(x), int(y)), 5, (0, 0, 255), -1)
        cv2.imwrite(f"{MEAS}/face_{n}_lm.png", img); print("FACE", n, len(out[n]))
json.dump(out, open(f"{MEAS}/landmarks2d.json", "w"), indent=1)
