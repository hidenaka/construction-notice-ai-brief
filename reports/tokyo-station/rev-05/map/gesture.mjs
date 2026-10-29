// A tap is one pointer that has never travelled beyond the threshold.
export class TapGuard {
  constructor() { this.points = new Map(); this.blocked = false; }
  down(id, x, y, { pick = true } = {}) {
    if (!this.points.size) this.blocked = false;
    this.points.set(id, { x, y, pick });
    if (this.points.size > 1) this.blocked = true;
  }
  move(id, x, y) {
    const p = this.points.get(id);
    if (p && Math.hypot(x - p.x, y - p.y) > 6) this.blocked = true;
  }
  up(id, x, y) {
    const p = this.points.get(id);
    this.move(id, x, y);
    const tap = !!p && p.pick && !this.blocked;
    this.points.delete(id);
    return tap;
  }
  cancel(id) { this.blocked = true; this.points.delete(id); }
}
