// 東京駅 八重洲側 地下・地上 2D/3D 試作
// 表示データ: data/scene.json（scripts/claude-integration/build_app_data.py が PLATEAU 原 CityGML から生成）
// 座標: x=東(m), y=北(m), z=TP標高(m)。2D と 3D は同じ座標・同じ地物 ID を使い、高さの誇張はしない。
import * as THREE from 'three';
import { TapGuard } from './gesture.mjs';
import { installMobileUI } from './mobile.js';
let mobileUI;
import { OrbitControls } from './vendor/OrbitControls.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COLOR = {
  floor: 0x2f7fd8, wall: 0x7fb2ea, stair: 0xe0662b, other: 0x8a8f96,
  bldg: 0xb9c0c8, bldgFoot: 0xd5dae0, bldgEdge: 0x98a1ab, ground: 0xdfe4e8,
  hilite: 0xffc400, extent: 0x444444, bg2d: 0xf3f4f6, bg3d: 0xe9edf1,
};
const FN = { EF_35: '階段・スロープ', EF_25: '壁・バリア', EF_30: '屋根・床・舗装', EF_80: '輸送機能' };
const CITY = { '13101': '千代田区', '13102': '中央区' };
const GROUND_Z = 3.3; // 地上の目安（階段上端と近くの建物底面の照合結果: 概ね TP +3〜4 m）

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-300, -500, 800);
scene.add(sun);

const persp = new THREE.PerspectiveCamera(45, 1, 1, 20000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
let camera = ortho;
const controls = new OrbitControls(ortho, renderer.domElement);

const state = { mode: '2d', selected: null, showBldg: true, showUnder: true, showNet: true, floor: 'B1' };
const pickables = [];
const byId = new Map(); // 地物 ID → { kind, data, meshes: [] }

function reg(id, kind, data, mesh) {
  if (!byId.has(id)) byId.set(id, { kind, data, meshes: [] });
  const e = byId.get(id);
  e.meshes.push(mesh);
  mesh.userData = { id };
  mesh.userData.baseColor = mesh.material.color.getHex();
  pickables.push(mesh);
}

function triMesh(flat, color, opts = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts });
  return new THREE.Mesh(g, m);
}

function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const groups = { b3d: new THREE.Group(), b2d: new THREE.Group(), under: new THREE.Group(), walls: new THREE.Group(), ground: new THREE.Group(), extent: new THREE.Group() };
Object.values(groups).forEach(g => scene.add(g));

const data = await (await fetch('./data/scene.json')).json();
// 名前の重ね合わせ（scripts/claude-integration/build_overlay.py が data/curated/ から生成）。位置は scene.json の地物を参照するだけ
const overlay = await (await fetch('./data/overlay.json')).json();
const exitById = new Map(overlay.exits.map(e => [e.id, e]));
// 地上の下地（scripts/claude-integration/build_ground.py が PLATEAU 道路・土地利用から生成）。建物でない所を埋める
const ground2 = await (await fetch('./data/ground.json')).json();
// 概略の層（scripts/claude-integration/build_schematic.py が OpenStreetMap から生成）。実際の位置の地図とは混ぜない
const schematic = await (await fetch('./data/schematic.json')).json();
// 歩ける道（scripts/claude-integration/build_network.py が国交省 歩行空間ネットワークデータから生成）。地上だけ・2019年時点
const network = await (await fetch('./data/network.json')).json();
// 国交省の屋内地図（scripts/claude-integration/build_indoor.py が Shapefile から生成）。高さは無い
const indoor = await (await fetch('./data/indoor.json')).json();
const FLOORS = ['1F', 'B1', 'B2'];
const FLOOR_LABEL = { '1F': '地上', B1: '地下1階', B2: '地下2階' };
const SCHEM_STEP = 12; // 3D で階を並べる模式の間隔（m）。実際の深さではない。画面に常に明記する
const SCHEM_ROOM_H = 3; // 3D で屋内地図の通路・部屋を立ち上げる模式の高さ（m）。これも実測ではない
const floorZ = f => GROUND_Z - SCHEM_STEP * (f === 'B1' ? 1 : f === 'B2' ? 2 : 0);

// 地上の建物（LOD1 外形を底面〜上端で押し出し。2D では外形だけ）
for (const b of data.buildings) {
  if (b.foot.length < 3) continue;
  const shape = new THREE.Shape(b.foot.map(p => new THREE.Vector2(p[0], p[1])));
  const h = Math.max(0.5, b.zmax - b.zmin);
  const g3 = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g3.translate(0, 0, b.zmin);
  const m3 = new THREE.Mesh(g3, new THREE.MeshLambertMaterial({ color: COLOR.bldg, transparent: true, opacity: 0.55, depthWrite: false }));
  m3.renderOrder = 3;
  groups.b3d.add(m3); reg(b.id, 'building', b, m3);
  const g2 = new THREE.ShapeGeometry(shape);
  const m2 = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ color: COLOR.bldgFoot }));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(b.foot.map(p => new THREE.Vector3(p[0], p[1], 0.01))), new THREE.LineBasicMaterial({ color: COLOR.bldgEdge }));
  groups.b2d.add(m2, edge); reg(b.id, 'building', b, m2);
}

// 地下の区画（床・内壁）
const floorPts = [];
for (const r of data.rooms) {
  const f = triMesh(r.floor, COLOR.floor);
  groups.under.add(f); reg(r.id, 'room', r, f);
  for (let i = 0; i < r.floor.length; i += 3) floorPts.push([r.floor[i], r.floor[i + 1]]);
  if (r.wall.length) {
    const w = triMesh(r.wall, COLOR.wall, { transparent: true, opacity: 0.35, depthWrite: false });
    groups.walls.add(w); reg(r.id, 'room', r, w);
  }
}
// 階段など地下の設備
for (const s of data.stairs) {
  const m = triMesh(s.tris, s.function === 'EF_35' ? COLOR.stair : COLOR.other);
  groups.under.add(m); reg(s.id, 'stair', s, m);
}
// 地下データの収録範囲（床の点の凸包）
const hp = hull(floorPts);
const extentLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hp.map(p => new THREE.Vector3(p[0], p[1], GROUND_Z + 0.2))),
  new THREE.LineDashedMaterial({ color: COLOR.extent, dashSize: 6, gapSize: 4 }));
extentLine.computeLineDistances();
groups.extent.add(extentLine);
// 地表の目安面（3D のみ。地下が透けて見えるよう半透明）
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1000), new THREE.MeshBasicMaterial({ color: COLOR.ground, transparent: true, opacity: 0.35, depthWrite: false }));
ground.position.set(100, -150, GROUND_Z);
groups.ground.add(ground);

