const GSI = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const state = { drawing: false, coordinates: [], markers: [], savedId: null };

const els = {
  title: document.getElementById("trace-title"),
  start: document.getElementById("trace-start"),
  end: document.getElementById("trace-end"),
  time: document.getElementById("trace-time"),
  type: document.getElementById("trace-type"),
  pointCount: document.getElementById("point-count"),
  distance: document.getElementById("trace-distance"),
  status: document.getElementById("trace-status"),
  drawToggle: document.getElementById("draw-toggle"),
  undo: document.getElementById("undo-point"),
  clear: document.getElementById("clear-trace"),
  save: document.getElementById("save-trace"),
  copy: document.getElementById("copy-geojson"),
  noticeLink: document.getElementById("notice-link"),
  coordinateList: document.getElementById("coordinate-list"),
};

const map = new maplibregl.Map({
  container: "trace-map",
  style: {
    version: 8,
    sources: { gsi: { type: "raster", tiles: [GSI], tileSize: 256, maxzoom: 18, attribution: "国土地理院" } },
    layers: [{ id: "gsi", type: "raster", source: "gsi" }],
  },
  center: [139.7671, 35.6812],
  zoom: 16,
  maxZoom: 17,
});

function lineFeature() {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: state.coordinates },
  };
}

function pointFeatures() {
  return {
    type: "FeatureCollection",
    features: state.coordinates.map((coordinates, index) => ({
      type: "Feature",
      properties: { index, label: index === 0 ? "始点" : index === state.coordinates.length - 1 ? "終点" : String(index + 1) },
      geometry: { type: "Point", coordinates },
    })),
  };
}

