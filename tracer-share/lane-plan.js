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

export function buildLanePlan({ roadAxis, forwardLaneCount, oppositeLaneCount, laneWidthMeters, closedLaneIds = [] }) {
  if (!Array.isArray(roadAxis) || roadAxis.length < 2) throw new Error("road axis must have at least two points");
  const width = Math.max(2.5, Math.min(4.5, Number(laneWidthMeters) || 3.25));
  const forward = Math.max(0, Math.min(4, Number(forwardLaneCount) || 0));
  const opposite = Math.max(0, Math.min(4, Number(oppositeLaneCount) || 0));
  const lanes = [];

  for (let position = 1; position <= forward; position++) {
    lanes.push(buildLane(roadAxis, "forward", position, (position - 1) * width, position * width, closedLaneIds));
  }
  for (let position = 1; position <= opposite; position++) {
    lanes.push(buildLane(roadAxis, "opposite", position, -position * width, -(position - 1) * width, closedLaneIds));
  }

  return {
    roadAxis,
    laneWidthMeters: width,
    forwardLaneCount: forward,
    oppositeLaneCount: opposite,
    closedLaneIds: lanes.filter((lane) => lane.status === "closed").map((lane) => lane.id),
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
  const closed = plan.lanes.filter((lane) => lane.status === "closed").map((lane) => lane.label);
  if (closed.length === 0) return "車線規制なし";
  return `${closed.join("、")}を規制`;
}
