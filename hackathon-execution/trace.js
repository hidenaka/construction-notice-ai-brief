import { buildLanePlan, laneSummary } from "./lane-plan.js";
import {
  affectedUsersFromDraft,
  draftFromText,
  mapCandidateFromDraft,
  reviewItemsFromDraft,
  sampleDraft,
  traceFieldsFromDraft,
} from "./document-intake.js";
import { inferLanePlanInput, inferenceSummary } from "./lane-inference.js";
import {
  buildOwnerReport,
  buildPilotPackage,
  buildSafetyReview,
  buildValidationRecord,
} from "./reporting.js";
import { restrictionToShareUrl } from "./share-link.js";

const GSI = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const RESTRICTION_LABELS = {
  lane_closure: "車線規制",
  sidewalk_closed: "歩道通行止め",
  sidewalk_narrowed: "歩道狭小",
  road_closed: "通行止め",
  alternating_one_way: "片側交互通行",
  bicycle_lane_closed: "自転車レーン規制",
  turn_restriction: "右左折規制",
};
const state = {
  drawing: false,
  coordinates: [],
  markers: [],
  savedId: null,
  closedLaneIds: ["forward-1"],
  manualLaneOverride: false,
  inferenceAccepted: false,
  documentDraft: null,
  documentSourceName: "",
  mapCandidate: null,
};

const els = {
  title: document.getElementById("trace-title"),
  documentFiles: document.getElementById("document-files"),
  documentStatus: document.getElementById("document-status"),
  documentList: document.getElementById("document-list"),
  sampleDocument: document.getElementById("sample-document"),
  readoutTitle: document.getElementById("readout-title"),
  readoutDates: document.getElementById("readout-dates"),
  readoutTime: document.getElementById("readout-time"),
  readoutType: document.getElementById("readout-type"),
  readoutNote: document.getElementById("readout-note"),
  reviewList: document.getElementById("review-list"),
  mapCandidateCard: document.getElementById("map-candidate-card"),
  mapCandidateStatus: document.getElementById("map-candidate-status"),
  mapCandidateTitle: document.getElementById("map-candidate-title"),
  mapCandidateDetail: document.getElementById("map-candidate-detail"),
  draftFields: document.getElementById("draft-fields"),
  start: document.getElementById("trace-start"),
  end: document.getElementById("trace-end"),
  time: document.getElementById("trace-time"),
  type: document.getElementById("trace-type"),
  forwardLanes: document.getElementById("forward-lanes"),
  oppositeLanes: document.getElementById("opposite-lanes"),
  laneWidth: document.getElementById("lane-width"),
  inferenceSummary: document.getElementById("inference-summary"),
  inferenceReason: document.getElementById("inference-reason"),
  acceptInference: document.getElementById("accept-inference"),
  adjustInference: document.getElementById("adjust-inference"),
  rerunInference: document.getElementById("rerun-inference"),
  advancedWork: document.getElementById("advanced-work"),
  advancedLanes: document.getElementById("advanced-lanes"),
  profileMode: document.getElementById("lane-profile-mode"),
  forwardLaneWidth: document.getElementById("forward-lane-width"),
  oppositeLaneWidth: document.getElementById("opposite-lane-width"),
  closureStart: document.getElementById("closure-start"),
  closureEnd: document.getElementById("closure-end"),
  profileNote: document.getElementById("lane-profile-note"),
  lanePicker: document.getElementById("lane-picker"),
  pointCount: document.getElementById("point-count"),
  distance: document.getElementById("trace-distance"),
  status: document.getElementById("trace-status"),
  drawToggle: document.getElementById("draw-toggle"),
  undo: document.getElementById("undo-point"),
  clear: document.getElementById("clear-trace"),
  save: document.getElementById("save-trace"),
  copy: document.getElementById("copy-geojson"),
  noticeLink: document.getElementById("notice-link"),
  generatedNotice: document.getElementById("generated-notice"),
  generatedHistory: document.getElementById("generated-history"),
  generatedReport: document.getElementById("generated-report"),
  reportStatus: document.getElementById("report-status"),
  reportPublishedAt: document.getElementById("report-published-at"),
  reportConfirmedBy: document.getElementById("report-confirmed-by"),
  reportViews: document.getElementById("report-views"),
  reportDeliverables: document.getElementById("report-deliverables"),
  reportHistory: document.getElementById("report-history"),
  reportInquiries: document.getElementById("report-inquiries"),
  safetySummary: document.getElementById("safety-summary"),
  safetyList: document.getElementById("safety-list"),
  validationConfirmed: document.getElementById("validation-confirmed"),
  validationNeeds: document.getElementById("validation-needs"),
  validationBlocked: document.getElementById("validation-blocked"),
  validationConfidence: document.getElementById("validation-confidence"),
  copyValidation: document.getElementById("copy-validation"),
  pilotName: document.getElementById("pilot-name"),
  pilotPrice: document.getElementById("pilot-price"),
  pilotApproval: document.getElementById("pilot-approval"),
  coordinateList: document.getElementById("coordinate-list"),
};

