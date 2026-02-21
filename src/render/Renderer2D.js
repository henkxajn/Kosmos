import { AU } from "../sim/WorldGen.js";
import { lerpVec3 } from "./math.js";
import { buildOrbitPoints } from "./orbits.js";

const TYPE_PRIORITY = { star: 0, planet: 1, moon: 2 };

export class Renderer2D {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.camera = camera;

    this.auPixels = 280;
    this.orbitCache = new Map();

    this.pickRadiusPx = 10;
    this._lastScreenBodies = null;
    this.onPick = null;

    this._stars = this._makeStars(160);
    this._selectedId = null;

    this._installPick();
  }

  setSelectedId(id) { this._selectedId = id || null; }

  pxPerMeter() { return (this.auPixels / AU) * this.camera.zoom; }

  _makeStars(n) {
    const stars = [];
    let s = 1337;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) stars.push({ x: rand(), y: rand(), r: 0.6 + rand() * 1.2, a: 0.06 + rand() * 0.10 });
    return stars;
  }

  setSnapshot(snapshot) { this.setOrbitCacheFromSnapshot(snapshot); }

  setOrbitCacheFromSnapshot(snapshot) {
    for (const b of snapshot.bodies) {
      if (!b.orbit) continue;
      if (!this.orbitCache.has(b.id)) this.orbitCache.set(b.id, buildOrbitPoints(b.orbit, 260));
    }
  }

  interpolateSnapshots(a, b, t) {
    const mapA = new Map(a.bodies.map(x => [x.id, x]));
    const bodies = [];
    for (const bb of b.bodies) {
      const aa = mapA.get(bb.id);
      if (!aa) { bodies.push(bb); continue; }
      bodies.push({ ...bb, position: lerpVec3(aa.position, bb.position, t), orbit: bb.orbit || aa.orbit });
    }
    return { seed: b.seed, timeSeconds: a.timeSeconds + (b.timeSeconds - a.timeSeconds) * t, paused: b.paused, timeScale: b.timeScale, bodies };
  }

  _installPick() {
    this.canvas.addEventListener("click", (e) => {
      if (!this._lastScreenBodies) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const mx = e.clientX * dpr;
      const my = e.clientY * dpr;

      const candidates = [];
      for (const sb of this._lastScreenBodies) {
        const dx = mx - sb.sx, dy = my - sb.sy;
        const d2 = dx*dx + dy*dy;
        const r = Math.max(sb.rPx, this.pickRadiusPx * dpr);
        if (d2 <= r*r) candidates.push({ ...sb, d2 });
      }
      if (!candidates.length) return;

      candidates.sort((a, b) => {
        const pa = TYPE_PRIORITY[a.type] ?? 99;
        const pb = TYPE_PRIORITY[b.type] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.d2 - b.d2;
      });

      const best = candidates[0].id;
      if (best && this.onPick) this.onPick(best);
    });
  }

  render(snapshot) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    this._drawBackground(ctx, w, h);

    const byId = new Map(snapshot.bodies.map(b => [b.id, b]));

    if (this.camera.followId) {
      const fb = byId.get(this.camera.followId);
      if (fb) {
        const ppm = this.pxPerMeter();
        this.camera.setOffsetToCenterWorld({ x: fb.position.x * ppm, y: fb.position.y * ppm });
      }
    }

    this._drawOrbits(ctx, snapshot, byId);
    this._drawBodies(ctx, snapshot);
    this._drawCenterMark(ctx, w, h);
  }

  _drawBackground(ctx, w, h) {
    const g = ctx.createRadialGradient(w*0.5, h*0.45, Math.min(w,h)*0.05, w*0.5, h*0.5, Math.max(w,h)*0.75);
    g.addColorStop(0, "rgba(40, 54, 110, 0.55)");
    g.addColorStop(1, "rgba(8, 12, 24, 1.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (const s of this._stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = "rgba(235, 240, 255, 1)";
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  _worldToScreenXY(xMeters, yMeters) {
    const ppm = this.pxPerMeter();
    return { x: xMeters * ppm + this.camera.offsetX, y: yMeters * ppm + this.camera.offsetY };
  }

  _drawOrbits(ctx, snapshot, byId) {
    ctx.save();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.lineWidth = Math.max(1, 1.15 * dpr);
    ctx.strokeStyle = "rgba(220, 226, 255, 0.16)";

    const zoom = this.camera.zoom;

    for (const b of snapshot.bodies) {
      if (!b.orbit) continue;
      const parent = byId.get(b.orbit.parentId);
      if (!parent) continue;

      if (b.type === "moon" && zoom < 0.35 && b.id !== this._selectedId) continue;

      const localPts = this.orbitCache.get(b.id);
      if (!localPts || localPts.length < 2) continue;

      ctx.beginPath();
      for (let i = 0; i < localPts.length; i++) {
        const x = parent.position.x + localPts[i].x;
        const y = parent.position.y + localPts[i].y;
        const scr = this._worldToScreenXY(x, y);
        if (i === 0) ctx.moveTo(scr.x, scr.y); else ctx.lineTo(scr.x, scr.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBodies(ctx, snapshot) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const zoom = this.camera.zoom;

    const bodies = snapshot.bodies.slice().sort((a, b) => (a.type === "star") - (b.type === "star"));
    this._lastScreenBodies = [];

    for (const b of bodies) {
      const scr = this._worldToScreenXY(b.position.x, b.position.y);

      const radiusAU = b.radius / AU;
      let rPx = Math.max(3.2 * dpr, Math.sqrt(Math.max(1e-12, radiusAU)) * 90 * zoom * dpr);
      if (b.type === "star") rPx = Math.max(12 * dpr, 34 * zoom * dpr);

      const fill = b.type === "star"
        ? "rgba(255, 236, 200, 0.92)"
        : (b.type === "planet" ? "rgba(190, 226, 255, 0.85)" : "rgba(223, 205, 255, 0.85)");

      const grad = this.ctx.createRadialGradient(scr.x - rPx*0.35, scr.y - rPx*0.35, rPx*0.2, scr.x, scr.y, rPx*1.2);
      grad.addColorStop(0, "rgba(255,255,255,0.55)");
      grad.addColorStop(0.2, fill);
      grad.addColorStop(1, "rgba(20, 26, 52, 0.35)");

      this.ctx.save();
      this.ctx.shadowColor = b.type === "star" ? "rgba(255, 238, 210, 0.65)" : "rgba(200, 220, 255, 0.35)";
      this.ctx.shadowBlur = b.type === "star" ? 26 * dpr : 16 * dpr;

      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.arc(scr.x, scr.y, rPx, 0, Math.PI*2);
      this.ctx.fill();

      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = "rgba(255,255,255,0.12)";
      this.ctx.lineWidth = 1 * dpr;
      this.ctx.stroke();

      if (b.id === this._selectedId) {
        this.ctx.strokeStyle = "rgba(255,255,255,0.35)";
        this.ctx.lineWidth = 2 * dpr;
        this.ctx.beginPath();
        this.ctx.arc(scr.x, scr.y, rPx + 4*dpr, 0, Math.PI*2);
        this.ctx.stroke();
      }

      this.ctx.restore();

      const isFollow = this.camera.followId === b.id;
      const showMoonLabel = (zoom >= 0.55) || (b.id === this._selectedId) || isFollow;
      const showLabel =
        (b.type === "star") ||
        (b.type === "planet") ||
        (b.type === "moon" && showMoonLabel);

      if (showLabel) {
        this.ctx.save();
        this.ctx.fillStyle = "rgba(240, 243, 255, 0.92)";
        this.ctx.font = `${12 * dpr}px system-ui`;
        this.ctx.fillText(b.name, scr.x + rPx + 6*dpr, scr.y - rPx - 6*dpr);
        this.ctx.restore();
      }

      this._lastScreenBodies.push({ id: b.id, type: b.type, sx: scr.x, sy: scr.y, rPx });
    }
  }

  _drawCenterMark(ctx, w, h) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx - 10*dpr, cy); ctx.lineTo(cx + 10*dpr, cy);
    ctx.moveTo(cx, cy - 10*dpr); ctx.lineTo(cx, cy + 10*dpr);
    ctx.stroke();
    ctx.restore();
  }
}
