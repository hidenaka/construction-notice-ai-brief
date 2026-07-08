const METERS_PER_DEG_LAT = 111320;

function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
}

function axisOrigin(axis) {
  const lat = axis.reduce((sum, point) => sum + point[1], 0) / axis.length;
  return { lng: axis[0][0], lat, metersPerLng: metersPerDegLng(lat) };
}

function toMeters(point, origin) {
  return {
    x: (point[0] - origin.lng) * origin.metersPerLng,
    y: (point[1] - origin.lat) * METERS_PER_DEG_LAT,
  };
}

function toLngLat(point, origin) {
  return [
    origin.lng + point.x / origin.metersPerLng,
    origin.lat + point.y / METERS_PER_DEG_LAT,
  ];
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y);
  if (!len) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function vertexNormals(points) {
  return points.map((point, index) => {
    const prev = points[index - 1];
    const next = points[index + 1];
    const normals = [];
    if (prev) {
      const unit = normalize({ x: point.x - prev.x, y: point.y - prev.y });
      normals.push({ x: -unit.y, y: unit.x });
    }
    if (next) {
      const unit = normalize({ x: next.x - point.x, y: next.y - point.y });
      normals.push({ x: -unit.y, y: unit.x });
    }
    return normalize(normals.reduce((sum, n) => ({ x: sum.x + n.x, y: sum.y + n.y }), { x: 0, y: 0 }));
  });
}

function offsetLine(axis, offsetMeters) {
  const origin = axisOrigin(axis);
  const points = axis.map((point) => toMeters(point, origin));
  const normals = vertexNormals(points);
  return points.map((point, index) => toLngLat({
    x: point.x + normals[index].x * offsetMeters,
    y: point.y + normals[index].y * offsetMeters,
  }, origin));
}

function lanePolygon(axis, innerOffset, outerOffset) {
  const inner = offsetLine(axis, innerOffset);
  const outer = offsetLine(axis, outerOffset);
  return [...inner, ...outer.reverse(), inner[0]];
}

function laneLabel(direction, position) {
  return `${direction === "forward" ? "描画方向" : "反対方向"} 第${position}車線`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n)));
}

function axisPath(axis) {
  const origin = axisOrigin(axis);
  const points = axis.map((point) => toMeters(point, origin));
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { origin, points, cumulative, total: cumulative[cumulative.length - 1] };
}

function samplePath(path, ratio) {
  const distance = clamp(ratio, 0, 1) * path.total;
  let index = 1;
  while (index < path.cumulative.length - 1 && path.cumulative[index] < distance) index++;
  const prev = path.points[index - 1];
  const next = path.points[index];
  const segStart = path.cumulative[index - 1];
  const segLength = Math.max(0.0001, path.cumulative[index] - segStart);
  const t = (distance - segStart) / segLength;
  const tangent = normalize({ x: next.x - prev.x, y: next.y - prev.y });
  return {
    point: { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t },
    normal: { x: -tangent.y, y: tangent.x },
  };
}

function offsetAt(path, ratio, offsetMeters) {
  const sample = samplePath(path, ratio);
  return toLngLat({
    x: sample.point.x + sample.normal.x * offsetMeters,
    y: sample.point.y + sample.normal.y * offsetMeters,
  }, path.origin);
}

function laneOffsetsFromWidths(direction, widths) {
  const lanes = new Map();
  let cursor = 0;
  widths.forEach((rawWidth, index) => {
    const width = Math.max(0, Number(rawWidth) || 0);
    const position = index + 1;
    const id = `${direction}-${position}`;
    if (direction === "forward") {
      lanes.set(id, { innerOffsetMeters: cursor, outerOffsetMeters: cursor + width, widthMeters: width });
    } else {
      lanes.set(id, { innerOffsetMeters: -(cursor + width), outerOffsetMeters: -cursor, widthMeters: width });
    }
    cursor += width;
  });
  return lanes;
}

function widthsForCount(count, width) {
  return Array.from({ length: Math.max(0, count) }, () => width);
}

