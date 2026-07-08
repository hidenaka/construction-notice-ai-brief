export const GTFS_DATA_REPOSITORY_FEED = {
  organizationId: "kunitachicity",
  organizationName: "国立市",
  feedId: "kunikko",
  feedName: "国立市コミュニティバス「くにっこ」",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/deed.ja",
  repositoryUrl: "https://gtfs-data.jp/",
  stopsUrl: "https://api.gtfs-data.jp/v2/organizations/kunitachicity/feeds/kunikko/files/stops.geojson?rid=current",
  bundledStopsUrl: "./data/gtfs-kunitachicity-kunikko-stops.geojson",
};

const EARTH_RADIUS_METERS = 6371000;
const RAD = Math.PI / 180;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function normalizeLineString(value) {
  const input = value && value.type === "Feature" ? value.geometry : value;
  const coordinates = input && input.type === "LineString" ? input.coordinates : input;
  const line = asArray(coordinates).map(normalizePoint).filter(Boolean);
  return line.length >= 2 ? line : [];
}

function feedPath(feed) {
  return `${feed.organizationId}/${feed.feedId}`;
}

function stopIdFor(feed, stopId) {
  return `gtfs:${feed.organizationId}:${feed.feedId}:${stopId}`;
}

export function normalizeGtfsStopsGeojson(geojson, feed = GTFS_DATA_REPOSITORY_FEED) {
  const source = safeObject(geojson);
  return asArray(source.features)
    .map((feature) => {
      const item = safeObject(feature);
      const properties = safeObject(item.properties);
      const geometry = safeObject(item.geometry);
      const coordinates = normalizePoint(geometry.coordinates);
      const rawStopId = properties.stop_id || properties.stopId || properties.id;
      const name = properties.stop_name || properties.stopName || properties.name;
      if (!coordinates || !rawStopId || !name) return null;
      return {
        id: stopIdFor(feed, rawStopId),
        name,
        mode: "bus",
        source: "GTFSデータリポジトリ",
        coordinates,
        routeIds: [feedPath(feed)],
        feedName: feed.feedName,
        license: feed.license,
        licenseUrl: feed.licenseUrl,
      };
    })
    .filter(Boolean);
}

function toXY(point, lat0) {
  return [
    point[0] * RAD * EARTH_RADIUS_METERS * Math.cos(lat0 * RAD),
    point[1] * RAD * EARTH_RADIUS_METERS,
  ];
}

function fromXY(point, lat0) {
  return [
    point[0] / (RAD * EARTH_RADIUS_METERS * Math.cos(lat0 * RAD)),
    point[1] / (RAD * EARTH_RADIUS_METERS),
  ];
}

function nearestPointOnSegment(point, a, b) {
  const lat0 = (point[1] + a[1] + b[1]) / 3;
  const p = toXY(point, lat0);
  const start = toXY(a, lat0);
  const end = toXY(b, lat0);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len2 = dx * dx + dy * dy;
  const rawT = len2 === 0 ? 0 : ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / len2;
  const t = Math.max(0, Math.min(1, rawT));
  const nearest = [start[0] + t * dx, start[1] + t * dy];
  return {
    coordinates: fromXY(nearest, lat0),
    distanceMeters: Math.hypot(p[0] - nearest[0], p[1] - nearest[1]),
  };
}

function nearestPointOnLine(point, line) {
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const candidate = nearestPointOnSegment(point, line[i], line[i + 1]);
    if (!best || candidate.distanceMeters < best.distanceMeters) best = candidate;
  }
  return best;
}

function roundMeters(value) {
  return Math.round(value * 10) / 10;
}

export function buildGtfsLastMileInputs(options = {}) {
  const feed = options.feed || GTFS_DATA_REPOSITORY_FEED;
  const constructionLine = normalizeLineString(options.construction);
  const maxDistanceMeters = Number.isFinite(Number(options.maxDistanceMeters)) ? Number(options.maxDistanceMeters) : 450;
  const maxAccessRoutes = Number.isFinite(Number(options.maxAccessRoutes)) ? Number(options.maxAccessRoutes) : 8;
  const stops = normalizeGtfsStopsGeojson(options.stopsGeojson, feed);
  const accessRoutes = constructionLine.length < 2
    ? []
    : stops
      .map((stop) => {
        const nearest = nearestPointOnLine(stop.coordinates, constructionLine);
        if (!nearest || nearest.distanceMeters > maxDistanceMeters) return null;
        return {
          id: `gtfs-access:${stop.id}`,
          stopId: stop.id,
          destinationName: "工事区間最寄り点",
          label: `${stop.name}から工事区間最寄り点`,
          coordinates: [stop.coordinates, nearest.coordinates],
          sourceKind: "nearest_point_link",
          distanceToConstructionMeters: roundMeters(nearest.distanceMeters),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distanceToConstructionMeters - b.distanceToConstructionMeters)
      .slice(0, maxAccessRoutes);

  return {
    sourceLabel: `GTFSデータリポジトリ ${feed.feedName} (${feed.license})`,
    feed,
    stops,
    accessRoutes,
  };
}

export async function fetchGtfsStopsGeojson(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const url = options.url || (options.feed && options.feed.stopsUrl) || GTFS_DATA_REPOSITORY_FEED.bundledStopsUrl;
  const response = await fetchImpl(url, { headers: { accept: "application/geo+json, application/json" } });
  if (!response.ok) throw new Error(`GTFS stops fetch failed: ${response.status}`);
  return response.json();
}
