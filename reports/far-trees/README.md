# Far tree impostors (#281): screenshots

Each pair is the same view with the far tree layer (`on`) and with `?farTrees=0` (`off`). The level is `beltline-eastside`, 1280 x 720, headless Chromium with SwiftShader.

| Name | Camera |
| --- | --- |
| spawn | The default follow view at the spawn on the trail. |
| roof | `view=fixed&cam=-150,74,-720,-330,0,-520`: the roof of Signal House Apartments (68 m), looking south-west over Historic Fourth Ward Park. |
| map | `view=fixed&cam=300,320,-80,0,0,-420`: a high view over the whole level. The full map overlay (M) shows the baked iso map, which does not show the layer, so this view stands for the full map. |

- `*-high-*`: the high tier (`?quality=high`, the pbr look), layer to 450 m.
- `*-low-farTrees1.jpg` and `*-low-off.jpg`: the low tier. The low tier has no layer by default (see `docs/decisions.md`). The `farTrees1` shots show the layer turned on with `?farTrees=1`, to 320 m, in the fog.
