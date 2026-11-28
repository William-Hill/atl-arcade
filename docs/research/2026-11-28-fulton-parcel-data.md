# Fulton County parcel data for the building styles (#406)

Date: 2026-11-28. Level: `beltline-eastside`, bbox `33.7560,-84.3685,33.7735,-84.3580`.

## Question

Can open Fulton County data give each building a land use, a year built, and a story count, so that `chooseStyle()` does not use the hash? What is the license?

## The layers

Fulton County GIS publishes its layers on ArcGIS Online (organization `AQDHTHDrZzfsFsB5`, owner `Fulton_County_GIS`). The open-data site is `https://gisdata.fultoncountyga.gov/`.

| Layer | REST URL | License on the item | Fields of interest |
|---|---|---|---|
| Tax Parcels (current digest) | `https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Tax_Parcels/FeatureServer/0` (item `e581a072dca9442e884d3682bff03484`) | "CC BY-SA" (no version), and an "as is" disclaimer | `ParcelID`, `TaxYear`, `LUCode` (land use class), `ClassCode` (property class), `LivUnits`, `LandAcres`. Also `Owner`, `OwnerAddr1`, `OwnerAddr2`, and the site address. |
| Structure Footprints | `https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Structure_Footprints/FeatureServer/0` (item `29dbb49a50c2422d9f5afd8dba7413a9`, "Structure footprints derived from imagery") | No license stated. No description, no access text. | `YearBuilt`, `Stories`, `LUC`, `LUCDesc` (land use of the parcel), `StructForm`, `FeatType`, `LiveUnits`, `ParcelID`. No owner field and no address field. |

Findings:

1. The Tax Parcels layer has no year built and no story count. It has the land use code only. The yearly copies (`Tax_Parcels_2015` to `Tax_Parcels_2026`, `Tyler_TaxParcels`, `Tax_ParcelsCurrentDigest_*`) have the same fields, plus the assessed values in some.
2. The Structure Footprints layer has the year built and the stories for each structure, and the land use code of its parcel. It is the layer that answers the issue.
3. The land use codes are the same in both layers (for example `101` "Residential 1 family", `374` "Retail - Multiple Occupancy", `2C1` "Apt Garden Class C").

## Coverage in the level

The level has 1,042 buildings after the build (the issue counts 1,068 OSM buildings before the trail corridor cut and the deck filter). The join is point in polygon (`scripts/parcel-join.mjs`): the building footprint point in the structure polygon; else a structure point in the building footprint.

| Count | Buildings |
|---|---|
| Join to a structure footprint | 988 of 1,042 (95%) |
| Get a land use code | 988 |
| Get a year built (1800 to 2030) | 960 |
| Get a story count (1 to 80) | 814 |
| No join | 54 |

The bbox has 1,251 structure footprints and 2,354 tax parcels. With the Tax Parcels layer as a second source, 46 more buildings would get a land use; the owner chose not to use it (below).

## Hash-decided buildings

`scripts/style-coverage.mjs` counts a building as hash-decided when its style changes with its id.

| | Hash-decided | Data-decided |
|---|---|---|
| Before (`main` at `0cff15f`) | 191 | 851 |
| After (#406) | 23 | 1,019 |

Most buildings (764 before) have an OSM `building=house` tag, and `BY_TYPE` gives them `craftsman-house` before the parcel rule. This change does not change that order.

## License and owner choices (2026-11-28)

- Structure Footprints: no license stated. Owner choice: use it and cite Fulton County GIS, as for the City of Atlanta layers with no stated license (street centerlines, address points, tree canopy).
- Tax Parcels: CC BY-SA, share-alike, with no version. `level.json` is an ODbL database. Owner choice: do not use this layer, so that no CC BY-SA data goes into `level.json`.
- Privacy: the fetch asks only for the fields in `scripts/fulton-structures.mjs` `FIELDS`. The structure layer has no owner and no address field. `level.json` keeps only `landUse`, `yearBuilt`, and `stories`.

## Not verified

- The terms of the Structure Footprints layer. Fulton County GIS can confirm them. If they state a share-alike license, this choice must be looked at again.
- The accuracy of the year built: it is the county assessor value, and it can be the year of a large renovation.
