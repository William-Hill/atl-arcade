# Post-generation code refinement for the Krog Street Market factory
# (refine-code). Run after generate_threejs_factory.py: python3 post_generate.py
#
# Flat boxes: 1 segment per face (geometryDescriptor.boxSegments = 1 in the
# spec). The budget tier subdivides boxes, which costs 192 triangles a box
# with no gain for a flat, undisplaced face.

import re

PATH = "src/createKrogStreetMarketModel.ts"
src = open(PATH).read()
patched, n = re.subn(r"new THREE\.BoxGeometry\(1, 1, 1, \d+, \d+, \d+\)", "new THREE.BoxGeometry(1, 1, 1, 1, 1, 1)", src)
open(PATH, "w").write(patched)
print(f"post_generate: {n} box geometries at 1 segment")

# Small bulbs: about 0.2 m across, so 12 x 8 segments read as round. The
# budget tier gives 32 x 20 (1216 triangles a bulb).
src = open(PATH).read()
patched, n = re.subn(r"new THREE\.SphereGeometry\(0\.5, \d+, \d+\)", "new THREE.SphereGeometry(0.5, 12, 8)", src)
open(PATH, "w").write(patched)
print(f"post_generate: {n} sphere geometries at 12 x 8 segments")
