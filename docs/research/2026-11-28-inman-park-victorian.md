# Inman Park Victorian houses: research for the `victorian-house` style (#407)

Date: 2026-11-28. Procedure: each fact below has a public source (the landmark research rule of #321). The facts are positive or neutral.

## Sources

| # | Source | Publisher | URL | Read |
|---|---|---|---|---|
| S1 | National Register of Historic Places Inventory, Nomination Form, "Inman Park" (NRIS 73000621, listed 1973-07-23) | U.S. Department of the Interior, National Park Service | https://npgallery.nps.gov/NRHP/GetAsset/NRHP/73000621_text (record: https://npgallery.nps.gov/AssetDetail/NRIS/73000621) | 2026-11-28, PDF text |
| S2 | "Inman Park", New Georgia Encyclopedia | Georgia Humanities and the University of Georgia Press | https://www.georgiaencyclopedia.org/articles/arts-culture/inman-park/ | 2026-11-28 |
| S3 | "Birth Home" and "Birth Home of Martin Luther King, Jr." | National Park Service, Martin Luther King, Jr. National Historical Park | https://www.nps.gov/malu/planyourvisit/birth-home.htm, https://www.nps.gov/places/birth-home.htm | 2026-11-28 |
| S4 | "Historic District - Open Data" (polygon layer, 19 districts) | City of Atlanta, Department of City Planning GIS | https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/MapServer/15 (catalog: https://dpcd-coaplangis.opendata.arcgis.com/datasets/coaplangis::historic-district-open-data) | 2026-11-28, ArcGIS REST query |
| S5 | Historic paint color guides for Queen Anne houses | Town of Ipswich, MA (Historic Ipswich); City of Holland, MI | https://historicipswich.net/colors/, https://www.cityofholland.com/DocumentCenter/View/5788/Painting | 2026-11-28, search summary only |

Not read: the text of the Inman Park district regulations (Atlanta Zoning Ordinance Chapter 20L, Ord. 2002-28). The City page (`www.atlantaga.gov`) refused the fetch (HTTP 403), and the neighborhood association site (`www.inmanpark.org`) returned HTTP 429. The style does not depend on it.

## Facts, by part of the style

| Part of the style | Fact | Source |
|---|---|---|
| The district | Joel Hurt's East Atlanta Land Company developed Inman Park as Atlanta's first planned suburb. The lot sales were from 1889 to 1896. The first electric streetcar line of Atlanta ran to it from August 1889. | S1, S2 |
| The house types | "Houses designed in the Queen Anne style ... were popular among early residents"; the Georgian Revival style began to appear by the early 1900s. | S2 |
| The house types | The streets have "good examples of 19th Century High Victorian Queen Anne and other picturesque modes, late Victorian colonial and classical revival styles and typical early twentieth century forms like the bungalow." | S1 |
| The mix | On Elizabeth Street "the majority of the homes are either late Victorian Queen Anne and colonial revival style, or early twentieth century bungalows with deep porches and broad gable roofs." | S1 |
| Wood frame and siding | The large Edgewood Avenue houses are "two-story frame buildings". The Woodruff House is a "turretted two-story frame building". | S1 |
| Turret | The Edgewood Avenue houses have an "asymmetrical combination of turrets, generous porches, complex roof-lines vigorous surfaces and eclectic details of High Victorian Queen Anne forms". The Latham House has an "octagonal turret". | S1 |
| Wrap porch, turned posts | The Latham House has an "ample first story porch on turned posts". The Beath-Dickey-Griggs house is "a fine example of High Victorian Queen Anne style distinguished by its fine details such as turned posts". | S1 |
| Front gable | The Latham House has a "second story porch under a triangular gable". | S1 |
| Tall, narrow windows | The towers and the tall chimneys "emphasize the verticality of the structures". The style uses tall, narrow window cells (S1 gives the vertical form; the window size in the game is a design value). | S1 |
| Martin Luther King Jr. Landmark District | The MLK Birth Home (501 Auburn Avenue) is "a two-story frame Queen Anne Victorian style house", built in 1895. | S3 |
| Painted colors | Queen Anne houses used one or two strong body colors, a trim color, and an accent color for the decorative parts, in deep, rich hues (greens, rusts, reds, browns). | S5 |

## How the game uses the facts

- `src/level/geo/styles.js`, style `victorian-house`: six body colors (sage, gold, slate blue, rust red, cream, lilac), a cream trim, four darker accents, a 3.8 m floor, and a tall narrow window (0.30 by 0.64 of the cell, about 0.8 by 2.4 m).
- `src/level/geo/facade-kit.js`: `victorianRoof()` (a steep hip roof at 45 degrees and a front gable at 52 degrees, with the gable face in the accent color and a small attic window), `victorianTurret()` (an 8-sided tower on a front corner of about half of the houses, with a cone roof and a finial), and `victorianPorch()` (a porch as wide as the front wall that wraps around one corner, on turned posts, with a balustrade and a frieze).
- `src/level/geo/historic-districts.js`, `HISTORIC_MIX`: the house mix of each district.
  - Inman Park: 70 % `victorian-house`, 22 % `craftsman-house`, 8 % `shotgun-house` (Queen Anne first, then the bungalows; S1, S2).
  - Martin Luther King Jr. Landmark District: 50 % `shotgun-house`, 30 % `victorian-house`, 20 % `craftsman-house` (the Queen Anne Birth Home on Auburn Avenue, S3; the issue asks that this part of Old Fourth Ward keeps more shotgun houses).
  - Cabbagetown (out of the BeltLine level box now): 65 % `shotgun-house`, 25 % `craftsman-house`, 10 % `victorian-house`. Not verified with a source yet; it does not change the BeltLine level.
- The game shows each house at its best: new paint, complete turrets, and full porches.
