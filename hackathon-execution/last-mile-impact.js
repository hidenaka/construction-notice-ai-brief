const EARTH_RADIUS_METERS = 6371000;
const RAD = Math.PI / 180;
const SOURCE_LABEL = "ODPT/GTFS last-mile impact assessment (徒歩アクセス影響の推定。運行変更ではありません)";
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isLngLat(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function normalizePoint(value) {
  if (!isLngLat(value)) return null;
  return [Number(value[0]), Number(value[1])];
}

function normalizeCoordinates(value) {
  return asArray(value).map(normalizePoint).filter(Boolean);
}

function normalizeLineString(value) {
  const input = value && value.type === "Feature" ? value.geometry : value;
  const coordinates = input && input.type === "LineString" ? input.coordinates : input;
  const line = normalizeCoordinates(coordinates);
  return line.length >= 2 ? line : [];
}

function threshold(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toXY(point, lat0) {
  return [
    point[0] * RAD * EARTH_RADIUS_METERS * Math.cos(lat0 * RAD),
    point[1] * RAD * EARTH_RADIUS_METERS,
  ];
}

function distancePointToSegmentMeters(point, a, b) {
  const lat0 = (a[1] + b[1]) / 2;
  const p = toXY(point, lat0);
  const start = toXY(a, lat0);
  const end = toXY(b, lat0);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len2 = dx * dx + dy * dy;
  const rawT = len2 === 0 ? 0 : ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / len2;
  const t = Math.max(0, Math.min(1, rawT));
  return Math.hypot(p[0] - (start[0] + t * dx), p[1] - (start[1] + t * dy));
}

function orientation(p, q, r) {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(p, q, r) {
  return (
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    q[0] >= Math.min(p[0], r[0]) - 1e-9 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-9
  );
}

function segmentsIntersectXY(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function segmentsIntersect(a1, a2, b1, b2) {
  const lat0 = (a1[1] + a2[1] + b1[1] + b2[1]) / 4;
  return segmentsIntersectXY(toXY(a1, lat0), toXY(a2, lat0), toXY(b1, lat0), toXY(b2, lat0));
}

function distanceSegmentToSegmentMeters(a1, a2, b1, b2) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distancePointToSegmentMeters(a1, b1, b2),
    distancePointToSegmentMeters(a2, b1, b2),
    distancePointToSegmentMeters(b1, a1, a2),
    distancePointToSegmentMeters(b2, a1, a2),
  );
}

function pointDistanceToLineMeters(point, line) {
  if (!point || line.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    min = Math.min(min, distancePointToSegmentMeters(point, line[i], line[i + 1]));
  }
  return min;
}

function lineDistanceToLineMeters(line, constructionLine) {
  if (line.length < 2 || constructionLine.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < constructionLine.length - 1; j++) {
      const distance = distanceSegmentToSegmentMeters(line[i], line[i + 1], constructionLine[j], constructionLine[j + 1]);
      if (distance === 0) return 0;
      min = Math.min(min, distance);
    }
  }
  return min;
}

function lineIntersectsLine(line, constructionLine) {
  if (line.length < 2 || constructionLine.length < 2) return false;
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < constructionLine.length - 1; j++) {
      if (segmentsIntersect(line[i], line[i + 1], constructionLine[j], constructionLine[j + 1])) return true;
    }
  }
  return false;
}

function roundMeters(value) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0;
  return Math.round(value * 10) / 10;
}

function severityFor(relation, distanceMeters) {
  if (relation === "nearby_stop") {
    if (distanceMeters <= 50) return "high";
    if (distanceMeters <= 200) return "medium";
    return "low";
  }
  if (relation === "crosses" || distanceMeters <= 5) return "high";
  if (distanceMeters <= 20) return "medium";
  return "low";
}

function normalizeStop(stop, constructionLine) {
  const point = normalizePoint(stop.coordinates);
  if (!point) return null;
  return {
    id: stop.id,
    name: stop.name,
    mode: stop.mode,
    source: stop.source,
    coordinates: point,
    routeIds: asArray(stop.routeIds),
    distanceMeters: roundMeters(pointDistanceToLineMeters(point, constructionLine)),
  };
}

function stopInfo(stop) {
  if (!stop) return null;
  return {
    id: stop.id,
    name: stop.name,
    mode: stop.mode,
    source: stop.source,
    coordinates: stop.coordinates,
    routeIds: stop.routeIds,
  };
}