function restrictionLabel(value) {
  return RESTRICTION_LABELS[value] || value || "未読取";
}

function percent(confidence) {
  return `${Math.round(confidence * 100)}%`;
}

function hasReadValue(key) {
  const value = state.documentDraft && state.documentDraft[key];
  return value !== undefined && value !== null && value !== "";
}

function fieldValueForSnapshot(key, inputValue, defaultValue) {
  if (hasReadValue(key)) return inputValue;
  return inputValue && inputValue !== defaultValue ? inputValue : "";
}

function currentDraftSnapshot() {
  const confidence = { ...(state.documentDraft && state.documentDraft.confidence) };
  const defaults = traceFieldsFromDraft(state.documentDraft || {});
  const title = fieldValueForSnapshot("title", els.title.value.trim(), defaults.title);
  const startAt = fieldValueForSnapshot("startAt", els.start.value, defaults.startAt);
  const endAt = fieldValueForSnapshot("endAt", els.end.value, defaults.endAt);
  const timeWindow = fieldValueForSnapshot("timeWindow", els.time.value.trim(), defaults.timeWindow);
  const restrictionType = fieldValueForSnapshot("restrictionType", els.type.value, defaults.restrictionType);
  const mapCandidate = state.mapCandidate || (state.coordinates.length >= 2
    ? { source: "地図上で補正済み", confidence: 1, coordinates: state.coordinates }
    : null);
  if (title && !hasReadValue("title")) confidence.title = 1;
  if (startAt && endAt && !(hasReadValue("startAt") && hasReadValue("endAt"))) confidence.dates = 1;
  if (timeWindow && !hasReadValue("timeWindow")) confidence.timeWindow = 1;
  if (restrictionType && !hasReadValue("restrictionType")) confidence.restrictionType = 1;
  return {
    ...(state.documentDraft || {}),
    title,
    startAt,
    endAt,
    timeWindow,
    restrictionType,
    confidence,
    mapCandidate,
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

async function draftFromFile(file) {
  if (file.type === "application/json") {
    return JSON.parse(await file.text());
  }
  if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
    return draftFromText(await file.text(), file.name);
  }
  const imageBase64 = await fileToBase64(file);
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64, mediaType: file.type || "application/pdf" }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body && body.error ? body.error : "OCR APIを使えません");
  return body.draft;
}

function applyDraft(draft, sourceName = "資料") {
  const fields = traceFieldsFromDraft(draft);
  const mapCandidate = mapCandidateFromDraft(draft);
  state.documentDraft = draft;
  state.documentSourceName = sourceName;
  state.mapCandidate = mapCandidate;
  els.title.value = fields.title;
  els.start.value = fields.startAt;
  els.end.value = fields.endAt;
  els.time.value = fields.timeWindow;
  els.type.value = fields.restrictionType;
  const affected = affectedUsersFromDraft(draft);
  document.querySelectorAll('input[name="affected"]').forEach((input) => {
    input.checked = affected.includes(input.value);
  });
  state.manualLaneOverride = false;
  state.inferenceAccepted = false;
  state.coordinates = mapCandidate ? mapCandidate.coordinates : [];
  markTraceChanged();
  els.documentStatus.textContent = `${sourceName} から下書きを作りました。読み取り結果と地図候補を確認してください。`;
  els.status.textContent = mapCandidate
    ? "資料から候補区間を地図に表示しました。低信頼の項目だけ確認してください。"
    : "工事情報を読み取りました。区間候補がない場合は詳細補正から地図上で指定してください。";
  renderTrace();
  if (mapCandidate && map.loaded()) fitToTrace();
}