// 地上の下地：土地利用の面の上に、車道・歩道・交通島の面。種類ごとに1つの形にまとめて軽くする（選択には使わない）
const LUSE_COLOR = { '215': 0xe6e8ec, '216': 0xece6da, '217': 0xd7ead2, '204': 0xcfe1f2 };
const ROAD_COLOR = { carriageway: 0xd9dde2, sidewalk: 0xf4f1ea, island: 0xd7e6d2, planting: 0xcfe3c8, other: 0xe2e2e2 };
const groundBase = new THREE.Group(); scene.add(groundBase);
function mergedFill(rings, color, z) {
  const pos = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    const g = new THREE.ShapeGeometry(new THREE.Shape(r.map(p => new THREE.Vector2(p[0], p[1])))).toNonIndexed();
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) pos.push(a[i], a[i + 1], z);
    g.dispose();
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}
{
  const byCode = {};
  for (const l of ground2.landuse) if (LUSE_COLOR[l.code]) (byCode[l.code] ||= []).push(l.ring);
  for (const [c, rs] of Object.entries(byCode)) groundBase.add(mergedFill(rs, LUSE_COLOR[c], -0.3));
  const byKind = {};
  for (const r of ground2.roads) (byKind[r.kind] ||= []).push(r.ring);
  for (const k of ['carriageway', 'island', 'planting', 'sidewalk', 'other']) if (byKind[k]) groundBase.add(mergedFill(byKind[k], ROAD_COLOR[k], k === 'sidewalk' ? -0.15 : -0.2));
}

// 概略：丸ノ内線の線路とホームの縁（地下2階）。太い点線（短い帯の並び）で描き、選択はできない
const schemGroup = new THREE.Group(); scene.add(schemGroup);
function dashedBand(line, width, color, dash, gap) {
  const pos = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [x1, y1] = line[i], [x2, y2] = line[i + 1];
    const L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.01) continue;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy * width / 2, ny = ux * width / 2;
    for (let t = 0; t < L; t += dash + gap) {
      const t2 = Math.min(L, t + dash);
      const ax = x1 + ux * t, ay = y1 + uy * t, bx = x1 + ux * t2, by = y1 + uy * t2;
      pos.push(ax + nx, ay + ny, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0, ax + nx, ay + ny, 0, bx - nx, by - ny, 0, ax - nx, ay - ny, 0);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
}
const schemLabels = [];
// 歩ける道：歩道・施設内通路は実線の帯、横断歩道・標示のない横断部は点線の帯
const netGroup = new THREE.Group(); scene.add(netGroup);
{
  const NET = { 1: [0x00796b, 1.1, 0, 0], 2: [0x00796b, 1.1, 0, 0], 3: [0x00796b, 1.1, 1.5, 1.2], 4: [0x00796b, 0.9, 1, 1.5], 6: [0x00796b, 1.1, 0, 0], 7: [0x26a69a, 0.9, 0, 0], 99: [0x9e9e9e, 0.8, 0, 0] };
  for (const l of network.links) {
    if (l.rt_struct === 99) continue; // データ上「不明」の道は、確かめていない接続なので描かない
    const [c, w, d, gap] = NET[l.rt_struct];
    netGroup.add(dashedBand(l.line, w, c, d || 1e6, gap || 0));
  }
}
for (const l of schematic.lines) {
  schemGroup.add(l.kind === 'track' ? dashedBand(l.line, 1.6, 0xd32f2f, 5, 3) : dashedBand(l.line, 2.4, 0x6a1b9a, 3, 2));
  if (l.kind === 'platform_edge' && !schemLabels.length) { const m = l.line[l.line.length >> 1]; schemLabels.push(['丸ノ内線 ホーム（概略）', m[0] + 18, m[1]]); }
}

// 屋内地図の部屋・通路（階ごとの群。地上（屋外）の地物は「地上」の階にまとめる）
const SPACE_COLOR = cat => cat === 'B029' ? 0x9fd9b0 : ['B021', 'B022', 'B023', 'B025'].includes(cat) ? 0xf0a57a : 0xf1e3bf;
const indoorGroups = {}, indoorBoxes = {};
const gates = [], exitPts = [];
for (const f of FLOORS) { indoorGroups[f] = new THREE.Group(); indoorBoxes[f] = new THREE.Group(); scene.add(indoorGroups[f], indoorBoxes[f]); }
for (const [fk, fl] of Object.entries(indoor.floors)) {
  const f = fk === 'G' ? '1F' : fk;
  for (const sp of fl.spaces) {
    const [outer, ...holes] = sp.rings;
    if (outer.length < 3) continue;
    const shape = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], p[1])));
    for (const h of holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: SPACE_COLOR(sp.category), transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
    indoorGroups[f].add(m); reg(sp.id, 'space', { ...sp, floor: f, outdoor: fk === 'G' }, m);
    // 3D だけ：床の形を模式の高さで立ち上げた半透明の箱（屋外の地物は立ち上げない）。選択には使わない
    if (fk !== 'G') {
      const box = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: SCHEM_ROOM_H, bevelEnabled: false }),
        new THREE.MeshLambertMaterial({ color: SPACE_COLOR(sp.category), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      indoorBoxes[f].add(box);
    }
  }
  const seg = [];
  for (const o of fl.openings) {
    for (let i = 0; i + 1 < o.line.length; i++) seg.push(o.line[i][0], o.line[i][1], 0.1, o.line[i + 1][0], o.line[i + 1][1], 0.1);
    if (o.name && /改札|口$/.test(o.name) && (o.group === 'JRTokyoSta' || /改札/.test(o.name))) gates.push({ ...o, floor: f });
  }
  if (seg.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    indoorGroups[f].add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x33414f })));
  }
}
// 同じ名前の改札の線は1つのラベルにまとめる（駅ごとに別）
const gateLabels = new Map();
for (const g of gates) {
  const k = g.station + '|' + g.name + '|' + g.floor;
  if (!gateLabels.has(k)) gateLabels.set(k, { id: 'gate:' + k, station: g.station, name: g.name, floor: g.floor, group: g.group, pts: [] });
  gateLabels.get(k).pts.push(...g.line);
}
for (const g of gateLabels.values()) {
  g.x = g.pts.reduce((a, p) => a + p[0], 0) / g.pts.length; g.y = g.pts.reduce((a, p) => a + p[1], 0) / g.pts.length;
}
// 出口の点（屋内地図に位置がある出口だけ）。1階＝1Fの原資料点（開口か未確認）、地下1階＝地下側
for (const e of overlay.exits) {
  if (e.ground_opening.status === 'indoor_map') exitPts.push({ exit: e.id, floor: '1F', x: e.ground_opening.x, y: e.ground_opening.y, under: false });
  if (e.underground_connection.status === 'indoor_map') exitPts.push({ exit: e.id, floor: 'B1', x: e.underground_connection.x, y: e.underground_connection.y, under: true });
}
// 3D だけ：同じ出口の両端を結ぶ点線（間の階段の形は未確認。通れる経路の線ではない）
const exitLinks = new THREE.Group(); scene.add(exitLinks);
for (const e of overlay.exits) {
  const a = exitPts.find(p => p.exit === e.id && p.floor === '1F'), b = exitPts.find(p => p.exit === e.id && p.floor === 'B1');
  if (!a || !b) continue;
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(b.x, b.y, floorZ('B1')), new THREE.Vector3(a.x, a.y, floorZ('1F'))]),
    new THREE.LineDashedMaterial({ color: 0xc62828, dashSize: 1.5, gapSize: 1.5 }));
  l.computeLineDistances(); exitLinks.add(l);
}