function haversineMeters(a, b) {
  const r = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function totalMeters() {
  let sum = 0;
  for (let i = 1; i < state.coordinates.length; i++) sum += haversineMeters(state.coordinates[i - 1], state.coordinates[i]);
  return sum;
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)}km` : `${Math.round(meters)}m`;
}

function selectedAffectedUsers() {
  return [...document.querySelectorAll('input[name="affected"]:checked')].map((input) => input.value);
}

function tracePayload() {
  return {
    title: els.title.value.trim() || "道路工事",
    coordinates: state.coordinates,
    restrictionType: els.type.value,
    affectedUsers: selectedAffectedUsers(),
    startAt: els.start.value || null,
    endAt: els.end.value || null,
    timeWindow: els.time.value.trim() || null,
    passability: "detour_required",
  };
}

function traceGeoJson() {
  return JSON.stringify(lineFeature(), null, 2);
}

function clearMarkers() {
  for (const marker of state.markers) marker.remove();
  state.markers = [];
}

function renderMarkers() {
  clearMarkers();
  state.coordinates.forEach((coord, index) => {
    const el = document.createElement("div");
    el.className = "vertex-marker";
    el.title = `頂点 ${index + 1}`;
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat(coord)
      .addTo(map);
    marker.on("drag", () => {
      markTraceChanged();
      const lngLat = marker.getLngLat();
      state.coordinates[index] = [lngLat.lng, lngLat.lat];
      renderTrace({ keepMarkers: true });
    });
    marker.on("dragend", () => {
      markTraceChanged();
      const lngLat = marker.getLngLat();
      state.coordinates[index] = [lngLat.lng, lngLat.lat];
      renderTrace();
    });
    state.markers.push(marker);
  });
}

function renderTrace(options = {}) {
  const line = lineFeature();
  const points = pointFeatures();
  if (map.getSource("trace-line")) map.getSource("trace-line").setData(line);
  if (map.getSource("trace-points")) map.getSource("trace-points").setData(points);
  if (!options.keepMarkers) renderMarkers();

  els.pointCount.textContent = String(state.coordinates.length);
  els.distance.textContent = formatDistance(totalMeters());
  els.coordinateList.innerHTML = state.coordinates.map(([lng, lat], index) =>
    `<li>${index + 1}: ${lng.toFixed(7)}, ${lat.toFixed(7)}</li>`).join("");
  const hasLine = state.coordinates.length >= 2;
  els.undo.disabled = state.coordinates.length === 0;
  els.clear.disabled = state.coordinates.length === 0;
  els.copy.disabled = !hasLine;
  els.save.disabled = !hasLine || selectedAffectedUsers().length === 0 || Boolean(state.savedId);
  if (!hasLine) els.noticeLink.hidden = true;
}

function markTraceChanged() {
  state.savedId = null;
  els.noticeLink.hidden = true;
}

function fitToTrace() {
  if (state.coordinates.length < 2) return;
  const lngs = state.coordinates.map((p) => p[0]);
  const lats = state.coordinates.map((p) => p[1]);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
    padding: 90,
    maxZoom: 17,
  });
}

map.on("load", () => {
  map.addSource("trace-line", { type: "geojson", data: lineFeature() });
  map.addLayer({
    id: "trace-line",
    type: "line",
    source: "trace-line",
    paint: { "line-color": "#c83a2c", "line-width": 7, "line-opacity": 0.9 },
  });
  map.addSource("trace-points", { type: "geojson", data: pointFeatures() });
  map.addLayer({
    id: "trace-point-labels",
    type: "symbol",
    source: "trace-points",
    layout: { "text-field": ["get", "label"], "text-offset": [0, 1.35], "text-size": 12 },
    paint: { "text-color": "#17201b", "text-halo-color": "#ffffff", "text-halo-width": 2 },
  });
  renderTrace();
});

map.on("click", (event) => {
  if (!state.drawing) return;
  state.coordinates.push([event.lngLat.lng, event.lngLat.lat]);
  markTraceChanged();
  els.status.textContent = state.coordinates.length < 2
    ? "終点をクリックしてください。"
    : "赤い点をドラッグして申請区間に合わせてください。";
  renderTrace();
});

els.drawToggle.onclick = () => {
  state.drawing = !state.drawing;
  els.drawToggle.textContent = state.drawing ? "描画を止める" : "線を引く";
  els.status.textContent = state.drawing
    ? "地図上で施工区間の始点、曲がり角、終点をクリックしてください。"
    : "赤い点をドラッグして微調整できます。";
};

els.undo.onclick = () => {
  state.coordinates.pop();
  markTraceChanged();
  els.status.textContent = "最後の頂点を戻しました。";
  renderTrace();
};

els.clear.onclick = () => {
  state.coordinates = [];
  state.savedId = null;
  els.status.textContent = "施工区間を削除しました。もう一度地図上で線を引いてください。";
  renderTrace();
};

els.copy.onclick = async () => {
  try {
    await navigator.clipboard.writeText(traceGeoJson());
    els.status.textContent = "GeoJSONをコピーしました。";
  } catch (error) {
    els.status.textContent = "コピーできませんでした。ブラウザの権限またはHTTPS接続を確認してください。";
  }
};

document.querySelectorAll('input[name="affected"]').forEach((input) => {
  input.addEventListener("change", () => {
    markTraceChanged();
    renderTrace();
  });
});

[els.title, els.start, els.end, els.time, els.type].forEach((input) => {
  const handleChange = () => {
    markTraceChanged();
    renderTrace();
  };
  input.addEventListener("input", handleChange);
  input.addEventListener("change", handleChange);
});

function canUseLocalPreviewFallback() {
  return location.hostname.endsWith("github.io") || location.protocol === "file:";
}

function saveLocalPreview(payload) {
  const id = `demo-${Date.now()}`;
  const restriction = {
    id,
    title: payload.title,
    geometry: { type: "LineString", coordinates: payload.coordinates },
    startAt: payload.startAt,
    endAt: payload.endAt,
    timeWindow: payload.timeWindow,
    restrictionType: payload.restrictionType,
    affectedUsers: payload.affectedUsers,
    passability: payload.passability,
    source: "manual",
    verificationStatus: "submitted",
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(`construction-notice:${id}`, JSON.stringify({ restriction }));
  return id;
}

els.save.onclick = async () => {
  const payload = tracePayload();
  if (payload.coordinates.length < 2) {
    els.status.textContent = "施工区間は2点以上で指定してください。";
    return;
  }
  if (payload.affectedUsers.length === 0) {
    els.status.textContent = "影響対象を1つ以上選択してください。";
    return;
  }
  els.save.disabled = true;
  els.status.textContent = "施工区間を保存しています...";
  try {
    const res = await fetch("/api/restrictions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("save failed");
    const body = await res.json();
    state.savedId = body.id;
    const href = `notice.html?id=${encodeURIComponent(body.id)}`;
    els.noticeLink.href = href;
    els.noticeLink.hidden = false;
    els.status.textContent = "保存しました。同じ施工区間がQRページに表示されます。";
    fitToTrace();
  } catch (error) {
    if (!canUseLocalPreviewFallback()) {
      els.status.textContent = "保存に失敗しました。線は消していないので、内容を確認して再試行してください。";
      return;
    }
    const demoId = saveLocalPreview(payload);
    state.savedId = demoId;
    const href = `notice.html?id=${encodeURIComponent(demoId)}`;
    els.noticeLink.href = href;
    els.noticeLink.hidden = false;
    els.status.textContent = "GitHub Pages確認用に、この端末内のプレビューとして保存しました。";
    fitToTrace();
  } finally {
    renderTrace();
  }
};