async function handleDocumentFiles(files) {
  const list = [...files];
  if (list.length === 0) return;
  els.documentStatus.textContent = "資料を読み取っています...";
  els.documentList.innerHTML = list.map((file) => `<li>${file.name}</li>`).join("");
  try {
    const draft = await draftFromFile(list[0]);
    applyDraft(draft, list[0].name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.documentStatus.textContent = message.includes("PDF") || message.includes("pdf")
      ? "PDFは現在の無料OCR箱抽出サービスへ直接送れません。ページを画像化して読み込むか、Claude OCR fallbackを使う構成で処理してください。"
      : "この公開版では画像/PDFのOCR APIに接続できません。テキスト資料かサンプルで導線を確認してください。";
    els.draftFields.open = true;
  }
}

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

function renderReadout() {
  if (!state.documentDraft) {
    els.readoutTitle.textContent = "未読取";
    els.readoutDates.textContent = "未読取";
    els.readoutTime.textContent = "未読取";
    els.readoutType.textContent = "未読取";
    els.readoutNote.textContent = "資料を入れると、周知に必要な項目を既存資料から拾います。";
    return;
  }
  const snapshot = currentDraftSnapshot();
  const dates = snapshot.startAt || snapshot.endAt
    ? `${snapshot.startAt || "未設定"} - ${snapshot.endAt || "未設定"}`
    : "未読取";
  els.readoutTitle.textContent = snapshot.title || "未読取";
  els.readoutDates.textContent = dates;
  els.readoutTime.textContent = snapshot.timeWindow || "未読取";
  els.readoutType.textContent = snapshot.restrictionType ? restrictionLabel(snapshot.restrictionType) : "未読取";
  els.readoutNote.textContent = state.documentSourceName
    ? `${state.documentSourceName} から拾った内容です。違う箇所だけ補正してください。`
    : "資料を入れると、周知に必要な項目を既存資料から拾います。";
}

function reviewItemText(item) {
  if (!item.value) return `${item.label}: 未読取`;
  return `${item.label}: ${item.value}（信頼度 ${percent(item.confidence)}）`;
}

function renderReviewItems() {
  els.reviewList.replaceChildren();
  if (!state.documentDraft) {
    const li = document.createElement("li");
    li.textContent = "資料を入れると、未読取または信頼度が低い項目だけ表示します。";
    els.reviewList.append(li);
    return;
  }
  const reviewItems = reviewItemsFromDraft(currentDraftSnapshot()).map((item) => {
    if (item.id === "mapCandidate" && state.inferenceAccepted) return { ...item, needsReview: false };
    return item;
  });
  const lowConfidenceItems = reviewItems.filter((item) => item.needsReview);
  if (lowConfidenceItems.length === 0) {
    const li = document.createElement("li");
    li.className = "review-ok";
    li.textContent = "確認が必要な低信頼項目はありません。";
    els.reviewList.append(li);
    return;
  }
  lowConfidenceItems.forEach((item) => {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    const text = document.createElement("span");
    label.textContent = item.id === "mapCandidate" ? "要確認" : "確認";
    text.textContent = reviewItemText(item);
    li.append(label, text);
    els.reviewList.append(li);
  });
}

function renderMapCandidate() {
  const hasLine = state.coordinates.length >= 2;
  els.mapCandidateCard.classList.toggle("is-confirmed", state.inferenceAccepted && hasLine);
  els.mapCandidateCard.classList.toggle("is-low-confidence", Boolean(state.mapCandidate && state.mapCandidate.needsReview && !state.inferenceAccepted));
  if (!state.documentDraft) {
    els.mapCandidateStatus.textContent = "未作成";
    els.mapCandidateTitle.textContent = "資料を入れると候補区間を表示します";
    els.mapCandidateDetail.textContent = "座標付き資料や保存済み候補がある場合は、区間線を地図に載せます。合っている場合は確認だけで進めます。";
    return;
  }
  if (!hasLine) {
    els.mapCandidateStatus.textContent = "候補なし";
    els.mapCandidateTitle.textContent = "地図候補はまだ作成されていません";
    els.mapCandidateDetail.textContent = "現状の画像OCRは工事項目の抽出までです。座標付き資料なら候補線を自動表示できますが、位置図の赤線を緯度経度へ転記する処理は次の実装対象です。";
    return;
  }
  const confidence = state.mapCandidate ? percent(state.mapCandidate.confidence) : "手動";
  els.mapCandidateStatus.textContent = state.inferenceAccepted ? "確認済み" : `信頼度 ${confidence}`;
  els.mapCandidateTitle.textContent = state.mapCandidate
    ? `${state.mapCandidate.source} から候補区間を作成`
    : "地図上で補正した区間を使用";
  els.mapCandidateDetail.textContent = `${state.coordinates.length}点 / ${formatDistance(totalMeters())}。公開データにはこの区間が住民向け地図・変更履歴・発注者報告へ共通反映されます。`;
}

function renderGeneratedOutputs() {
  const generatedCards = [els.generatedNotice, els.generatedHistory, els.generatedReport];
  generatedCards.forEach((card) => card.classList.toggle("is-generated", Boolean(state.savedId)));
}

function statusLabel(status) {
  const labels = {
    approved: "承認済み",
    blocked: "未読取あり",
    changed: "変更あり",
    draft: "下書き",
    needs_confirmation: "要確認",
    published: "公開済み",
  };
  return labels[status] || status || "未作成";
}

function shortDateTime(value) {
  if (!value) return "未公開";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function currentReviewItems() {
  if (!state.documentDraft) return [];
  return reviewItemsFromDraft(currentDraftSnapshot()).map((item) => {
    if (item.id === "mapCandidate" && state.inferenceAccepted) {
      return { ...item, needsReview: false, confidence: Math.max(item.confidence, 0.95) };
    }
    return item;
  });
}

function approvedFieldIds(reviewItems) {
  return reviewItems
    .filter((item) => !item.needsReview && item.value)
    .map((item) => item.id);
}

function explicitlyConfirmedFieldIds(reviewItems) {
  const ids = new Set(approvedFieldIds(reviewItems));
  if (state.inferenceAccepted) ids.add("mapCandidate");
  return [...ids];
}

function currentReportArtifacts() {
  const draft = currentDraftSnapshot();
  const reviewItems = currentReviewItems();
  const approvedFields = approvedFieldIds(reviewItems);
  const confirmedFields = state.savedId ? explicitlyConfirmedFieldIds(reviewItems) : [];
  const publicUrl = els.noticeLink.hidden ? null : els.noticeLink.href;
  const safetyReview = buildSafetyReview(draft, reviewItems, { approvedFields, confirmedFields });
  const validationRecord = buildValidationRecord(draft, reviewItems, { approvedFields, confirmedFields });
  const report = buildOwnerReport({
    draft,
    reviewItems,
    safetyReview,
    status: state.savedId ? "published" : safetyReview.status,
    publicUrl,
    confirmedBy: state.inferenceAccepted ? ["現場担当者 確認済み"] : [],
    sourceDocuments: state.documentSourceName ? [{ id: "source-1", name: state.documentSourceName, type: "document" }] : [],
    map: {
      coordinates: state.coordinates,
      laneSummary: currentLanePlan() ? laneSummary(currentLanePlan()) : "",
    },
    metrics: state.savedId ? { views: 128, uniqueViews: 86, inquiries: 6 } : { views: 0, uniqueViews: 0, inquiries: 0 },
    inquiryCategories: state.savedId ? { "通行可否": 3, "工期": 1, "迂回路": 1, "その他": 1 } : undefined,
    changeHistory: state.savedId
      ? [
          { changedAt: new Date().toISOString(), summary: "確認済み周知を公開", approvedBy: "現場担当者" },
          { changedAt: new Date().toISOString(), summary: "住民向けQR・A4・発注者報告を同時生成", approvedBy: "システム記録" },
        ]
      : [{ summary: "資料読取から下書きを作成", approvedBy: null }],
  });
  const pilotPackage = buildPilotPackage(report);
  return { report, safetyReview, validationRecord, pilotPackage };
}

function renderList(el, items, renderText) {
  el.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "未作成";
    el.append(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = renderText(item);
    el.append(li);
  });
}

function renderReportArtifacts() {
  const { report, safetyReview, validationRecord, pilotPackage } = currentReportArtifacts();
  els.reportStatus.textContent = statusLabel(report.status);
  els.reportPublishedAt.textContent = state.savedId ? shortDateTime(report.publishedAt) : "公開前";
  els.reportConfirmedBy.textContent = report.confirmedBy.length ? report.confirmedBy.join("、") : "確認待ち";
  els.reportViews.textContent = `${report.metrics.views}閲覧 / 問い合わせ${report.metrics.inquiries}件`;
  renderList(els.reportDeliverables, report.deliverables.filter((item) => item.included), (item) => item.label);
  renderList(els.reportHistory, report.changeHistory, (item) => {
    const at = item.changedAt ? shortDateTime(item.changedAt) : "下書き";
    const by = item.approvedBy ? ` / ${item.approvedBy}` : "";
    return `${at}: ${item.summary}${by}`;
  });
  els.reportInquiries.replaceChildren();
  report.inquiryCategories.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.category} ${item.count}`;
    els.reportInquiries.append(li);
  });

  els.safetySummary.className = `safety-summary ${safetyReview.status === "approved" ? "is-approved" : safetyReview.status === "blocked" ? "is-blocked" : ""}`;
  els.safetySummary.textContent = `AI/OCRは下書きのみ。承認済み ${safetyReview.summary.approvedCount}、要確認 ${safetyReview.summary.needsConfirmationCount}、未読取 ${safetyReview.summary.blockedCount}。`;
  els.safetyList.replaceChildren();
  safetyReview.items.slice(0, 5).forEach((item) => {
    const li = document.createElement("li");
    li.className = item.status === "needs_confirmation" ? "needs-confirmation" : item.status;
    const label = document.createElement("strong");
    const text = document.createElement("span");
    label.textContent = statusLabel(item.status);
    text.textContent = `${item.label}: ${item.value || "未読取"} / 信頼度 ${percent(item.confidence)}`;
    li.append(label, text);
    els.safetyList.append(li);
  });

  els.validationConfirmed.textContent = `${validationRecord.summary.confirmedCount}項目`;
  els.validationNeeds.textContent = `${validationRecord.summary.needsConfirmationCount}項目`;
  els.validationBlocked.textContent = `${validationRecord.summary.blockedCount}項目`;
  els.validationConfidence.textContent = percent(validationRecord.summary.averageConfidence);
  els.copyValidation.disabled = validationRecord.fields.length === 0;

  els.pilotName.textContent = pilotPackage.name;
  els.pilotPrice.textContent = pilotPackage.priceRange;
  renderList(els.pilotApproval, pilotPackage.humanApproval.remainsHumanApproved, (item) => item);
}

function renderDocumentPanels() {
  renderReadout();
  renderReviewItems();
  renderMapCandidate();
  renderGeneratedOutputs();
  renderReportArtifacts();
}

function selectedAffectedUsers() {
  return [...document.querySelectorAll('input[name="affected"]:checked')].map((input) => input.value);
}

function currentInference() {
  if (state.coordinates.length < 2) return null;
  return inferLanePlanInput({
    roadAxis: state.coordinates,
    restrictionType: els.type.value,
    affectedUsers: selectedAffectedUsers(),
  });
}

function tracePayload() {
  const lanePlan = currentLanePlan();
  const laneSpec = currentLaneSpec();
  return {
    title: els.title.value.trim() || "道路工事",
    coordinates: state.coordinates,
    restrictionType: els.type.value,
    affectedUsers: selectedAffectedUsers(),
    startAt: els.start.value || null,
    endAt: els.end.value || null,
    timeWindow: els.time.value.trim() || null,
    passability: "detour_required",
    laneSpec,
    lanePlan,
    laneSummary: lanePlan ? laneSummary(lanePlan) : null,
    autoInference: currentInference(),
    inferenceAccepted: state.inferenceAccepted,
    documentSourceName: state.documentSourceName || null,
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
      if (state.mapCandidate) state.mapCandidate = null;
      markTraceChanged();
      const lngLat = marker.getLngLat();
      state.coordinates[index] = [lngLat.lng, lngLat.lat];
      renderTrace({ keepMarkers: true });
    });
    marker.on("dragend", () => {
      if (state.mapCandidate) state.mapCandidate = null;
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
  const lanePlan = currentLanePlan();
  if (map.getSource("lane-polygons")) map.getSource("lane-polygons").setData(lanePlan ? lanePlan.lanePolygons : emptyFeatureCollection());
  if (map.getSource("closure-polygons")) map.getSource("closure-polygons").setData(lanePlan ? lanePlan.closurePolygons : emptyFeatureCollection());
  if (map.getSource("lane-centerlines")) map.getSource("lane-centerlines").setData(lanePlan ? lanePlan.laneCenterlines : emptyFeatureCollection());
  if (map.getSource("trace-line")) map.getSource("trace-line").setData(line);
  if (map.getSource("trace-points")) map.getSource("trace-points").setData(points);
  if (!options.keepMarkers) renderMarkers();

  els.pointCount.textContent = String(state.coordinates.length);
  els.distance.textContent = formatDistance(totalMeters());
  renderLanePicker(lanePlan);
  renderInference();
  renderProfileNote();
  els.coordinateList.innerHTML = state.coordinates.map(([lng, lat], index) =>
    `<li>${index + 1}: ${lng.toFixed(7)}, ${lat.toFixed(7)}</li>`).join("");
  const hasLine = state.coordinates.length >= 2;
  els.undo.disabled = state.coordinates.length === 0;
  els.clear.disabled = state.coordinates.length === 0;
  els.copy.disabled = !hasLine;
  els.save.disabled = !hasLine || selectedAffectedUsers().length === 0 || Boolean(state.savedId);
  els.acceptInference.disabled = !hasLine;
  els.adjustInference.disabled = !hasLine;
  els.rerunInference.disabled = !hasLine;
  if (!hasLine) els.noticeLink.hidden = true;
  renderDocumentPanels();
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function currentLanePlan() {
  if (state.coordinates.length < 2) return null;
  return buildLanePlan(currentLaneSpec());
}

function currentLaneSpec() {
  if (state.coordinates.length < 2) return null;
  if (!state.manualLaneOverride) return currentInference().lanePlanInput;
  return {
    roadAxis: state.coordinates,
    forwardLaneCount: Number(els.forwardLanes.value),
    oppositeLaneCount: Number(els.oppositeLanes.value),
    laneWidthMeters: Number(els.laneWidth.value),
    forwardLaneWidthMeters: Number(els.forwardLaneWidth.value),
    oppositeLaneWidthMeters: Number(els.oppositeLaneWidth.value),
    laneProfiles: currentLaneProfiles(),
    closedRanges: currentClosedRanges(),
    closedLaneIds: [],
    source: "manual_override",
  };
}

function widths(count, width) {
  return Array.from({ length: Math.max(0, count) }, () => width);
}

function lastLaneTaper(widthList) {
  if (widthList.length <= 1) return widthList;
  return widthList.map((width, index) => index === widthList.length - 1 ? 0 : width);
}

function currentLaneProfiles() {
  const mode = els.profileMode.value;
  const forwardCount = Number(els.forwardLanes.value);
  const oppositeCount = Number(els.oppositeLanes.value);
  const forwardWidth = Number(els.forwardLaneWidth.value || els.laneWidth.value);
  const oppositeWidth = Number(els.oppositeLaneWidth.value || els.laneWidth.value);
  const forwardWidths = widths(forwardCount, forwardWidth);
  const oppositeWidths = widths(oppositeCount, oppositeWidth);
  if (mode === "uniform" || mode === "asymmetric" || mode === "taper") return null;
  if (mode === "lane_drop") {
    return [
      { ratio: 0, forwardWidths, oppositeWidths },
      { ratio: 0.65, forwardWidths, oppositeWidths },
      { ratio: 0.85, forwardWidths: lastLaneTaper(forwardWidths), oppositeWidths },
      { ratio: 1, forwardWidths: forwardWidths.slice(0, Math.max(1, forwardWidths.length - 1)), oppositeWidths },
    ];
  }
  if (mode === "intersection") {
    return [
      { ratio: 0, forwardWidths, oppositeWidths },
      { ratio: 0.2, forwardWidths, oppositeWidths },
      { ratio: 0.55, forwardWidths: lastLaneTaper(forwardWidths), oppositeWidths: lastLaneTaper(oppositeWidths) },
      { ratio: 0.75, forwardWidths: forwardWidths.slice(0, Math.max(1, forwardWidths.length - 1)), oppositeWidths: oppositeWidths.slice(0, Math.max(1, oppositeWidths.length - 1)) },
      { ratio: 1, forwardWidths, oppositeWidths },
    ];
  }
  return null;
}

function currentClosedRanges() {
  const start = Math.max(0, Math.min(100, Number(els.closureStart.value) || 0)) / 100;
  const end = Math.max(0, Math.min(100, Number(els.closureEnd.value) || 100)) / 100;
  const startRatio = Math.min(start, end);
  const endRatio = Math.max(start, end);
  return state.closedLaneIds.map((laneId) => ({ laneId, startRatio, endRatio }));
}

function renderProfileNote() {
  const mode = els.profileMode.value;
  const notes = {
    uniform: "標準: 全区間を同じ車線構成で描画します。",
    asymmetric: "片側幅違い: 描画方向と反対方向で別々の車線幅を使います。",
    lane_drop: "車線減少: 終盤で描画方向の外側車線を0mへ絞り、消える車線をテーパー形状にします。",
    taper: "テーパー規制: 規制開始/終了の%で、赤い規制範囲だけを部分表示します。",
    intersection: "交差点付近: 中央付近で車線が絞られ、交差点後に元の車線構成へ戻る形状を作ります。",
  };
  els.profileNote.textContent = notes[mode] || notes.uniform;
}

function renderInference() {
  const inference = currentInference();
  if (!inference) {
    els.inferenceSummary.textContent = "候補区間がない場合や読み取り結果が怪しい場合だけ、地図上で補正します。";
    els.inferenceReason.textContent = "車線数・幅・テーパーは自動推定します。通常は合っているかの確認だけで進めます。";
    return;
  }
  const prefix = state.manualLaneOverride ? "手動補正中: " : state.inferenceAccepted ? "確認済み: " : "";
  els.inferenceSummary.textContent = prefix + inferenceSummary(inference);
  els.inferenceReason.textContent = state.manualLaneOverride
    ? "詳細補正が有効です。保存される地図は下の補正値を反映します。"
    : inference.reason;
}

function renderLanePicker(lanePlan) {
  if (!lanePlan) {
    els.lanePicker.innerHTML = "<p class=\"lane-empty\">施工区間を2点以上引くと、車線を選べます。</p>";
    return;
  }
  if (!state.manualLaneOverride) {
    els.lanePicker.innerHTML = "<p class=\"lane-empty\">自動推定で規制車線を生成しています。必要な場合だけ「少し直す」から補正します。</p>";
    return;
  }
  els.lanePicker.innerHTML = lanePlan.lanes.map((lane) => `
    <label>
      <input type="checkbox" name="closed-lane" value="${lane.id}" ${lane.status === "closed" ? "checked" : ""}>
      <span>${lane.label}</span>
    </label>`).join("");
  els.lanePicker.querySelectorAll('input[name="closed-lane"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.closedLaneIds = [...els.lanePicker.querySelectorAll('input[name="closed-lane"]:checked')].map((checked) => checked.value);
      markTraceChanged();
      renderTrace();
    });
  });
}

function markTraceChanged() {
  state.savedId = null;
  state.inferenceAccepted = false;
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
  map.addSource("lane-polygons", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer({
    id: "lane-polygons",
    type: "fill",
    source: "lane-polygons",
    paint: {
      "fill-color": "#2d7dd2",
      "fill-opacity": 0.14,
    },
  });
  map.addSource("closure-polygons", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer({
    id: "closure-polygons",
    type: "fill",
    source: "closure-polygons",
    paint: {
      "fill-color": "#c83a2c",
      "fill-opacity": 0.52,
    },
  });
  map.addSource("lane-centerlines", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer({
    id: "lane-centerlines",
    type: "line",
    source: "lane-centerlines",
    paint: {
      "line-color": ["match", ["get", "status"], "closed", "#8f1f18", "#1f5f98"],
      "line-width": ["match", ["get", "status"], "closed", 3, 1.5],
      "line-dasharray": [2, 1],
    },
  });
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
  if (state.mapCandidate) state.mapCandidate = null;
  state.coordinates.push([event.lngLat.lng, event.lngLat.lat]);
  markTraceChanged();
  els.status.textContent = state.coordinates.length < 2
    ? "終点をクリックしてください。"
    : "候補線を補正しました。赤い点はドラッグで微調整できます。";
  renderTrace();
});

els.drawToggle.onclick = () => {
  state.drawing = !state.drawing;
  els.drawToggle.textContent = state.drawing ? "補正を止める" : "地図上で区間を補正";
  els.status.textContent = state.drawing
    ? "地図上で施工区間の始点、曲がり角、終点をクリックしてください。"
    : "候補線は赤い点をドラッグして微調整できます。";
};

els.undo.onclick = () => {
  state.coordinates.pop();
  markTraceChanged();
  els.status.textContent = "最後の頂点を戻しました。";
  renderTrace();
};

els.clear.onclick = () => {
  state.coordinates = [];
  state.mapCandidate = null;
  state.savedId = null;
  state.manualLaneOverride = false;
  state.inferenceAccepted = false;
  els.status.textContent = "候補区間を削除しました。必要な場合だけ地図上で指定してください。";
  renderTrace();
};

els.acceptInference.onclick = () => {
  if (state.coordinates.length < 2) return;
  state.manualLaneOverride = false;
  state.inferenceAccepted = true;
  els.advancedLanes.open = false;
  els.status.textContent = "地図候補を確認済みにしました。公開してQR地図・履歴・報告を生成できます。";
  renderTrace();
};

els.adjustInference.onclick = () => {
  if (state.coordinates.length < 2) return;
  state.manualLaneOverride = true;
  state.inferenceAccepted = false;
  syncManualControlsFromInference();
  els.advancedWork.open = true;
  els.advancedLanes.open = true;
  els.status.textContent = "詳細補正を開きました。必要なところだけ直してください。";
  renderTrace();
};

els.rerunInference.onclick = () => {
  if (state.coordinates.length < 2) return;
  state.manualLaneOverride = false;
  state.inferenceAccepted = false;
  els.advancedLanes.open = false;
  els.status.textContent = "現在の候補線から規制形状を再推定しました。";
  renderTrace();
};

function syncManualControlsFromInference() {
  const inference = currentInference();
  if (!inference) return;
  const spec = inference.lanePlanInput;
  els.forwardLanes.value = String(spec.forwardLaneCount);
  els.oppositeLanes.value = String(spec.oppositeLaneCount);
  els.laneWidth.value = String(spec.laneWidthMeters);
  els.forwardLaneWidth.value = String(spec.forwardLaneWidthMeters || spec.laneWidthMeters);
  els.oppositeLaneWidth.value = String(spec.oppositeLaneWidthMeters || spec.laneWidthMeters);
  const firstRange = spec.closedRanges && spec.closedRanges[0];
  if (firstRange) {
    els.closureStart.value = String(Math.round(firstRange.startRatio * 100));
    els.closureEnd.value = String(Math.round(firstRange.endRatio * 100));
    state.closedLaneIds = [...new Set(spec.closedRanges.map((range) => range.laneId))];
  } else {
    els.closureStart.value = "0";
    els.closureEnd.value = "100";
    state.closedLaneIds = [];
  }
  els.profileMode.value = spec.laneProfiles ? "taper" : "uniform";
}

els.copy.onclick = async () => {
  try {
    await navigator.clipboard.writeText(traceGeoJson());
    els.status.textContent = "GeoJSONをコピーしました。";
  } catch (error) {
    els.status.textContent = "コピーできませんでした。ブラウザの権限またはHTTPS接続を確認してください。";
  }
};

els.copyValidation.onclick = async () => {
  try {
    const { validationRecord } = currentReportArtifacts();
    await navigator.clipboard.writeText(JSON.stringify(validationRecord, null, 2));
    els.status.textContent = "実書類10件検証用のレコードをコピーしました。";
  } catch (error) {
    els.status.textContent = "検証レコードをコピーできませんでした。";
  }
};

els.documentFiles.addEventListener("change", () => {
  handleDocumentFiles(els.documentFiles.files);
});

els.sampleDocument.onclick = () => {
  applyDraft(sampleDraft(), "サンプル資料");
  els.documentList.innerHTML = "<li>工事のお知らせサンプル</li><li>位置図サンプル</li><li>作業帯図サンプル</li>";
  els.status.textContent = "サンプル資料から読み取り結果と候補区間を作りました。低信頼の地図候補だけ確認してください。";
};

document.querySelectorAll('input[name="affected"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.manualLaneOverride = false;
    markTraceChanged();
    renderTrace();
  });
});

[els.title, els.start, els.end, els.time, els.type, els.forwardLanes, els.oppositeLanes, els.laneWidth, els.profileMode, els.forwardLaneWidth, els.oppositeLaneWidth, els.closureStart, els.closureEnd].forEach((input) => {
  const handleChange = () => {
    if (input === els.type) state.manualLaneOverride = false;
    if (input !== els.title && input !== els.start && input !== els.end && input !== els.time && input !== els.type) {
      state.manualLaneOverride = true;
      state.inferenceAccepted = false;
    }
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
    source: state.documentSourceName ? "document_intake" : "manual",
    documentSourceName: state.documentSourceName || null,
    verificationStatus: "submitted",
    updatedAt: new Date().toISOString(),
    laneSpec: payload.laneSpec,
    laneSummary: payload.laneSummary,
  };
  localStorage.setItem(`construction-notice:${id}`, JSON.stringify({ restriction }));
  return restriction;
}

function showNoticeLink(href, statusText) {
  els.noticeLink.href = href;
  els.noticeLink.hidden = false;
  els.status.textContent = statusText;
  fitToTrace();
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
  const draft = currentDraftSnapshot();
  const reviewItems = currentReviewItems();
  const publishReview = buildSafetyReview(draft, reviewItems, {
    approvedFields: approvedFieldIds(reviewItems),
    confirmedFields: explicitlyConfirmedFieldIds(reviewItems),
  });
  if (publishReview.summary.blockedCount > 0 || publishReview.summary.needsConfirmationCount > 0) {
    els.status.textContent = "未読取または要確認の項目があります。低信頼項目を確認してから公開してください。";
    els.draftFields.open = true;
    renderTrace();
    return;
  }
  els.save.disabled = true;
  els.status.textContent = "公開データを生成しています...";
  if (canUseLocalPreviewFallback()) {
    const restriction = saveLocalPreview(payload);
    state.savedId = restriction.id;
    showNoticeLink(
      restrictionToShareUrl("notice.html", restriction),
      "公開しました。住民向けQR地図・変更履歴・発注者報告を同じ内容で作成しました。",
    );
    renderTrace();
    return;
  }
  try {
    const res = await fetch("/api/restrictions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("save failed");
    const body = await res.json();
    state.savedId = body.id;
    showNoticeLink(
      `notice.html?id=${encodeURIComponent(body.id)}`,
      "公開しました。同じ施工区間がQR地図・変更履歴・発注者報告に反映されます。",
    );
  } catch (error) {
    els.status.textContent = "公開に失敗しました。候補線は消していないので、内容を確認して再試行してください。";
  } finally {
    renderTrace();
  }
};