// ---- 表示モード（2D ↔ 3D）。中心・縮尺・選択は引き継ぐ ----
function visibleHeight() {
  if (camera === ortho) return (ortho.top - ortho.bottom) / ortho.zoom;
  return persp.position.distanceTo(controls.target) * 2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
}

function applyLayers() {
  const is2d = state.mode === '2d';
  groups.b3d.visible = !is2d && state.showBldg;
  groups.b2d.visible = is2d && state.showBldg;
  // PLATEAU の八重洲側地下は「東京駅_B1地下通路」なので、2D では地下1階を選んだときだけ出す
  groups.under.visible = state.showUnder && (!is2d || state.floor === 'B1');
  groups.walls.visible = !is2d && state.showUnder;
  groups.ground.visible = !is2d;
  groups.extent.visible = groups.under.visible;
  // 屋内地図：2D は選んだ階だけ。3D は全階を模式の間隔で並べ、選んだ階以外は薄くする
  for (const f of FLOORS) {
    const g = indoorGroups[f];
    g.visible = state.showUnder && (!is2d || f === state.floor);
    g.position.z = is2d ? 0.05 : floorZ(f);
    g.traverse(o => { if (o.material) { o.material.depthTest = !is2d; o.material.transparent = true; o.material.opacity = (is2d || f === state.floor) ? 0.92 : 0.18; o.renderOrder = is2d ? 4 : 1; } });
    const bx = indoorBoxes[f];
    bx.visible = !is2d && state.showUnder;
    bx.position.z = floorZ(f);
    bx.traverse(o => { if (o.material) o.material.opacity = f === state.floor ? 0.35 : 0.08; });
  }
  exitLinks.visible = !is2d && state.showUnder;
  schemGroup.visible = state.showUnder && (!is2d || state.floor === 'B2');
  netGroup.visible = state.showNet && (!is2d || state.floor === '1F');
  netGroup.position.z = is2d ? 0.15 : GROUND_Z + 0.3;
  netGroup.traverse(o => { if (o.material) { o.material.depthTest = !is2d; o.material.opacity = 0.8; o.renderOrder = 5; } });
  schemGroup.position.z = is2d ? 0.2 : floorZ('B2');
  schemGroup.traverse(o => { if (o.material) { o.material.depthTest = !is2d; o.renderOrder = 6; } });
  document.getElementById('schemB2').style.display = is2d && state.floor === 'B2' ? 'block' : 'none';
  // 地上の下地：2D は地上の階で濃く、地下の階では薄く（位置の手がかり）。3D は地表の目安面に置く
  groundBase.position.z = is2d ? 0 : GROUND_Z;
  groundBase.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = is2d ? (state.floor === '1F' ? 1 : 0.45) : 0.6; o.material.depthWrite = is2d; } });
  document.getElementById('schem').style.display = is2d ? 'none' : 'block';
  document.querySelectorAll('[data-floor]').forEach(b => b.setAttribute('aria-pressed', b.dataset.floor === state.floor));
  // 2D では地下を建物外形の上に重ねて描く（上から見た位置関係を示すため）
  for (const g of [groups.under, groups.extent]) g.traverse(o => {
    if (o.material) { o.material.depthTest = !is2d; o.renderOrder = is2d ? 5 : (o.renderOrder === 3 ? 3 : 0); }
  });
  scene.background = new THREE.Color(is2d ? COLOR.bg2d : COLOR.bg3d);
}

function setMode(mode, keep = true) {
  const target = controls.target.clone();
  const vh = keep ? visibleHeight() : 900;
  state.mode = mode;
  controls.object = mode === '2d' ? ortho : persp;
  camera = controls.object;
  if (mode === '2d') {
    ortho.position.set(target.x, target.y, 3000);
    ortho.up.set(0, 1, 0);
    ortho.zoom = (ortho.top - ortho.bottom) / vh;
    ortho.lookAt(target.x, target.y, 0);
    controls.enableRotate = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  } else {
    const d = vh / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)));
    const tilt = THREE.MathUtils.degToRad(55);
    persp.up.set(0, 0, 1);
    persp.position.set(target.x, target.y - d * Math.sin(tilt), target.z + d * Math.cos(tilt));
    controls.enableRotate = true;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(100); // 地表の少し下から見上げて地下を確認できる
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  controls.screenSpacePanning = true;
  camera.updateProjectionMatrix();
  controls.update();
  document.getElementById('m2d').setAttribute('aria-pressed', mode === '2d');
  document.getElementById('m3d').setAttribute('aria-pressed', mode === '3d');
  applyLayers();
  highlight();
  saveHash();
}

// ---- 選択 ----
// 選択地物の目印（2D・3D 共通。地物の代表点から上へ立てるピン）
const pin = new THREE.Group();
pin.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 40)]),
  new THREE.LineBasicMaterial({ color: 0x111111, depthTest: false })));
const pinHead = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: COLOR.hilite, depthTest: false }));
pinHead.position.z = 40;
const pinRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.35, 32), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, side: THREE.DoubleSide }));
pin.add(pinHead, pinRing);
pin.traverse(o => { o.renderOrder = 10; });
pin.visible = false;
scene.add(pin);

function anchorOf(kind, d) {
  if (kind === 'stair') return [d.top[0], d.top[1], d.zmax];
  if (kind === 'building') {
    const n = d.foot.length;
    return [d.foot.reduce((a, p) => a + p[0], 0) / n, d.foot.reduce((a, p) => a + p[1], 0) / n, d.zmax];
  }
  if (kind === 'space') {
    const r = d.rings[0], n = r.length;
    return [r.reduce((a, p) => a + p[0], 0) / n, r.reduce((a, p) => a + p[1], 0) / n, floorZ(d.floor)];
  }
  let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < d.floor.length; i += 3) { x += d.floor[i]; y += d.floor[i + 1]; z += d.floor[i + 2]; n++; }
  return [x / n, y / n, z / n];
}