function buildNearbyStops(stops, constructionLine, stopThresholdMeters) {
  if (constructionLine.length < 2) return [];
  return asArray(stops)
    .map((stop) => normalizeStop(safeObject(stop), constructionLine))
    .filter((stop) => stop && stop.distanceMeters !== null && stop.distanceMeters <= stopThresholdMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function buildAffectedAccessRoutes(accessRoutes, constructionLine, stopsById, routeThresholdMeters) {
  if (constructionLine.length < 2) return [];
  return asArray(accessRoutes)
    .map((route) => {
      const sourceRoute = safeObject(route);
      const coordinates = normalizeLineString(sourceRoute.coordinates);
      if (coordinates.length < 2) return null;
      const isNearestPointLink = sourceRoute.sourceKind === "nearest_point_link" &&
        Number.isFinite(Number(sourceRoute.distanceToConstructionMeters));
      const crosses = !isNearestPointLink && lineIntersectsLine(coordinates, constructionLine);
      const rawDistance = isNearestPointLink
        ? Number(sourceRoute.distanceToConstructionMeters)
        : crosses ? 0 : lineDistanceToLineMeters(coordinates, constructionLine);
      const distanceMeters = roundMeters(rawDistance);
      const relation = isNearestPointLink
        ? "nearby_stop"
        : crosses ? "crosses" : distanceMeters !== null && distanceMeters <= routeThresholdMeters ? "nearby" : null;
      if (!relation) return null;
      const severity = severityFor(relation, distanceMeters);
      return {
        id: sourceRoute.id,
        stopId: sourceRoute.stopId,
        destinationName: sourceRoute.destinationName,
        label: sourceRoute.label,
        coordinates,
        relation,
        distanceMeters,
        sourceKind: sourceRoute.sourceKind,
        distanceToConstructionMeters: sourceRoute.distanceToConstructionMeters,
        severity,
        stop: stopInfo(stopsById.get(sourceRoute.stopId)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severityDiff) return severityDiff;
      const distanceDiff = a.distanceMeters - b.distanceMeters;
      if (distanceDiff) return distanceDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
}

function buildSummary(nearbyStops, affectedAccessRoutes) {
  const highSeverityCount = affectedAccessRoutes.filter((route) => route.severity === "high").length;
  const mediumSeverityCount = affectedAccessRoutes.filter((route) => route.severity === "medium").length;
  const lowSeverityCount = affectedAccessRoutes.filter((route) => route.severity === "low").length;
  const sentence = `ODPT/GTFSの駅・停留所から目的地までの確認では、近接する停留所${nearbyStops.length}件、影響候補の徒歩アクセス経路${affectedAccessRoutes.length}件があります。これは運行変更ではなく徒歩アクセス影響の推定です。`;
  return {
    nearbyStopCount: nearbyStops.length,
    affectedAccessRouteCount: affectedAccessRoutes.length,
    highSeverityCount,
    mediumSeverityCount,
    lowSeverityCount,
    sentence,
  };
}

function buildGeojson(nearbyStops, affectedAccessRoutes) {
  return {
    type: "FeatureCollection",
    features: [
      ...nearbyStops.map((stop) => ({
        type: "Feature",
        properties: {
          kind: "stop",
          id: stop.id,
          name: stop.name,
          mode: stop.mode,
          source: stop.source,
          distanceMeters: stop.distanceMeters,
        },
        geometry: { type: "Point", coordinates: stop.coordinates },
      })),
      ...affectedAccessRoutes.map((route) => ({
        type: "Feature",
        properties: {
          kind: "access_route",
          id: route.id,
          stopId: route.stopId,
          destinationName: route.destinationName,
          label: route.label,
          relation: route.relation,
          severity: route.severity,
          distanceMeters: route.distanceMeters,
          sourceKind: route.sourceKind,
          distanceToConstructionMeters: route.distanceToConstructionMeters,
        },
        geometry: { type: "LineString", coordinates: route.coordinates },
      })),
    ],
  };
}

export function assessLastMileImpact(options = {}) {
  const source = safeObject(options);
  const constructionLine = normalizeLineString(source.construction);
  const stopThresholdMeters = threshold(source.stopThresholdMeters, 300);
  const routeThresholdMeters = threshold(source.routeThresholdMeters, 20);
  const nearbyStops = buildNearbyStops(source.stops, constructionLine, stopThresholdMeters);
  const normalizedStops = asArray(source.stops)
    .map((stop) => normalizeStop(safeObject(stop), constructionLine))
    .filter(Boolean);
  const stopsById = new Map(normalizedStops.map((stop) => [stop.id, stop]));
  const affectedAccessRoutes = buildAffectedAccessRoutes(
    source.accessRoutes,
    constructionLine,
    stopsById,
    routeThresholdMeters,
  );

  return {
    sourceLabel: SOURCE_LABEL,
    nearbyStops,
    affectedAccessRoutes,
    summary: buildSummary(nearbyStops, affectedAccessRoutes),
    geojson: buildGeojson(nearbyStops, affectedAccessRoutes),
  };
}
