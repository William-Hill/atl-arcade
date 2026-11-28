# Wall labels from Mapillary street images: license review (issue #408, stage 1)

Date: 2026-11-28. Status: research only. No image was read for labels. The owner must accept the license decision in `docs/decisions.md` before stage 2 starts.

This note is not legal advice. An agent wrote it from the primary texts. Skate ATL aims to be the official game of the City of Atlanta, so a lawyer of the City (or of the owner) should read it before the game ships with these labels.

## The question

Issue #408 proposes this method: an agent with vision reads Mapillary street images of each street-facing building in the BeltLine Eastside level. For each building, the agent records 4 labels: the wall material, the main wall color, the floor count, and the style. Each record keeps the image id as its source. No pixel of an image goes into the game. The records go into a sourced override file, the same as `levels/beltline-eastside/heights.json`.

The questions for stage 1:

1. May an agent derive these labels from the images and ship them in a game?
2. What attribution is necessary?
3. Does share-alike apply to the labels, or to the game?
4. How many Mapillary images are in the bbox `33.7560,-84.3685,33.7735,-84.3580`?

## Sources

All the pages were fetched with curl on 2026-11-28. The quotes are copied from the saved page text.

| Id | Source | URL |
|---|---|---|
| T | Mapillary Terms of Use, effective date February 15, 2024 (Meta Platforms Ireland Limited) | https://www.mapillary.com/terms |
| D | Mapillary API documentation | https://www.mapillary.com/developer/api-documentation |
| L | Creative Commons Attribution-ShareAlike 4.0 International, legal code | https://creativecommons.org/licenses/by-sa/4.0/legalcode.en |
| F | Creative Commons FAQ | https://creativecommons.org/faq/ |

Not read: the Mapillary help page on licenses (`https://help.mapillary.com/hc/en-us/articles/115001770409-Licenses`) returned HTTP 403. The OpenStreetMap wiki (Automated Edits code of conduct) is not in the network allow list of this environment. The Mapillary terms link "CC BY-SA" to `http://creativecommons.org/licenses/by-sa/4.0/`, so this note uses version 4.0.

## Findings

### 1. The license of the images is CC BY-SA 4.0

- The images are "User Content". T, section 3: "Your use of any User Content provided by other users is subject to the Creative Commons Share Alike (CC BY-SA) license, unless we indicate otherwise." T, section 4, defines User Content as "content, including images and videos, location and route information, edits, and other materials".
- The CC BY-SA license wins over the terms where they conflict. T, section 3: "Those license terms will apply to the extent of any conflict between those license terms and these Terms."
- The Mapillary Services themselves (the site, the API, the tiles) are under a separate, limited license. T, section 3: "a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Mapillary Services (excluding User Content, which is subject to Section 3(b) below)".

### 2. The labels are facts, and the license does not control facts

- CC BY-SA 4.0 covers only acts that need permission under copyright and similar rights. L, section 1, "Licensed Rights": "limited to all Copyright and Similar Rights that apply to Your use of the Licensed Material". L, section 2(a)(2): "where Exceptions and Limitations apply to Your use, this Public License does not apply, and You do not need to comply with its terms and conditions."
- Facts are not under copyright. F (data): "Facts are not subject to copyright, nor are the ideas underlying copyrighted content." F (data): "use of the facts and ideas embedded within the contents will not require attribution (or compliance with other applicable license conditions), unless doing so implicates copyright in the database structure".
- "This wall is red brick, 3 floors, Craftsman style" is a fact about a building. It is not a copy of the photographer's expression (framing, light, moment). So the labels are most probably not "Adapted Material". L, section 1: Adapted Material is material "in which the Licensed Material is translated, altered, arranged, transformed, or otherwise modified in a manner requiring permission under the Copyright and Similar Rights held by the Licensor."
- Mining the images is permitted. F: "Can I conduct text/data mining on a CC-licensed database? Yes." F: "All six of the 4.0 licenses allow for text and data mining by granting express permission to privately reproduce, extract, and reuse the contents of a licensed database and create adapted databases."

**Risk: database rights.** CC BY-SA 4.0 also licenses Sui Generis Database Rights (L, section 1). F: "Sui generis database rights are primarily enacted within the European Union and a handful of other jurisdictions." Mapillary is run by Meta Platforms Ireland Limited (T, header). L, section 4: "if You include all or a substantial portion of the database contents in a database in which You have Sui Generis Database Rights, then the database in which You have Sui Generis Database Rights (but not its individual contents) is Adapted Material". The labels are new values that the agent makes. They are not the contents of the Mapillary database (the images). So this risk is low, but it is not zero. The safe answer is to put the label file under CC BY-SA 4.0 (see section 5 below). That costs nothing, because the file is our own data.