function highlight() {
  for (const [id, e] of byId) for (const m of e.meshes) m.material.color.setHex(id === state.selected ? COLOR.hilite : m.userData.baseColor);
  // 出口・改札は地図の札を黄色にして示すので、ピンは立てない
  if (!state.selected || !byId.has(state.selected)) { pin.visible = false; return; }
  const { kind, data: d } = byId.get(state.selected);
  const a = anchorOf(kind, d);
  pin.position.set(a[0], a[1], state.mode === '2d' ? 0 : a[2]);
  pin.children[0].visible = pinHead.visible = state.mode === '3d';
  pin.visible = true;
}
// 目印の大きさを画面上で一定に保つ
function scalePin() {
  if (!pin.visible) return;
  const s = visibleHeight() / 90;
  pinRing.scale.setScalar(s); pinHead.scale.setScalar(s * 0.6);
  pinRing.lookAt(camera.position);
}
const f1 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const landmarkOf = id => overlay.landmarks.find(l => l.plateau_ids.includes(id));
const landmarkByName = name => overlay.landmarks.find(l => l.aliases.includes(name) || l.label === name);

// 出口のカード（ID は "exit:M4" の形）。地図の上の札は屋内地図に点がある出口だけ
function exitHtml(e) {
  const st = overlay.station;
  const links = e.toward.map(t => {
    const l = landmarkByName(t);
    return l ? `<button class="go" data-go="${l.plateau_ids[0]}">${esc(t)}</button>` : esc(t);
  }).join('・');
  return `<h2>${esc(st.name)}（${st.code}） 出口 ${e.id}</h2>
    <div><span class="k">行き先の表示</span> ${links}</div>
    <div><span class="k">地上行エレベーター</span> ${e.elevator_to_ground ? 'あり' : '記載なし'}${e.time_limited ? '　<span class="k">時間制限</span> あり（時間帯は記載なし）' : ''}</div>
    <div><span class="k">構内図での並び</span> 左から ${e.order_in_figure} 番目のまとまり（${esc(e.figure_group)}）。図に方位記号が無いので東西南北には読み替えていない</div>
    <div><span class="k">1Fの原資料点（開口か未確認）</span> ${e.ground_opening.status === 'indoor_map' ? '屋内地図の点あり（地上の階に赤丸）' : '資料なし'}</div>
    <div><span class="k">B1の原資料点（接続点か未確認）</span> ${e.underground_connection.status === 'indoor_map' ? '屋内地図の点あり（地下1階に白丸）' : '資料なし'}</div>
    <div><span class="k">出たあと向く方角</span> ${e.heading_after_exit.status === 'estimated'
      ? `${esc(e.heading_after_exit.label)}（推定・確度${e.heading_after_exit.confidence === 'medium' ? '中' : '低'}）` : '資料なし'}</div>
    ${e.heading_after_exit.status === 'estimated' ? `<div class="note">向きの根拠：${esc(e.heading_after_exit.basis)}。${esc(e.heading_after_exit.note)}。</div>` : ''}
    <div class="note">${e.ground_opening.status === 'indoor_map' || e.underground_connection.status === 'indoor_map' ? '点の位置は国交省の屋内地図（2020年作成）のもの。元は駅構内案内図の画像から作られたと記録にあり、精度は未検証。' : 'この出口は屋内地図にも点が無いので、地図には置いていない。'}${e.ground_opening.osm_candidates.map(c => {
      const p = e.ground_opening.status === 'indoor_map' ? e.ground_opening : e.underground_connection.status === 'indoor_map' ? e.underground_connection : null;
      return p ? `OpenStreetMap の候補点は屋内地図の点から約 ${Math.round(Math.hypot(c.x - p.x, c.y - p.y) / 5) * 5} m 離れている（未確認）。` : 'OpenStreetMap にも候補点があるが未確認。';
    }).join('')}行き先の建物を押すと、その建物を選ぶ（出口の場所ではない）。</div>
    <div class="note">出典：東京メトロ 東京駅構内図（図 ${esc(overlay.exit_source.figure_date_text)}、ページ ${esc(overlay.exit_source.page_date_text)}）。${esc(overlay.exit_source.viewed)} に閲覧。</div>`;
}

function gateHtml(g) {
  return `<h2>${esc(g.name)}</h2>
    <div><span class="k">駅</span> ${esc(g.station)}　<span class="k">階</span> ${FLOOR_LABEL[g.floor]}</div>
    <div class="note">${g.group === 'JRTokyoSta' ? 'JR の改札名。東京メトロの出口番号とは別のもの。' : '駅の改札。JR の改札名・他の駅とは別のもの。'}位置は国交省の屋内地図（2020年作成）の出入口の線。現在の名前と一致するかは公式図で照合中。</div>`;
}
const gateById = new Map([...gateLabels.values()].map(g => [g.id, g]));
// 建物の入口・JR の出入口・名前付き階段・OSM の出口候補（どれも駅の出口番号とは別の種類として持つ）
const poiById = new Map();
for (const e of overlay.entrances) poiById.set(e.id, { ...e, kind: 'ent' });
for (const e of overlay.jr_exits) poiById.set(e.id, { ...e, kind: 'jr' });
for (const e of overlay.stairs) poiById.set(e.id, { ...e, kind: 'st' });
// 八重洲地下街（ヤエチカ）の番号は当てはめ表にある所だけ。現地で確かめていないので、どれも札に「推定」を出す
const YC_CONF = { two_sources: '案内図の並び順と、OpenStreetMap（誰でも書き込める地図）の名前が一致', medium: '案内図の並び順と行き先の建物から推定', low: '案内図の並び順だけから推定' };
const ycName = y => y.yaechika ? `ヤエチカ ${y.yaechika.no} 推定`
  : y.yaechika_candidates ? `ヤエチカ ${y.yaechika_candidates.nos.join('/')}?` : '地下出入口';
for (const y of overlay.yaesu_openings || []) poiById.set(y.id, { ...y, kind: 'yo', name: ycName(y), floor: '1F' });
// OpenStreetMap にだけ点がある八重洲地下街の番号（PLATEAU の地下出入口が無い所）。候補として点線で出す
for (const o of (overlay.yaechika && overlay.yaechika.osm_only) || []) poiById.set('ycosm:' + o.no, { kind: 'ycosm', no: o.no, name: `ヤエチカ ${o.no}?`, floor: '1F', x: o.x, y: o.y, basis: o.basis, osm: o.osm });
for (const e of overlay.exits) for (const c of e.ground_opening.osm_candidates || [])
  if (e.ground_opening.status !== 'indoor_map') poiById.set('cand:' + e.id, { kind: 'cand', exit: e.id, name: e.id + '?', floor: '1F', x: c.x, y: c.y, osm: c.osm_node });
