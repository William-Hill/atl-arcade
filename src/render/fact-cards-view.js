// The fact cards in the level (M1-07, #17): a bright card that turns and
// floats over the trail. A collected card hides. Three draw calls per card
// (the edge and two faces), and one shared texture.

import * as THREE from "three";

const CARD_W = 1.1;
const CARD_H = 1.5;
const LIFT = 1.4; // m from the ground to the card center.

function faceTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 176;
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffd166";
  g.fillRect(0, 0, 128, 176);
  g.strokeStyle = "#0b0b12";
  g.lineWidth = 8;
  g.strokeRect(10, 10, 108, 156);
  g.fillStyle = "#0b0b12";
  g.font = "800 30px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("ATL", 64, 74);
  g.font = "800 28px system-ui, sans-serif";
  g.fillText("FACT", 64, 112);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// `cards` is [{ id, position: [x, groundY, z] }].
export function createFactCardsView(cards) {
  const group = new THREE.Group();
  group.name = "fact-cards";
  const face = new THREE.MeshBasicMaterial({ map: faceTexture(), side: THREE.DoubleSide, fog: false });
  const edge = new THREE.MeshBasicMaterial({ color: 0xff5fb2, side: THREE.DoubleSide, fog: false });
  const faceGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const edgeGeo = new THREE.PlaneGeometry(CARD_W + 0.24, CARD_H + 0.24);
  const items = cards.map((c, i) => {
    const root = new THREE.Group();
    root.name = `fact-card-${c.id}`;
    root.position.set(c.position[0], c.position[1] + LIFT, c.position[2]);
    // The pink edge in the middle, and a face on each side of it, so the
    // text reads the right way from the front and from the back.
    const front = new THREE.Mesh(faceGeo, face);
    front.position.z = 0.02;
    const back = new THREE.Mesh(faceGeo, face);
    back.position.z = -0.02;
    back.rotation.y = Math.PI;
    root.add(new THREE.Mesh(edgeGeo, edge), front, back);
    group.add(root);
    return { id: c.id, root, baseY: root.position.y, phase: i * 1.7 };
  });

  return {
    group,
    // `collected` is the list of collected card ids; `t` is seconds.
    update(collected, t) {
      for (const it of items) {
        it.root.visible = !collected.includes(it.id);
        if (!it.root.visible) continue;
        it.root.rotation.y = t * 1.6 + it.phase;
        it.root.position.y = it.baseY + Math.sin(t * 2 + it.phase) * 0.15;
      }
    },
    get visibleCount() {
      return items.filter((it) => it.root.visible).length;
    },
  };
}