function normalizeProfiles(options, width, forward, opposite) {
  const forwardWidth = clamp(options.forwardLaneWidthMeters || width, 2.5, 4.5);
  const oppositeWidth = clamp(options.oppositeLaneWidthMeters || width, 2.5, 4.5);
  const rawProfiles = Array.isArray(options.laneProfiles) && options.laneProfiles.length
    ? options.laneProfiles
    : [
        { ratio: 0, forwardWidths: widthsForCount(forward, forwardWidth), oppositeWidths: widthsForCount(opposite, oppositeWidth) },
        { ratio: 1, forwardWidths: widthsForCount(forward, forwardWidth), oppositeWidths: widthsForCount(opposite, oppositeWidth) },
      ];
  const profiles = rawProfiles
    .map((profile) => {
      const forwardWidths = Array.isArray(profile.forwardWidths) ? profile.forwardWidths : widthsForCount(forward, forwardWidth);
      const oppositeWidths = Array.isArray(profile.oppositeWidths) ? profile.oppositeWidths : widthsForCount(opposite, oppositeWidth);
      return {
        ratio: clamp(profile.ratio, 0, 1),
        lanes: new Map([
          ...laneOffsetsFromWidths("forward", forwardWidths),
          ...laneOffsetsFromWidths("opposite", oppositeWidths),
        ]),
      };
    })
    .sort((a, b) => a.ratio - b.ratio);
  if (profiles[0].ratio !== 0) profiles.unshift({ ratio: 0, lanes: profiles[0].lanes });
  if (profiles[profiles.length - 1].ratio !== 1) profiles.push({ ratio: 1, lanes: profiles[profiles.length - 1].lanes });
  return profiles;
}

function laneAtRatio(profiles, laneId, ratio) {
  const exact = profiles.find((profile) => Math.abs(profile.ratio - ratio) < 0.000001 && profile.lanes.has(laneId));
  if (exact) return { ratio, ...exact.lanes.get(laneId) };
  const prev = [...profiles].reverse().find((profile) => profile.ratio <= ratio && profile.lanes.has(laneId));
  const next = profiles.find((profile) => profile.ratio >= ratio && profile.lanes.has(laneId));
  if (!prev || !next) return null;
  if (prev.ratio === next.ratio) return { ratio, ...prev.lanes.get(laneId) };
  const t = (ratio - prev.ratio) / (next.ratio - prev.ratio);
  const a = prev.lanes.get(laneId);
  const b = next.lanes.get(laneId);
  return {
    ratio,
    innerOffsetMeters: a.innerOffsetMeters + (b.innerOffsetMeters - a.innerOffsetMeters) * t,
    outerOffsetMeters: a.outerOffsetMeters + (b.outerOffsetMeters - a.outerOffsetMeters) * t,
    widthMeters: a.widthMeters + (b.widthMeters - a.widthMeters) * t,
  };
}

function laneSamples(profiles, laneId, range = { startRatio: 0, endRatio: 1 }) {
  const ratios = new Set([range.startRatio, range.endRatio]);
  profiles.forEach((profile) => {
    if (profile.ratio >= range.startRatio && profile.ratio <= range.endRatio && profile.lanes.has(laneId)) ratios.add(profile.ratio);
  });
  return [...ratios]
    .sort((a, b) => a - b)
    .map((ratio) => laneAtRatio(profiles, laneId, ratio))
    .filter(Boolean);
}

function lanePolygonFromSamples(path, samples) {
  const inner = samples.map((sample) => offsetAt(path, sample.ratio, sample.innerOffsetMeters));
  const outer = samples.map((sample) => offsetAt(path, sample.ratio, sample.outerOffsetMeters)).reverse();
  return [...inner, ...outer, inner[0]];
}

function laneLineFromSamples(path, samples) {
  return samples.map((sample) => offsetAt(path, sample.ratio, (sample.innerOffsetMeters + sample.outerOffsetMeters) / 2));
}

function normalizeClosedRanges(rawRanges, closedLaneIds) {
  const ranges = Array.isArray(rawRanges) ? rawRanges : [];
  return [
    ...closedLaneIds.map((laneId) => ({ laneId, startRatio: 0, endRatio: 1 })),
    ...ranges,
  ].map((range) => {
    const startRatio = clamp(range.startRatio ?? 0, 0, 1);
    const endRatio = clamp(range.endRatio ?? 1, 0, 1);
    return {
      laneId: range.laneId,
      startRatio: Math.min(startRatio, endRatio),
      endRatio: Math.max(startRatio, endRatio),
    };
  }).filter((range) => range.laneId && range.endRatio > range.startRatio);
}