function poiHtml(q) {
  if (q.kind === 'ent') return `<h2>${esc(q.building)}の入口：${esc(q.name)}</h2>
    <div><span class="k">階</span> ${FLOOR_LABEL[q.floor]}　<span class="k">種類</span> 建物の入口</div>
    <div class="note">国交省の屋内地図（2020年作成）の「施設出入口」。駅の出口番号・改札とは別のもの。名前に「連絡口」とあっても、どの通路でつながるかはこの点だけでは確かめていない。</div>`;
  if (q.kind === 'jr') return `<h2>JR 東京駅：${esc(q.name)}</h2>
    <div><span class="k">階</span> ${FLOOR_LABEL[q.floor]}</div>
    <div class="note">国交省の屋内地図の JR 東京駅のファイルの「施設出入口」。東京メトロの出口番号とは別。</div>`;
  if (q.kind === 'yo') {
    const y = q.yaechika, c = q.yaechika_candidates;
    return `<h2>八重洲側：${y ? `八重洲地下街（ヤエチカ）${esc(y.no)} 番（推定）` : c ? `八重洲地下街 ${c.nos.map(esc).join('・')} のどれか（未確定）` : '地下出入口（番号は分からない）'}</h2>
    ${y && y.toward.length ? `<div><span class="k">案内図の行き先</span> ${y.toward.map(esc).join('・')}</div>` : ''}
    ${y ? `<div><span class="k">番号の確かさ</span> ${YC_CONF[y.confidence]}</div><div class="note">${esc(y.basis)}。現地では確かめていない。</div>` : ''}
    ${c ? `<div class="note">${esc(c.basis)}。</div>` : ''}
    ${!y && !c ? `<div class="note">${esc(overlay.yaechika ? overlay.yaechika.unmatched_note : '')}。</div>` : ''}
    ${q.top_tp != null ? `<div><span class="k">地下街の階段の上端</span> TP ${f1(q.top_tp)} m</div>` : ''}
    <div class="note">位置は PLATEAU 都市設備の「地下出入口」。${q.status === 'two_datasets' ? '地下街の階段のデータも同じ場所を指している。' : '近くに地下街の階段のデータは無い。'}番号は八重洲地下街のもので、丸ノ内線（M〜）・JR の出口とは別。出典：八重洲地下街 フロアマップ（${esc(overlay.yaechika ? overlay.yaechika.source.viewed : '')} 閲覧）。</div>`;
  }
  if (q.kind === 'ycosm') return `<h2>八重洲地下街 ${esc(q.no)} 番の候補（未確認）</h2>
    <div class="note">${esc(q.basis)}。OpenStreetMap は誰でも書き込める地図なので、確認済みにしていない（${esc(q.osm)}）。</div>`;
  if (q.kind === 'st') return `<h2>丸ノ内線 東京駅：${esc(q.name)}</h2>
    <div><span class="k">階</span> ${FLOOR_LABEL[q.floor]}</div>
    <div class="note">${esc(q.note || '')}</div>`;
  return `<h2>出口 ${esc(q.exit)} の候補（未確認）</h2>
    <div class="note">OpenStreetMap（誰でも書き込める地図）にある点。国交省の屋内地図にもメトロの公式データにも位置が無いので、確認済みにしていない。正しい位置の資料には、交通オープンデータ（ODPT）の登録が要る。</div>`;
}

function select(id) {
  state.selected = byId.has(id) || (id && id.startsWith('exit:') && exitById.has(id.slice(5))) || gateById.has(id) || poiById.has(id) ? id : null;
  highlight();
  renderLabels();
  const card = document.getElementById('card'), body = document.getElementById('cardBody');
  if (!state.selected) { card.style.display = 'none'; document.body.classList.remove('has-card'); saveHash(); return; }
  if (gateById.has(id) || poiById.has(id)) {
    body.innerHTML = gateById.has(id) ? gateHtml(gateById.get(id)) : poiHtml(poiById.get(id));
    card.style.display = 'block'; document.body.classList.add('has-card'); saveHash();
    return;
  }
  if (id.startsWith('exit:')) {
    body.innerHTML = exitHtml(exitById.get(id.slice(5)));
    body.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => focusOn(b.dataset.go); });
    card.style.display = 'block'; document.body.classList.add('has-card'); saveHash();
    return;
  }
  const { kind, data: d } = byId.get(id);
  let html = '';
  if (kind === 'stair') {
    const fn = FN[d.function] || d.function;
    html = `<h2>${d.function === 'EF_35' ? '地上への階段・スロープ' : '地下の設備：' + fn}</h2>
      <div><span class="k">上端</span> TP ${f1(d.zmax)} m　<span class="k">下端</span> TP ${f1(d.zmin)} m（高低差 ${(d.zmax - d.zmin).toFixed(1)} m）</div>
      <div><span class="k">分類コード</span> ${d.function}（${fn}）</div>
      <div class="note">出口番号・名称・向きは未確認（データに無い）。${(() => { const y = (overlay.yaesu_openings || []).find(y => y.stair_id === d.id); return y ? (y.stair_dist === 0 ? '上端（代表点）が、地上の PLATEAU 都市設備「地下出入口」の外形の中にある。' : `上端（代表点）が、地上の PLATEAU 都市設備「地下出入口」の外形から約 ${Math.round(y.stair_dist)} m。`) : '上端の位置は地上への接続候補で、出入口であることは未照合。'; })()}</div>`;
  } else if (kind === 'space') {
    html = `<h2>${esc(d.name || d.category_ja || '区画')}</h2>
      <div><span class="k">種類</span> ${esc(d.category_ja || d.category)}　<span class="k">階</span> ${FLOOR_LABEL[d.floor]}${d.outdoor ? '（屋外）' : ''}</div>
      <div><span class="k">データの区分</span> ${esc(d.station || d.facility)}</div>
      <div class="note">国交省 東京駅周辺屋内地図（2020年作成）の範囲。高さ・深さはデータに無い。隣の区画と通れるかは、このデータの形だけでは確かめていない。</div>`;
  } else if (kind === 'room') {
    const z = []; for (let i = 2; i < d.floor.length; i += 3) z.push(d.floor[i]);
    z.sort((a, b) => a - b);
    html = `<h2>地下区画 ${d.short}</h2>
      <div><span class="k">床の標高</span> TP ${f1(z[0])}〜${f1(z.at(-1))} m（中央値 ${f1(z[z.length >> 1])} m）</div>
      <div><span class="k">地表からの深さ（目安）</span> 約 ${(GROUND_Z - z[z.length >> 1]).toFixed(1)} m（地表を TP +${GROUND_Z} m として床の中央値から計算）</div>
      <div class="note">データ名「東京駅_B1地下通路」の一部。区画の名称・用途は無い。</div>`;
  } else {
    const l = landmarkOf(d.id);
    html = `<h2>${l ? esc(l.label) : d.name ? esc(d.name) : '建物（名称なし）'}</h2>
      ${l ? `<div><span class="k">データ上の名前</span> ${esc(d.name)}</div>` : ''}
      <div><span class="k">区</span> ${CITY[d.city] || d.city || '不明'}　<span class="k">高さ</span> ${d.measuredHeight > 0 ? d.measuredHeight.toFixed(1) + ' m' : '不明'}</div>
      <div><span class="k">底面の標高</span> TP ${f1(d.zmin)} m</div>
      ${l ? `<div class="note">名前と外形の対応：${esc(l.name_match.basis)}</div>` + l.facts.map(f => `<div class="note">${esc(f.text)}（${esc(f.checked)} 確認）</div>`).join('')
          : d.name ? '<div class="note">名称はデータ上の値。建物名ではなく入居施設名のことがある。</div>' : ''}
      <div class="note">地下とつながっているかは、このデータでは分からない（地上の外形だけ）。</div>`;
  }
  body.innerHTML = html;
  card.style.display = 'block';
  document.body.classList.add('has-card');
  saveHash();
}
document.getElementById('cardClose').onclick = () => select(null);

