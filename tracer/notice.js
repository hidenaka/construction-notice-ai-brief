import { decodeRestrictionFromUrl } from "./share-link.js";

const RESTRICTION_TYPE_JA = {
  sidewalk_closed: "歩道通行止め",
  sidewalk_narrowed: "歩道が狭くなります",
  road_closed: "通行止め",
  lane_closure: "車線規制",
  alternating_one_way: "片側交互通行",
  bicycle_lane_closed: "自転車通行帯規制",
  turn_restriction: "右左折規制",
};
const AFFECTED_USER_JA = {
  pedestrian: "歩行者",
  wheelchair: "車いす",
  stroller: "ベビーカー",
  car: "お車",
  bicycle: "自転車",
  bus: "バス",
  delivery: "配送",
};

function showError() {
  document.getElementById("content").hidden = true;
  document.getElementById("error-view").hidden = false;
}

function localPreviewRestriction(id) {
  try {
    const raw = localStorage.getItem("construction-notice:" + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.restriction ? parsed.restriction : null;
  } catch (err) {
    return null;
  }
}

function canUseLocalPreviewFallback() {
  return location.hostname.endsWith("github.io") || location.protocol === "file:";
}

function fmtDate(d) {
  if (!d) return "未定";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function bboxOf(coords) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

async function main() {
  const params = new URLSearchParams(location.search);
  const sharedData = params.get("data");
  const id = params.get("id");
  if (!id && !sharedData) { showError(); return; }
  let restriction = null;
  if (sharedData) {
    restriction = decodeRestrictionFromUrl(sharedData);
  }
  if (!restriction && id) {
    try {
      const res = await fetch("/api/restrictions/" + encodeURIComponent(id));
      if (res.ok) ({ restriction } = await res.json());
    } catch (err) {
      restriction = null;
    }
  }
  if (!restriction && id && canUseLocalPreviewFallback()) restriction = localPreviewRestriction(id);
  if (!restriction) { showError(); return; }

  document.getElementById("n-title").textContent = restriction.title;
  document.getElementById("n-period").textContent =
    fmtDate(restriction.startAt) + " 〜 " + fmtDate(restriction.endAt);
  if (restriction.timeWindow) {
    document.getElementById("n-timewindow-field").hidden = false;
    document.getElementById("n-timewindow").textContent = restriction.timeWindow;
  }
  document.getElementById("n-type").textContent =
    RESTRICTION_TYPE_JA[restriction.restrictionType] || restriction.restrictionType;
  document.getElementById("n-users").textContent =
    (restriction.affectedUsers || []).map((u) => AFFECTED_USER_JA[u] || u).join("・");

  const GSI = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
  const map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources: { gsi: { type: "raster", tiles: [GSI], tileSize: 256, maxzoom: 18, attribution: "国土地理院" } },
             layers: [{ id: "gsi", type: "raster", source: "gsi" }] },
    center: [139.7671, 35.6812], zoom: 13,
    maxZoom: 17, // 地理院タイルはz18まで。fitBoundsで寄りすぎてタイル404になるのを防ぐ
  });
  map.on("load", () => {
    map.resize(); // カードレイアウト確定後にキャンバス幅を再計算（右側が白抜けする問題の対策）
    map.addSource("restriction", { type: "geojson", data: { type: "Feature", geometry: restriction.geometry } });
    map.addLayer({ id: "restriction-line", type: "line", source: "restriction",
      paint: { "line-color": "#c83a2c", "line-width": 5, "line-opacity": 0.8 } });
    if (restriction.geometry.type === "LineString") {
      map.fitBounds(bboxOf(restriction.geometry.coordinates), { padding: 60, maxZoom: 16.5 });
    }
  });

  const qr = qrcode(0, "M");
  qr.addData(location.href);
  qr.make();
  document.getElementById("qr").innerHTML = qr.createImgTag(4);

  document.getElementById("print-btn").onclick = () => window.print();
}

main();
