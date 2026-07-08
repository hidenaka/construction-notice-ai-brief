const DEFAULT_LANE_WIDTH = 3.25;

const VEHICLE_USERS = new Set(["car", "delivery", "bus", "bicycle"]);

function includesVehicleUsers(affectedUsers = []) {
  return affectedUsers.some((user) => VEHICLE_USERS.has(user));
}

function baseInput(roadAxis, forwardLaneCount = 1, oppositeLaneCount = 1) {
  return {
    roadAxis,
    forwardLaneCount,
    oppositeLaneCount,
    laneWidthMeters: DEFAULT_LANE_WIDTH,
    forwardLaneWidthMeters: DEFAULT_LANE_WIDTH,
    oppositeLaneWidthMeters: DEFAULT_LANE_WIDTH,
    laneProfiles: null,
    closedRanges: [],
    closedLaneIds: [],
  };
}

function taperedLaneClosure(roadAxis) {
  return {
    ...baseInput(roadAxis, 1, 1),
    laneProfiles: [
      { ratio: 0, forwardWidths: [3.25], oppositeWidths: [3.25] },
      { ratio: 0.08, forwardWidths: [3.25], oppositeWidths: [3.25] },
      { ratio: 0.18, forwardWidths: [2.2], oppositeWidths: [3.25] },
      { ratio: 0.82, forwardWidths: [2.2], oppositeWidths: [3.25] },
      { ratio: 0.92, forwardWidths: [3.25], oppositeWidths: [3.25] },
      { ratio: 1, forwardWidths: [3.25], oppositeWidths: [3.25] },
    ],
    closedRanges: [{ laneId: "forward-1", startRatio: 0.08, endRatio: 0.92 }],
  };
}

function roadClosed(roadAxis) {
  return {
    ...baseInput(roadAxis, 1, 1),
    closedRanges: [
      { laneId: "forward-1", startRatio: 0, endRatio: 1 },
      { laneId: "opposite-1", startRatio: 0, endRatio: 1 },
    ],
  };
}

function alternatingOneWay(roadAxis) {
  return {
    ...baseInput(roadAxis, 1, 1),
    closedRanges: [{ laneId: "forward-1", startRatio: 0, endRatio: 1 }],
  };
}

function noRoadLaneGeometry(roadAxis) {
  return baseInput(roadAxis, 0, 0);
}

export function inferLanePlanInput({ roadAxis, restrictionType, affectedUsers = [] }) {
  let lanePlanInput;
  let label;
  let reason;

  if (restrictionType === "road_closed") {
    lanePlanInput = roadClosed(roadAxis);
    label = "全面通行止め";
    reason = "規制種別が通行止めなので、両方向の通行帯を全区間規制として推定しました。";
  } else if (restrictionType === "alternating_one_way") {
    lanePlanInput = alternatingOneWay(roadAxis);
    label = "片側交互通行";
    reason = "規制種別が片側交互通行なので、片側1車線を全区間規制として推定しました。";
  } else if (restrictionType === "lane_closure" || includesVehicleUsers(affectedUsers)) {
    lanePlanInput = taperedLaneClosure(roadAxis);
    label = "車線規制";
    reason = "車両への影響があるため、始端と終端にテーパーを持つ1車線規制として推定しました。";
  } else {
    lanePlanInput = noRoadLaneGeometry(roadAxis);
    label = "歩行者向け規制";
    reason = "車両への影響がないため、車線ポリゴンは作らず歩行者向けの周知地図として扱います。";
  }

  return {
    source: "auto",
    needsWorkerGeometryDecision: false,
    label,
    reason,
    lanePlanInput,
  };
}

export function inferenceSummary(inference) {
  return `自動推定: ${inference.label}。${inference.reason}`;
}