const ray = new THREE.Raycaster();
const tapGuard = new TapGuard();
renderer.domElement.addEventListener('pointerdown', e => tapGuard.down(e.pointerId, e.clientX, e.clientY, { pick: !e.labelOrigin }));
renderer.domElement.addEventListener('pointermove', e => tapGuard.move(e.pointerId, e.clientX, e.clientY));
renderer.domElement.addEventListener('pointercancel', e => tapGuard.cancel(e.pointerId));
renderer.domElement.addEventListener('pointerup', e => {
  if (!tapGuard.up(e.pointerId, e.clientX, e.clientY)) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const vis = pickables.filter(m => { let o = m; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
  let hits = ray.intersectObjects(vis, false);
  // 2D では地下・階段を建物より優先（上に重ねて描いているため）
  if (state.mode === '2d') hits.sort((a, b) => (byId.get(a.object.userData.id).kind === 'building') - (byId.get(b.object.userData.id).kind === 'building'));
  // 階段は区画より優先
  if (hits.length > 1) { const s = hits.find(h => byId.get(h.object.userData.id).kind === 'stair'); if (s && byId.get(hits[0].object.userData.id).kind === 'room') hits = [s]; }
  select(hits.length ? hits[0].object.userData.id : null);
});

// ---- レイヤー切替 ----
function toggle(btn, key) {
  btn.onclick = () => { state[key] = !state[key]; btn.setAttribute('aria-pressed', state[key]); applyLayers(); saveHash(); };
}
toggle(document.getElementById('tBldg'), 'showBldg');
toggle(document.getElementById('tUnder'), 'showUnder');
toggle(document.getElementById('tNet'), 'showNet');
document.getElementById('m2d').onclick = () => state.mode !== '2d' && setMode('2d');
document.getElementById('m3d').onclick = () => state.mode !== '3d' && setMode('3d');

// ---- 建物の名前ラベル（2D・3D 共通。地物の代表点を画面へ投影） ----
const labelBox = document.getElementById('labels');
const labels = [];
function addLabel(text, cls, id, x, y, z3, floor, onclick) {
  const el = document.createElement('button');
  el.textContent = text;
  el.title = text;
  if (cls) el.className = cls;
  el.onclick = onclick || (() => select(id));
  labelBox.appendChild(el);
  labels.push({ el, id, pos: new THREE.Vector3(x, y, z3), floor, text, small: /\b(ent|stair|dim)\b/.test(cls || '') });
}
// 建物の入口・階段の札は、拡大したとき（画面の縦が 250 m 未満）だけ名前を出す。それ以外は小さな点
const DETAIL_H = 250;
for (const l of overlay.landmarks) {
  const b = byId.get(l.plateau_ids[0]).data;
  const a = anchorOf('building', b);
  addLabel(l.label, '', b.id, a[0], a[1], b.zmin + 30, null);
}
for (const g of gateLabels.values()) addLabel(g.name, 'gate' + (g.group === 'JRTokyoSta' ? ' jr' : ''), g.id, g.x, g.y, floorZ(g.floor), g.floor);
for (const [t, x, y] of schemLabels) addLabel(t, 'schem', null, x, y, floorZ('B2'), 'B2', () => {});
for (const p of exitPts) addLabel(p.exit, 'exit' + (p.under ? ' under' : ''), 'exit:' + p.exit, p.x, p.y, floorZ(p.floor), p.floor);
for (const e of overlay.exits) {
  const h = e.heading_after_exit, g = e.ground_opening;
  if (h.status !== 'estimated' || g.status !== 'indoor_map') continue;
  // 赤丸の少し先（向きの方へ 14 m）に矢印を置く。札の文字は回さず、矢印だけ回す
  const r = (90 - h.bearing) * Math.PI / 180;
  addLabel('➤', 'head ' + h.confidence, 'exit:' + e.id, g.x + 14 * Math.cos(r), g.y + 14 * Math.sin(r), floorZ('1F'), '1F');
  labels.at(-1).el.style.rotate = (h.bearing - 90) + 'deg';
  addLabel('推定', 'headtag ' + h.confidence, 'exit:' + e.id, g.x + 14 * Math.cos(r), g.y + 14 * Math.sin(r) - 7, floorZ('1F'), '1F');
}
for (const q of poiById.values()) addLabel(q.kind === 'ent' ? q.building + '：' + q.name : q.name, { ent: 'ent', jr: 'gate jr', st: 'stair', cand: 'cand', ycosm: 'cand', yo: q.yaechika || q.yaechika_candidates ? 'yo est' : q.status === 'two_datasets' ? 'yo' : 'yo dim' }[q.kind], q.id, q.x, q.y, floorZ(q.floor), q.floor);
const tmp = new THREE.Vector3();
function renderLabels() {
  const w = view.clientWidth, h = view.clientHeight;
  for (const L of labels) {
    tmp.copy(L.pos);
    if (state.mode === '2d') tmp.z = 0;
    tmp.project(camera);
    // 建物名は「建物」が出ているとき。改札・出口は 2D なら選んだ階だけ、3D なら全階
    const layerOn = L.floor ? state.showUnder && (state.mode === '3d' || L.floor === state.floor) : state.showBldg;
    const show = layerOn && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    L.el.style.display = show ? 'block' : 'none';
    L.el.style.left = ((tmp.x + 1) / 2 * w) + 'px';
    L.el.style.top = ((1 - tmp.y) / 2 * h) + 'px';
    L.el.classList.toggle('on', state.selected === L.id);
    if (L.small) {
      const full = !!L.text && (visibleHeight() < DETAIL_H || state.selected === L.id);
      if (L.el.dataset.full !== String(full)) { L.el.dataset.full = full; L.el.textContent = full ? L.text : ''; L.el.classList.toggle('dot', !full); }
    }
  }
  mobileUI?.layoutLabels(labels);
  // 方位：2D は常に北が上。3D は視点の向きに合わせて回す
  const az = state.mode === '2d' ? 0 : Math.atan2(camera.position.x - controls.target.x, controls.target.y - camera.position.y);
  document.getElementById('compassN').style.transform = `rotate(${(-az) * 180 / Math.PI}deg)`;
}

// 選んだ地物を画面の中心へ（縮尺はそのまま）
function focusOn(id) {
  let a;
  if (byId.has(id)) { const { kind, data: d } = byId.get(id); a = anchorOf(kind, d); if (kind === 'space') setFloor(d.floor); }
  else if (gateById.has(id)) { const g = gateById.get(id); a = [g.x, g.y]; setFloor(g.floor); }
  else if (poiById.has(id)) { const q = poiById.get(id); a = [q.x, q.y]; setFloor(q.floor); }
  else if (id.startsWith('exit:')) {
    const ps = exitPts.filter(p => p.exit === id.slice(5));
    if (!ps.length) { select(id); return; }
    const p = ps.find(q => q.floor === state.floor) || ps[0];
    a = [p.x, p.y]; setFloor(p.floor);
  } else return;
  // スマホ幅では下にカードが出るので、選んだ所が画面の上寄りに来るよう中心を南へずらす
  const shift = 0; // Mobile canvas excludes the card; no hidden-point compensation.
  const dx = a[0] - controls.target.x, dy = a[1] - shift - controls.target.y;
  controls.target.x += dx; controls.target.y += dy;
  camera.position.x += dx; camera.position.y += dy;
  controls.update();
  select(id);
}

// ---- 検索（建物名・検索語・出口番号・出口の行き先） ----
const norm = s => s.normalize('NFKC').toLowerCase().replace(/\s/g, '');
const searchIndex = [];
for (const l of overlay.landmarks) searchIndex.push({ keys: [l.label, ...l.aliases], title: l.label, sub: '建物', id: l.plateau_ids[0] });
for (const b of data.buildings) if (b.name && !landmarkOf(b.id)) searchIndex.push({ keys: [b.name], title: b.name, sub: '建物（データ上の名前）', id: b.id });
for (const e of overlay.exits) searchIndex.push({ keys: [e.id, e.id.slice(1) + '番出口', ...e.toward], title: `丸ノ内線 東京駅 出口 ${e.id}`,
  sub: e.toward.join('・') + (exitPts.some(p => p.exit === e.id) ? '（屋内地図に位置あり）' : '（位置の資料なし）'), id: 'exit:' + e.id });
for (const q of poiById.values()) searchIndex.push({ keys: [q.name, q.building || '', (q.building || '') + q.name,
  ...(q.yaechika ? ['ヤエチカ' + q.yaechika.no, '八重洲地下街' + q.yaechika.no, '八重洲地下街 ' + q.yaechika.no + '番', ...q.yaechika.toward] : [])], title: q.kind === 'ent' ? q.building + 'の入口：' + q.name : q.kind === 'cand' ? '出口 ' + q.exit + ' の候補（未確認）' : q.name,
  sub: { ent: '建物の入口', jr: 'JR 東京駅', st: '丸ノ内線 東京駅の階段', cand: 'OpenStreetMap の点', ycosm: 'OpenStreetMap の点（八重洲地下街）', yo: '八重洲側の地下出入口（PLATEAU）' }[q.kind] + '・' + FLOOR_LABEL[q.floor], id: q.id });
for (const g of gateLabels.values()) searchIndex.push({ keys: [g.name, g.station + g.name], title: g.name, sub: `${g.station}・${FLOOR_LABEL[g.floor]}`, id: g.id });
function search(text) {
  const t = norm(text);
  if (!t) return [];
  const exact = /^m?\d+$/.test(t) ? searchIndex.filter(r => r.id === 'exit:M' + t.replace('m', '')) : [];
  const rest = searchIndex.filter(r => !exact.includes(r) && r.keys.some(k => norm(k).includes(t)));
  return exact.concat(rest).slice(0, 12);
}
const qIn = document.getElementById('q'), results = document.getElementById('results');
function showResults() {
  const rs = search(qIn.value);
  results.innerHTML = rs.length ? rs.map((r, i) => `<li><button data-i="${i}">${esc(r.title)}<br><span class="k">${esc(r.sub)}</span></button></li>`).join('')
    : qIn.value ? '<li><button disabled>見つからない（未収録の可能性）</button></li>' : '';
  results.style.display = qIn.value ? 'block' : 'none';
  results.querySelectorAll('[data-i]').forEach(b => {
    b.onclick = () => { const r = rs[+b.dataset.i]; results.style.display = 'none'; focusOn(r.id); };
  });
}
qIn.addEventListener('input', showResults);
qIn.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = results.querySelector('[data-i]'); if (b) b.click(); } });

