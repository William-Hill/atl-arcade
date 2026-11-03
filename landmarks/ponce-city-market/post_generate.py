# Post-generation code refinement for the img2threejs factory (refine-code).
# Run after generate_threejs_factory.py: python3 post_generate.py
#
# The generator builds every cone and cylinder with a fixed radial segment
# count for the budget tier (8 or 16) and does
# not read a per-part segment count. The hipped roof of the Ponce City Market
# tower has 4 faces, so this patch gives the roof cone 4 segments. The spec
# turns the roof 45 degrees (transform.rotation), so its edges sit on the
# diagonals, and records the segment count
# (hip-roof.geometryDescriptor.radialSegments = 4).

import re
import sys

PATH = "src/createPonceCityMarketModel.ts"
src = open(PATH).read()
pattern = re.compile(r"new THREE\.CylinderGeometry\((endpoint_hip_roof_\d+)\.endRadius, \1\.baseRadius, \1\.length, \d+, \d+\)")
patched, count = pattern.subn(r"new THREE.CylinderGeometry(\1.endRadius, \1.baseRadius, \1.length, 4, 1)", src)
if count != 1:
    sys.exit(f"post_generate: expected 1 hip-roof geometry, found {count}")
open(PATH, "w").write(patched)
print("post_generate: hip roof has 4 segments")

# Flat boxes: 1 segment per face (geometryDescriptor.boxSegments = 1 in the
# spec). The budget tier subdivides boxes, which costs 192 triangles a box
# with no gain for a flat, undisplaced face.
src = open(PATH).read()
patched, n = re.subn(r"new THREE\.BoxGeometry\(1, 1, 1, \d+, \d+, \d+\)", "new THREE.BoxGeometry(1, 1, 1, 1, 1, 1)", src)
open(PATH, "w").write(patched)
print(f"post_generate: {n} box geometries at 1 segment")