### 3. The Mapillary terms permit the use, with conditions

The terms of the service apply because the images come through the Mapillary API.

- **Use the published API only.** T, section 5, the user will not: "Use any data mining, robots or similar data gathering or extraction methods not approved by Mapillary designed to scrape or extract data from the Mapillary Services" and will not "Access or search ... the Mapillary Services by any means (automated or otherwise) other than ... through the currently available, published interfaces that we provide". So a script must use `graph.mapillary.com`, not a scrape of the web viewer.
- **Register an app and use a token.** T, section 11: "You must register any application you intend to use with our Developer Tools with us to obtain a client_id." D: "All requests against https://graph.mapillary.com and https://tiles.mapillary.com must be authorized. They require a client or user access tokens."
- **The app must add value.** T, section 11: the app "must be designed to provide products or services that materially supplement those provided via the Mapillary Services (and not to merely redistribute Content ...)". A game that shows no image passes this test.
- **No re-identification.** T, section 5: "Make any attempt to re-identify or unblur any aspect of any Content, including any individual or license plate." T, section 6: "We use technology designed to blur the faces of individuals and vehicle license plates."
- **Commercial use, if it applies.** T, section 12 permits commercial use only for "(i) improvement, training, and development of products, services, maps, studies, platforms, websites, applications, software, algorithms, datasets, solutions, or technologies; and (ii) in the provision of services for or on behalf of one or more of your clients." A game and a label dataset are "applications" and "datasets". Section 12 also requires "technical safeguards and business processes that prohibit reidentification or unblurring of any Content" and "business processes to prevent inadvertent disclosure or release of any Content". This note does not decide if Skate ATL is a commercial use. The owner must decide that.
- **Attribution of Mapillary-extracted data.** T, section 11: "If you integrate data that Mapillary extracts from street-level images using the Mapillary API or our vector tiles in your application, you must attribute the source of the data by visibly displaying the Mapillary logo and linking back to the Mapillary homepage." Our labels come from our agent, not from Mapillary detections. But the image ids, the positions, and the compass angles come from the API. The safe choice is to obey this clause.
- **A permitted path through OpenStreetMap.** T, section 13: "we permit you and others to use the Mapillary Services, and all Content included therein, to develop, edit and contribute content to OpenStreetMap or the Overture Maps Foundation." So the labels can also go into OSM as `building:colour` and `building:material` tags. The game already reads OSM under the ODbL (`docs/sources.md`). OSM has its own rules for automated and mass edits; this note did not read them (the OSM wiki is not reachable here).

### 4. Attribution: what is necessary

If the labels are facts (finding 2), CC BY-SA asks for no attribution. Mapillary section 11 asks for the logo and a link. We recommend full attribution anyway, because it is cheap and it removes the risk.

CC BY-SA 4.0 section 3(a)(1) lists what to keep "if it is supplied by the Licensor": the "identification of the creator(s) of the Licensed Material", "a copyright notice", "a notice that refers to this Public License", "a notice that refers to the disclaimer of warranties", "a URI or hyperlink to the Licensed Material to the extent reasonably practicable". Section 3(a)(1)(B): "indicate if You modified the Licensed Material". Section 3(a)(1)(C): "indicate the Licensed Material is licensed under this Public License, and include the text of, or the URI or hyperlink to, this Public License". Section 3(a)(2): "it may be reasonable to satisfy the conditions by providing a URI or hyperlink to a resource that includes the required information."

Proposed attribution:

1. In the credits screen and in the `#attribution` line of each level that uses the labels: the Mapillary logo, a link to `https://www.mapillary.com`, and the text "Wall colors and materials: labels from Mapillary street images, CC BY-SA 4.0". Link "CC BY-SA 4.0" to `https://creativecommons.org/licenses/by-sa/4.0/`.
2. In the label file: for each building, the image id, a link to the image in the Mapillary viewer (stage 2 confirms the link form; D does not give it), the creator username (D: "creator - { username: string, id: string }, the username and user ID who owns and uploaded the image"), and the capture date. The credits screen links to this file. This is the "resource that includes the required information" of section 3(a)(2).
3. In the label file `about` field: "Labels made by an agent from the images. No image is in the game." This is the "indicate if You modified" notice.
4. A new row in `docs/sources.md`.

### 5. Share-alike: where it applies