// ---- 出口一覧（位置は持たない。名前と並びだけ） ----
const exitPanel = document.getElementById('exitPanel');
exitPanel.innerHTML = `<h2>${esc(overlay.station.name)}（${overlay.station.code}）の出口</h2>
  <div class="note">JR 東京駅の改札名・大手町駅の出口番号とは別。場所と出たあとの向きは未確認なので地図には置いていない。並びは構内図の左から順（方位ではない）。</div>
  <table><tr><th>番号</th><th>行き先の表示</th><th>地上行EV</th><th>出たあとの向き</th></tr>
  ${overlay.exits.slice().sort((a, b) => a.order_in_figure - b.order_in_figure || +a.id.slice(1) - +b.id.slice(1)).map(e =>
    `<tr data-exit="${e.id}"><td><b>${e.id}</b>${e.time_limited ? '＊' : ''}</td><td>${e.toward.map(esc).join('・')}</td><td>${e.elevator_to_ground ? 'あり' : '—'}</td><td>${e.heading_after_exit.status === 'estimated' ? esc(e.heading_after_exit.label) + '（推定）' : '—'}</td></tr>`).join('')}
  </table><div class="note">＊は時間制限あり（時間帯は記載なし）。出典：東京メトロ 東京駅構内図（図 ${esc(overlay.exit_source.figure_date_text)}）。</div>`;
