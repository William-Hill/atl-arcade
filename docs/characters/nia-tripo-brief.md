# Tripo brief: the Nia model (M1-01, #11)

The user makes the model in the Tripo web UI, because that account has more credits. Then an agent does the cleanup with the Blender MCP.

## Steps in the Tripo UI

1. Open Tripo and select **Image to 3D**.
2. Upload `docs/characters/concept/nia/nia-tpose-front.png`.
3. Set the texture on. Use the highest model version that your plan allows.
4. Keep the pose a T-pose. Do not let Tripo change the pose.
5. Generate. Compare the result with the dossier `docs/characters/nia-sway-ellis.md`.
6. Make sure that the skates show four wheels each and that the skates are part of the mesh.
7. If Tripo offers auto-rig for a humanoid, rig the model. Do not add animations in Tripo.
8. Export the model as **GLB**.
9. Put the file at `assets/skaters/nia/raw/nia-tripo.glb`.
10. Write down the Tripo task ID, the model version, the options, and the credits that you spent.

The `raw/` folder is not in git, because the raw GLB can be larger than 10 MB.

## Reject the model if

- the skates look like inline skates, shoes, or a skateboard,
- the arms or the legs join the body,
- the braids or the jacket make a large loose shape,
- the model has logos or text.

If you reject the model, generate it again. Record the credits for each try.

## After the export (agent work)

1. Blender MCP: import the GLB, check the scale (1 unit = 1 m, height about 1.7 m with skates), and set the feet on the ground at the origin.
2. Blender MCP: reduce the mesh to under 20,000 triangles. Keep the face and the skates sharp.
3. Rig: keep the Tripo rig if it is a clean humanoid rig. If not, rig the model in Blender.
4. Animate: use Cascadeur through its MCP. If Cascadeur does not work, animate with the Blender MCP.
5. Export `assets/skaters/nia/skater.glb` with Draco compression, under 3 MB.
6. Write `assets/skaters/nia/provenance.json` with the tool, the prompt, the credits, and the date.
7. Load the model in Three.js with `GLTFLoader` and `DRACOLoader`, and commit five-view screenshots.