function formatRatio(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

function buildLane(axis, direction, position, innerOffset, outerOffset, closedLaneIds) {
  const id = `${direction}-${position}`;
  return {
    id,
    direction,
    position,
    label: laneLabel(direction, position),
    status: closedLaneIds.includes(id) ? "closed" : "open",
    innerOffsetMeters: innerOffset,
    outerOffsetMeters: outerOffset,
    centerline: {
      type: "LineString",
      coordinates: offsetLine(axis, (innerOffset + outerOffset) / 2),
    },
    polygon: {
      type: "Polygon",
      coordinates: [lanePolygon(axis, innerOffset, outerOffset)],
    },
  };
}

function buildLaneFromProfiles(path, profiles, laneId, closedRanges) {
  const parts = laneId.split("-");
  const direction = parts[0];
  const position = Number(parts[1]);
  const samples = laneSamples(profiles, laneId);
  if (samples.length < 2) return null;
  const stationRange = { startRatio: samples[0].ratio, endRatio: samples[samples.length - 1].ratio };
  const laneClosedRanges = closedRanges.filter((range) => range.laneId === laneId)
    .map((range) => ({
      laneId,
      startRatio: Math.max(range.startRatio, stationRange.startRatio),
      endRatio: Math.min(range.endRatio, stationRange.endRatio),
    }))
    .filter((range) => range.endRatio > range.startRatio);
  return {
    id: laneId,
    direction,
    position,
    label: laneLabel(direction, position),
    status: laneClosedRanges.length ? "closed" : "open",
    stationRange,
    widthProfileMeters: samples.map((sample) => Number(sample.widthMeters.toFixed(2))),
    centerline: {
      type: "LineString",
      coordinates: laneLineFromSamples(path, samples),
    },
    polygon: {
      type: "Polygon",
      coordinates: [lanePolygonFromSamples(path, samples)],
    },
    closedRanges: laneClosedRanges,
  };
}

function buildClosureFeatures(path, profiles, lanes) {
  return lanes.flatMap((lane) => lane.closedRanges.map((range) => {
    const samples = laneSamples(profiles, lane.id, range);
    if (samples.length < 2) return null;
    return {
      type: "Feature",
      properties: {
        id: lane.id,
        label: lane.label,
        direction: lane.direction,
        position: lane.position,
        status: "closed",
        startRatio: range.startRatio,
        endRatio: range.endRatio,
      },
      geometry: {
        type: "Polygon",
        coordinates: [lanePolygonFromSamples(path, samples)],
      },
    };
  }).filter(Boolean));
}

export function buildLanePlan(options) {
  const { roadAxis, closedLaneIds = [] } = options;
  if (!Array.isArray(roadAxis) || roadAxis.length < 2) throw new Error("road axis must have at least two points");
  const width = clamp(options.laneWidthMeters || 3.25, 2.5, 4.5);
  const forward = Math.max(0, Math.min(4, Number(options.forwardLaneCount) || 0));
  const opposite = Math.max(0, Math.min(4, Number(options.oppositeLaneCount) || 0));
  const path = axisPath(roadAxis);
  const profiles = normalizeProfiles(options, width, forward, opposite);
  const profileMode = Array.isArray(options.laneProfiles) && options.laneProfiles.length ? "stationed" : "uniform";
  const laneIds = [...new Set(profiles.flatMap((profile) => [...profile.lanes.keys()]))]
    .sort((a, b) => {
      const [ad, ap] = a.split("-");
      const [bd, bp] = b.split("-");
      if (ad !== bd) return ad === "forward" ? -1 : 1;
      return Number(ap) - Number(bp);
    });
  const closedRanges = normalizeClosedRanges(options.closedRanges, closedLaneIds);
  const lanes = laneIds.map((laneId) => buildLaneFromProfiles(path, profiles, laneId, closedRanges)).filter(Boolean);
  const closureFeatures = buildClosureFeatures(path, profiles, lanes);

  return {
    roadAxis,
    profileMode,
    laneWidthMeters: width,
    forwardLaneCount: forward,
    oppositeLaneCount: opposite,
    closedLaneIds: [...new Set(lanes.filter((lane) => lane.status === "closed").map((lane) => lane.id))],
    closedRanges: closedRanges.filter((range) => lanes.some((lane) => lane.id === range.laneId)),
    lanes,
    lanePolygons: {
      type: "FeatureCollection",
      features: lanes.map((lane) => ({
        type: "Feature",
        properties: {
          id: lane.id,
          label: lane.label,
          direction: lane.direction,
          position: lane.position,
          status: lane.status,
        },
        geometry: lane.polygon,
      })),
    },
    closurePolygons: {
      type: "FeatureCollection",
      features: closureFeatures,
    },
    laneCenterlines: {
      type: "FeatureCollection",
      features: lanes.map((lane) => ({
        type: "Feature",
        properties: {
          id: lane.id,
          label: lane.label,
          status: lane.status,
        },
        geometry: lane.centerline,
      })),
    },
  };
}

export function laneSummary(plan) {
  const closed = plan.lanes.filter((lane) => lane.status === "closed").map((lane) => {
    if (!lane.closedRanges || lane.closedRanges.length === 0) return lane.label;
    const ranges = lane.closedRanges
      .filter((range) => range.startRatio > lane.stationRange.startRatio || range.endRatio < lane.stationRange.endRatio)
      .map((range) => `${formatRatio(range.startRatio)}-${formatRatio(range.endRatio)}`)
      .join("、");
    if (!ranges) return lane.label;
    return `${lane.label}（${ranges}）`;
  });
  if (closed.length === 0) return "車線規制なし";
  return `${closed.join("、")}を規制`;
}
