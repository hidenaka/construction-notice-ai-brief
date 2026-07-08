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
  };
}
