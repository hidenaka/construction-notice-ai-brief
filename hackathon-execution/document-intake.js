const RESTRICTION_KEYWORDS = [
  ["片側交互", "alternating_one_way"],
  ["通行止", "road_closed"],
  ["車線規制", "lane_closure"],
  ["車線", "lane_closure"],
  ["歩道狭小", "sidewalk_narrowed"],
  ["歩道通行止", "sidewalk_closed"],
  ["歩道", "sidewalk_closed"],
  ["自転車", "bicycle_lane_closed"],
  ["右折", "turn_restriction"],
  ["左折", "turn_restriction"],
];
const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

function cleanLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstDateRange(text) {
  const dates = [...String(text).matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g)]
    .map((m) => `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`);
  return { startAt: dates[0] || null, endAt: dates[1] || dates[0] || null };
}

function firstTimeWindow(text) {
  const match = String(text).match(/([0-2]?\d)[:：時]([0-5]\d)?\s*[-〜~－から]+\s*([0-2]?\d)[:：時]([0-5]\d)?/);
  if (!match) return null;
  const start = `${String(Number(match[1])).padStart(2, "0")}:${match[2] || "00"}`;
  const end = `${String(Number(match[3])).padStart(2, "0")}:${match[4] || "00"}`;
  return `${start}-${end}`;
}

function restrictionTypeFromText(text) {
  const found = RESTRICTION_KEYWORDS.find(([keyword]) => String(text).includes(keyword));
  return found ? found[1] : "lane_closure";
}

export function draftFromText(text, filename = "document") {
  const lines = cleanLines(text);
  const { startAt, endAt } = firstDateRange(text);
  return {
    title: lines[0] || filename.replace(/\.[^.]+$/, "") || "道路工事",
    startAt,
    endAt,
    timeWindow: firstTimeWindow(text),
    restrictionType: restrictionTypeFromText(text),
    notes: lines.slice(1, 5).join(" / "),
  };
}

export function traceFieldsFromDraft(draft) {
  return {
    title: draft.title || "道路工事",
    startAt: draft.startAt || "",
    endAt: draft.endAt || "",
    timeWindow: draft.timeWindow || "",
    restrictionType: draft.restrictionType || "lane_closure",
  };
}

function normalizedCoordinatePair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lng = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function normalizedCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  return coordinates.map(normalizedCoordinatePair).filter(Boolean);
}

function confidenceValue(raw, fallback) {
  const confidence = Number(raw);
  if (!Number.isFinite(confidence)) return fallback;
  return Math.max(0, Math.min(1, confidence));
}

function evidenceConfidence(draft, key) {
  const evidence = draft && draft.evidence && draft.evidence[key];
  return evidence ? evidence.confidence : undefined;
}

function fieldConfidence(draft, key, hasValue) {
  if (!hasValue) return 0;
  return confidenceValue(
    draft && draft.confidence && draft.confidence[key] !== undefined
      ? draft.confidence[key]
      : evidenceConfidence(draft, key),
    0.86,
  );
}

function isRequiredConfirmation(draft, key) {
  const required = draft && Array.isArray(draft.requiresConfirmation) ? draft.requiresConfirmation : [];
  if (key === "dates") return required.includes("startAt") || required.includes("endAt");
  return required.includes(key);
}

export function mapCandidateFromDraft(draft) {
  const source = draft && (draft.mapCandidate || draft.routeCandidate || draft);
  const coordinates = normalizedCoordinates(source && (source.coordinates || source.roadAxis));
  if (coordinates.length < 2) return null;
  const confidence = confidenceValue(source.confidence, 0.75);
  return {
    source: source.source || "位置図・作業帯図",
    confidence,
    coordinates,
    needsReview: confidence < REVIEW_CONFIDENCE_THRESHOLD,
  };
}

export function reviewItemsFromDraft(draft) {
  const sourceDraft = draft || {};
  const fields = traceFieldsFromDraft(sourceDraft);
  const mapCandidate = mapCandidateFromDraft(draft || {});
  const hasTitle = Boolean(sourceDraft.title);
  const hasDates = Boolean(sourceDraft.startAt && sourceDraft.endAt);
  const hasTimeWindow = Boolean(sourceDraft.timeWindow);
  const hasRestrictionType = Boolean(sourceDraft.restrictionType);
  const items = [
    {
      id: "title",
      label: "工事名",
      value: hasTitle ? fields.title : "",
      confidence: fieldConfidence(draft, "title", hasTitle),
    },
    {
      id: "dates",
      label: "工期",
      value: hasDates ? `${fields.startAt} - ${fields.endAt}` : "",
      confidence: Math.min(
        fieldConfidence(draft, "dates", hasDates),
        fieldConfidence(draft, "startAt", Boolean(sourceDraft.startAt)),
        fieldConfidence(draft, "endAt", Boolean(sourceDraft.endAt)),
      ),
    },
    {
      id: "timeWindow",
      label: "時間帯",
      value: hasTimeWindow ? fields.timeWindow : "",
      confidence: fieldConfidence(draft, "timeWindow", hasTimeWindow),
    },
    {
      id: "restrictionType",
      label: "規制種別",
      value: hasRestrictionType ? fields.restrictionType : "",
      confidence: fieldConfidence(draft, "restrictionType", hasRestrictionType),
    },
    {
      id: "mapCandidate",
      label: "地図候補",
      value: mapCandidate ? `${mapCandidate.source} / ${mapCandidate.coordinates.length}点` : "",
      confidence: mapCandidate ? mapCandidate.confidence : 0,
    },
  ];
  return items.map((item) => ({
    ...item,
    needsReview: !item.value || item.confidence < REVIEW_CONFIDENCE_THRESHOLD || isRequiredConfirmation(draft, item.id),
  }));
}

export function affectedUsersFromDraft(draft) {
  const type = draft && draft.restrictionType;
  if (type === "sidewalk_closed" || type === "sidewalk_narrowed") return ["pedestrian", "wheelchair", "stroller"];
  if (type === "road_closed") return ["car", "delivery", "bicycle", "pedestrian"];
  if (type === "bicycle_lane_closed") return ["bicycle", "car"];
  return ["car", "delivery", "bicycle"];
}

export function sampleDraft() {
  return {
    title: "○○通り 水道工事のお知らせ",
    startAt: "2026-07-10",
    endAt: "2026-08-20",
    timeWindow: "09:00-17:00",
    restrictionType: "lane_closure",
    notes: "車線規制。工事区間は添付位置図の赤線部分。",
    confidence: { title: 0.94, dates: 0.91, timeWindow: 0.9, restrictionType: 0.87 },
    sourceDocuments: [
      { id: "notice-sample", name: "工事のお知らせサンプル", type: "notice" },
      { id: "map-sample", name: "位置図サンプル", type: "map" },
      { id: "work-zone-sample", name: "作業帯図サンプル", type: "traffic_control_plan" },
    ],
    mapCandidate: {
      source: "添付位置図の赤線",
      confidence: 0.72,
      sourceDocumentId: "map-sample",
      coordinates: [
        [139.76585, 35.68105],
        [139.76715, 35.68147],
        [139.76835, 35.68176],
      ],
    },
  };
}