exitPanel.querySelectorAll('[data-exit]').forEach(tr => { tr.onclick = () => focusOn('exit:' + tr.dataset.exit); });
if (overlay.yaechika) {
  const at = new Map((overlay.yaesu_openings || []).filter(y => y.yaechika).map(y => [y.yaechika.no, y]));
  const yc = overlay.yaechika;
  const osmOnly = new Set((yc.osm_only || []).map(o => o.no));
  const cand = new Set((overlay.yaesu_openings || []).flatMap(y => y.yaechika_candidates ? y.yaechika_candidates.nos : []));
  exitPanel.insertAdjacentHTML('beforeend', `<h2>八重洲地下街（ヤエチカ）の地上への出口</h2>
  <div class="note">丸ノ内線の M〜 とは別の番号。地図の位置は、案内図の並び順などから当てはめたもので、現地では確かめていない。「候補だけ」は、地図の出入口のどれかと見られるが1つに決められない番号。案内図は北が上ではなく縮尺も違うので、図の上の位置は使っていない。</div>
  <table><tr><th>番号</th><th>行き先の表示</th><th>地図の位置</th></tr>
  ${yc.exits.filter(e => e.kind === 'ground_stairs').map(e => { const y = at.get(e.no);
    return `<tr${y ? ` data-yo="${esc(y.id)}"` : ''}><td><b>${esc(e.no)}</b></td><td>${e.closed ? esc(e.closed_text) : e.toward.map(esc).join('・') || '—'}</td><td>${y ? 'あり（推定）' : cand.has(e.no) || osmOnly.has(e.no) ? '候補だけ' : '分からない'}</td></tr>`; }).join('')}
  </table><div class="note">${esc(yc.not_on_map)}。出典：八重洲地下街 フロアマップ（${esc(yc.source.viewed)} 閲覧）。</div>`);
  exitPanel.querySelectorAll('[data-yo]').forEach(tr => { tr.onclick = () => focusOn(tr.dataset.yo); });
}

// 凡例は押したときだけ開く（地図の札を隠さないため）
const legend = document.getElementById('legend'), legendBtn = document.getElementById('legendBtn');
legendBtn.onclick = () => { const on = !legend.classList.contains('open'); legend.classList.toggle('open', on); legendBtn.setAttribute('aria-expanded', on); legendBtn.textContent = on ? '凡例 ▴' : '凡例 ▾'; };

const footMore = document.getElementById('footMore'), footFull = document.getElementById('footFull');
footMore.onclick = () => { footFull.hidden = !footFull.hidden; footMore.setAttribute('aria-expanded', !footFull.hidden); footMore.textContent = footFull.hidden ? '詳しく' : '閉じる'; };

// ---- 丸の内側・八重洲側へ移る（縮尺はそのまま） ----
const AREAS = { marunouchi: [-230, 60], yaesu: [190, -40] };
document.querySelectorAll('[data-area]').forEach(b => { b.onclick = () => {
  const [x, y] = AREAS[b.dataset.area]; const dx = x - controls.target.x, dy = y - controls.target.y;
  controls.target.x += dx; controls.target.y += dy; camera.position.x += dx; camera.position.y += dy; controls.update(); saveHash();
}; });

// ---- 階の切り替え（2D/3D を切り替えても残す） ----
function setFloor(f) {
  if (!FLOORS.includes(f) || f === state.floor) return;
  state.floor = f; applyLayers(); renderLabels(); saveHash();
}
document.querySelectorAll('[data-floor]').forEach(b => { b.onclick = () => setFloor(b.dataset.floor); });
const tExits = document.getElementById('tExits');
tExits.onclick = () => { const on = tExits.getAttribute('aria-pressed') !== 'true'; tExits.setAttribute('aria-pressed', on); exitPanel.style.display = on ? 'block' : 'none'; };

// ---- URL に状態を残す（再現・共有用。ローカル利用のみ） ----
function saveHash() {
  const t = controls.target;
  const p = new URLSearchParams({ m: state.mode, f: state.floor, x: t.x.toFixed(1), y: t.y.toFixed(1), h: visibleHeight().toFixed(0) });
  if (state.selected) p.set('sel', state.selected);
  if (!state.showBldg) p.set('b', '0');
  if (!state.showUnder) p.set('u', '0');
  if (!state.showNet) p.set('n', '0');
  history.replaceState(null, '', '#' + p.toString());
}
controls.addEventListener('end', saveHash);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  persp.aspect = w / h; persp.updateProjectionMatrix();
  const vh = camera === ortho ? visibleHeight() : null;
  ortho.left = -w / h; ortho.right = w / h; ortho.top = 1; ortho.bottom = -1;
  if (vh) ortho.zoom = 2 / vh;
  ortho.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 初期状態（URL の指定があれば復元）
resize();
const q = new URLSearchParams(location.hash.slice(1));
state.showBldg = q.get('b') !== '0';
state.showUnder = q.get('u') !== '0';
state.showNet = q.get('n') !== '0';
document.getElementById('tNet').setAttribute('aria-pressed', state.showNet);
if (FLOORS.includes(q.get('f'))) state.floor = q.get('f');
document.getElementById('tBldg').setAttribute('aria-pressed', state.showBldg);
document.getElementById('tUnder').setAttribute('aria-pressed', state.showUnder);
// 初期の中心は丸の内側（丸ノ内線の改札のあたり）。重点範囲を先に見せる
controls.target.set(q.has('x') ? +q.get('x') : -200, q.has('y') ? +q.get('y') : 60, 0);
ortho.zoom = 2 / (q.has('h') ? +q.get('h') : (view.clientWidth < 600 ? 700 : 520));
camera = ortho; controls.object = ortho;
setMode(q.get('m') === '3d' ? '3d' : '2d');
if (q.get('sel')) select(q.get('sel'));

window.__app = { state, byId, setMode, setFloor, select, focusOn, search, controls, data, overlay, indoor, exitPts, gateById }; // テスト用

mobileUI = installMobileUI({ THREE, controls, state, saveHash, resize, visibleHeight, setMode });
renderer.setAnimationLoop(() => { controls.update(); scalePin(); renderer.render(scene, camera); renderLabels(); });