- ShareAlike applies only to Adapted Material that you share. L, section 3(b): "if You Share Adapted Material You produce, the following conditions also apply. The Adapter's License You apply must be a Creative Commons license with the same License Elements, this version or later, or a BY-SA Compatible License."
- **The game code and the game are not Adapted Material.** The game does not modify an image. It reads a small file of facts. Even a collection of BY-SA works does not take the BY-SA license. F: "CC licenses do not require the collection or the compilation itself to be made available under an SA license, even though each individual work is still licensed individually under an SA license". F: "the condition only applies if a work is modified and if the work is shared publicly."
- **The label file.** If the labels are facts, share-alike does not apply (finding 2). If a court in the EU says that the labels file is Adapted Material under section 4, then share-alike applies to the label file only, not to the game.
- **Recommendation: keep the label file separate.** Put the labels in their own file, `levels/beltline-eastside/facades.json`, under CC BY-SA 4.0 (precaution). Do not copy the labels into `level.json`, which is under the ODbL (`docs/sources.md`). CC BY-SA 4.0 and the ODbL are two different share-alike licenses; one file under both would cause a conflict. The build script or the game can read both files side by side, the same as a collection.

### 6. People and cars

The images show real people and cars. The rules of #408 say: use only buildings, and the records must not describe people or cars. The Mapillary terms (T, sections 5, 6 and 12) support this. Stage 2 must:

- Keep no image file in the repository, and delete the cache after the labels are made.
- Use a prompt that asks only for the 4 wall labels, and a schema that has no free-text field.
- Skip an image that shows a face or a license plate that is not blurred, and report it with the Mapillary flag tool (T, section 6).
- Not record the camera user, a car, or a person in any field. The creator username is kept only for the attribution.

Open point for the owner: stage 2 sends the images to a vision model through an API. T, section 12 (if the use is commercial) asks for "business processes to prevent inadvertent disclosure or release of any Content". A short written rule (no image stored, no image in a prompt log, delete after use) is the business process.

### 7. Image coverage of the BeltLine Eastside bbox: not counted

- The count was not done. A request to `https://graph.mapillary.com/images?bbox=-84.3685,33.7560,-84.3580,33.7735&limit=1` with no token returned HTTP 500 with `{"error":{"message":"Invalid OAuth 2.0 Access Token","type":"MLYApiException","code":190, ...}}` (2026-11-28). D says every request needs a token (quote in finding 3). No Mapillary token is in this environment, so the count was skipped, as the task says.
- To count later: register an app (T, section 11), save the client token as a network secret for `graph.mapillary.com`, then page through `GET /images?bbox=...&fields=id,captured_at,is_pano,compass_angle,creator&limit=2000`. D: "bbox queries against /images, /map_features, and detection search must now be smaller than 0.01 degrees square." The bbox is 0.0105 degrees by 0.0175 degrees (0.00018 square degrees). If the API refuses it, cut it into 4 parts. D gives the rate limit: "Requests to search APIs ... are limited to 10,000 per minute per app." The count must report: all images, images since 2023, panoramas, and the images within 30 m of a street-facing building.
- The issue #408 item "Not verified: the Mapillary image coverage" stays open.

## Answers

| Question | Answer | Basis |
|---|---|---|
| May an agent derive the labels and ship them in a game? | Yes, most probably. The labels are facts; the license does not control facts. The Mapillary terms permit the use through the API, with a registered app, no re-identification, and (if commercial) the section 12 safeguards. | L 2(a)(2); F (data, mining); T 3, 5, 11, 12 |
| What attribution? | Not required for facts by CC, but required as logo and link by Mapillary section 11 for Mapillary-extracted data. Recommended: logo, link, "CC BY-SA 4.0" line in the credits, and a per-building list of image id, link, creator, and date. | T 11; L 3(a) |
| Does share-alike apply? | Not to the game. To the label file only if the labels are Adapted Material (unlikely; possible under EU database rights). Precaution: put the label file under CC BY-SA 4.0 and keep it out of the ODbL `level.json`. | L 3(b), 4; F (collections, databases) |
| Coverage in the bbox? | Not counted. The API needs a token, and none is available. | D; HTTP 500, code 190 |

## Recommendation

1. Accept the license use as "PROPOSED" in `docs/decisions.md` (2026-11-28 entry): labels are facts; the label file is CC BY-SA 4.0 as a precaution; full attribution; the people and cars rules of finding 6.
2. Before stage 2, the owner registers a Mapillary app and saves the client token for `graph.mapillary.com`. Then an agent counts the coverage first. If fewer than about half of the street-facing buildings have an image within 30 m, stop: the pilot will not repay the work.
3. The owner decides if the game is a commercial use under T, section 12, and if a City lawyer must read this note.
4. Later option: put the checked labels into OSM (T, section 13), so that all OSM users get them and the game reads one source. This needs a review of the OSM automated edit rules first.
5. Stage 2 keeps the pilot of #408 as it is: 50 buildings, a human check of 10, the error rate, and a lab capture of one street before and after.
