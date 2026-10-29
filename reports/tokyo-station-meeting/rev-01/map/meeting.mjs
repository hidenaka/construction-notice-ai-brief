// URL data only. No network, storage, geolocation, or DOM interpretation.
const FLOORS = new Set(['1F', 'B1', 'B2', 'unknown']);
const PAID = new Set(['inside', 'outside', 'unknown']);
export const FLOOR_NAMES = { '1F': '地上1階', B1: '地下1階', B2: '地下2階', unknown: '階は未確認' };
export const PAID_NAMES = { inside: '改札の中', outside: '改札の外', unknown: '改札の内外は未確認' };
export function validateMeeting(value) {
  if (!value || Array.isArray(value) || value.v !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > 300 || !FLOORS.has(value.floor) || !PAID.has(value.paid) || typeof value.note !== 'string') return null;
  if (value.landmarkId != null && (typeof value.landmarkId !== 'string' || value.landmarkId.length > 300)) return null;
  return { v: 1, id: value.id, floor: value.floor, paid: value.paid, note: [...value.note].slice(0, 160).join(''), landmarkId: value.landmarkId || '' };
}
export function readMeeting(hash) {
  if (typeof hash !== 'string' || hash.length > 16000) return null;
  try {
    const raw = new URLSearchParams(hash.replace(/^#/, '')).get('meet');
    return raw && raw.length <= 3000 ? validateMeeting(JSON.parse(raw)) : null;
  } catch { return null; }
}
export function writeMeeting(hash, value) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const valid = validateMeeting(value);
  if (valid) params.set('meet', JSON.stringify(valid)); else params.delete('meet');
  return '#' + params.toString();
}
export function nearbyLandmarks(origin, points, limit = 5) {
  const seen = new Set();
  return points.filter(p => {
    if (!p || !p.name || p.id === origin.id || seen.has(p.id) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    seen.add(p.id);
    return origin.floor === 'unknown' || !p.floor || p.floor === 'unknown' || p.floor === origin.floor;
  }).map(p => ({ ...p, distance: Math.hypot(p.x - origin.x, p.y - origin.y), sameFloor: origin.floor !== 'unknown' && p.floor === origin.floor }))
    .filter(p => p.distance <= 300).sort((a, b) => Number(b.sameFloor) - Number(a.sameFloor) || a.distance - b.distance).slice(0, limit);
}
export function meetingText(value, place) {
  return ['待ち合わせ：' + place.name, FLOOR_NAMES[value.floor], PAID_NAMES[value.paid] + '（利用者の指定）', value.note ? '目印メモ（利用者の入力）：' + value.note : ''].filter(Boolean).join('\n');
}
export async function deliverShare(api, payload) {
  if (api.share) {
    try { await api.share(payload); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  if (api.copy) { try { await api.copy(payload.url); return 'copied'; } catch {} }
  return 'manual';
}
