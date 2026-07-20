// 3D analysis instruments: the STEREOLOGY panel (2D section metallography vs
// the true 3D grain sizes — the classic Saltykov lesson, and the OptiGrain
// tie-in) and the IPF TEXTURE panel (stereographic projection of every grain's
// crystal axis, sized by volume). Zero extra GPU work for IPF: it reads the
// CPU quaternion mirror + the last stats census.

import type { Sim3D, StatsResult3D } from "./sim3d";
import type { SlicePlane } from "./render3d";
import { DOMAIN_MM } from "./sim";

export interface An3Host {
  sim3d(): Sim3D | null;
  plane(): SlicePlane | null;
  lastStats(): StatsResult3D | null;
}

const UM_PER_VOX = (DOMAIN_MM * 1000) / 1024;

// CPU ports of the shader palette helpers (grain hue parity with ORIENT)
function qrotV(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
function qrotZ(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * 1 - z * 0), ty = 2 * (z * 0 - x * 1), tz = 2 * (x * 0 - y * 0);
  return [0 + w * tx + (y * tz - z * ty), 0 + w * ty + (z * tx - x * tz), 1 + w * tz + (x * ty - y * tx)];
}
function polarCol(h: number, idh: number): string {
  const cs = [[0.93, 0.68, 0.20], [0.16, 0.42, 0.72], [0.74, 0.28, 0.55], [0.24, 0.63, 0.60]];
  const t = ((h + idh * 0.13) % 1 + 1) % 1;
  const ss = (a: number, b: number, x: number) => {
    const v = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return v * v * (3 - 2 * v);
  };
  let c = cs[0].map((v, i) => v + (cs[1][i] - v) * ss(0, 0.33, t));
  c = c.map((v, i) => v + (cs[2][i] - v) * ss(0.33, 0.66, t));
  c = c.map((v, i) => v + (cs[3][i] - v) * ss(0.66, 0.92, t));
  c = c.map((v, i) => v + (cs[0][i] - v) * ss(0.92, 1, t));
  return `rgb(${c.map(v => Math.round(Math.min(1, v) * 255)).join(",")})`;
}
function hashf(x: number, y: number, z: number): number {
  let v = (Math.imul(x, 747796405) + Math.imul(y, 2891336453) + Math.imul(z, 3546859427) + 2654435769) >>> 0;
  v ^= v >>> 16; v = Math.imul(v, 2246822519) >>> 0; v ^= v >>> 13;
  v = Math.imul(v, 3266489917) >>> 0; v ^= v >>> 16;
  return v / 4294967295;
}

export class Analyze3D {
  stereoOn = false;
  ipfOn = false;
  probeOn = false;
  scheilOn = false;
  poleOn = false;
  private stereoPanel: HTMLElement;
  private ipfPanel: HTMLElement;
  private probePanel: HTMLElement;
  private scheilPanel: HTMLElement;
  private polePanel: HTMLElement;
  private stereoBody: HTMLElement;
  private ipfCv: HTMLCanvasElement;
  private probeCv: HTMLCanvasElement;
  private scheilCv: HTMLCanvasElement;
  private poleCv: HTMLCanvasElement;
  private big: HTMLElement | null = null;
  private bigCv: HTMLCanvasElement | null = null;
  private stereoClock = 0;
  private lastStereo: { sections: { id: number; areaVox: number }[]; poreVox: number } | null = null;
  private curve: { t: number; T: number; phi: number }[] = [];
  private scheil: { fs: number; Ti: number }[] = [];

  constructor(private host: An3Host) {
    const root = document.getElementById("apanels3")!;
    const mk = (title: string, onBig: (() => void) | null) => {
      const p = document.createElement("div");
      p.className = "apanel";
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = title;
      if (onBig) {
        t.style.display = "flex";
        const z = document.createElement("button");
        z.className = "zoomBtn";
        z.textContent = "⤢";
        z.title = "enlarge";
        z.style.cssText = "margin-left:auto;border:none;background:none;color:#6b7280;cursor:pointer;padding:0 2px;font-size:11px";
        z.addEventListener("click", onBig);
        t.append(z);
      }
      p.append(t);
      root.append(p);
      return p;
    };
    this.probePanel = mk("COOLING CURVE · PROBE (3D)", null);
    this.probeCv = document.createElement("canvas");
    this.probeCv.width = 236; this.probeCv.height = 128;
    this.probePanel.append(this.probeCv);
    this.scheilPanel = mk("SCHEIL fs–T · PREDICTED vs MEASURED", null);
    this.scheilCv = document.createElement("canvas");
    this.scheilCv.width = 236; this.scheilCv.height = 128;
    this.scheilPanel.append(this.scheilCv);
    this.stereoPanel = mk("STEREOLOGY · SECTION vs TRUE 3D", null);
    this.stereoBody = document.createElement("div");
    this.stereoBody.style.cssText = "font-size:10.5px;line-height:1.55;color:#9aa1ab;width:236px";
    this.stereoPanel.append(this.stereoBody);
    this.ipfPanel = mk("TEXTURE · IPF (grain axes)", () => this.openBig());
    this.ipfCv = document.createElement("canvas");
    this.ipfCv.width = 236; this.ipfCv.height = 190;
    this.ipfPanel.append(this.ipfCv);
    this.polePanel = mk("TEXTURE · POLE FIGURE ⟨100⟩", null);
    this.poleCv = document.createElement("canvas");
    this.poleCv.width = 236; this.poleCv.height = 190;
    this.polePanel.append(this.poleCv);
  }

  setStereoOn(b: boolean) { this.stereoOn = b; this.stereoPanel.style.display = b ? "block" : "none"; }
  setIpfOn(b: boolean) { this.ipfOn = b; this.ipfPanel.style.display = b ? "block" : "none"; }
  setProbeOn(b: boolean) {
    this.probeOn = b;
    this.probePanel.style.display = b ? "block" : "none";
    if (b) {
      // give the probe a home if it never had one
      const s3 = this.host.sim3d();
      if (s3 && !s3.probe) s3.probe = { x: s3.n / 2, y: s3.n / 2, z: s3.n / 2 };
    }
    this.curve = [];
  }
  setScheilOn(b: boolean) { this.scheilOn = b; this.scheilPanel.style.display = b ? "block" : "none"; if (b) this.scheil = []; }
  setPoleOn(b: boolean) { this.poleOn = b; this.polePanel.style.display = b ? "block" : "none"; }
  /** melt reset / probe move: start fresh series */
  reset() { this.curve = []; this.scheil = []; this.lastStereo = null; }

  /** stats arrived (~4 Hz) — collect the instrument series */
  onStats3(s: StatsResult3D, simTime: number) {
    if (this.probeOn && s.probeT != null && s.probePhi != null) {
      this.curve.push({ t: simTime, T: s.probeT, phi: s.probePhi });
      if (this.curve.length > 900) this.curve = this.curve.filter((_, i) => i % 2 === 0);
    }
    if (this.scheilOn && s.fracSolid > 0.005 && s.fracSolid < 0.995 && s.interfaceT > 0)
      this.scheil.push({ fs: s.fracSolid, Ti: s.interfaceT });
  }

  private openBig() {
    if (this.big) return;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(4,5,7,0.62);backdrop-filter:blur(4px)";
    const card = document.createElement("div");
    card.style.cssText = "background:#111318;border:1px solid #262b33;border-radius:8px;padding:12px 14px";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;margin-bottom:6px;color:#ffb454;font-size:11px;letter-spacing:0.2em";
    head.textContent = "TEXTURE · IPF (grain axes)";
    const x = document.createElement("button");
    x.textContent = "✕";
    x.style.cssText = "margin-left:auto;border:none;background:none;color:#6b7280;cursor:pointer";
    x.addEventListener("click", () => this.closeBig());
    head.append(x);
    this.bigCv = document.createElement("canvas");
    this.bigCv.width = 640; this.bigCv.height = 560;
    card.append(head, this.bigCv);
    wrap.append(card);
    wrap.addEventListener("click", e => { if (e.target === wrap) this.closeBig(); });
    document.getElementById("app")!.append(wrap);
    this.big = wrap;
    this.drawIPF();
  }

  private closeBig() {
    this.big?.remove();
    this.big = null;
    this.bigCv = null;
  }

  /** called from the 3D stats cadence (~4 Hz) */
  tick(dt: number) {
    if (this.ipfOn) this.drawIPF();
    if (this.poleOn) this.drawPole();
    if (this.probeOn) this.drawProbe();
    if (this.scheilOn) this.drawScheil();
    if (!this.stereoOn) return;
    this.stereoClock += dt;
    if (this.stereoClock < 1) { this.drawStereo(); return; }
    this.stereoClock = 0;
    const s3 = this.host.sim3d();
    const pl = this.host.plane();
    if (!s3 || !pl) return;
    void s3.readStereo(pl).then(r => { if (r) { this.lastStereo = r; this.drawStereo(); } });
  }

  private drawStereo() {
    const st = this.host.lastStats();
    const sec = this.lastStereo;
    if (!sec) { this.stereoBody.innerHTML = "<i>measuring the section…</i>"; return; }
    const n2 = sec.sections.length;
    const meanA = n2 ? sec.sections.reduce((a, s) => a + s.areaVox, 0) / n2 : 0;
    const d2 = meanA > 0 ? Math.sqrt((4 * meanA) / Math.PI) * UM_PER_VOX : 0;
    const meanAmm = meanA * (UM_PER_VOX / 1000) ** 2;
    const g2 = n2 >= 3 && meanAmm > 0 ? 3.322 * Math.log10(1 / meanAmm) - 2.954 : null;
    const d3 = st?.eqDiamUm ?? 0;
    const ratio = d3 > 0 && d2 > 0 ? d2 / d3 : null;
    this.stereoBody.innerHTML =
      `on this section: <b style="color:#e8ebef">${n2}</b> grains · d̄₂ <b style="color:#ffb454">${d2.toFixed(0)} µm</b>` +
      (g2 != null ? ` · ASTM G ${g2.toFixed(1)}` : "") + "<br>" +
      `true 3D census: <b style="color:#e8ebef">${st?.grainCount ?? "—"}</b> grains · d̄₃ <b style="color:#56d4dd">${d3 ? d3.toFixed(0) + " µm" : "—"}</b><br>` +
      (ratio != null
        ? `section / true = <b style="color:#e8ebef">${ratio.toFixed(2)}</b> — a plane cuts most grains off-centre, so 2D metallography under-measures (≈ π/4 for spheres)`
        : "grow some grains, then compare") +
      (sec.poreVox > 0 ? `<br>pores cut by this section: <b style="color:#e06c60">${sec.poreVox}</b> vox` : "");
  }

  /** T(t) at the probe voxel — liquidus reference + cyan arrest marker (2D port) */
  private drawProbe() {
    const ctx = this.probeCv.getContext("2d")!;
    const w = this.probeCv.width, h = this.probeCv.height;
    ctx.clearRect(0, 0, w, h);
    const d = this.curve;
    const p = this.host.sim3d()?.params;
    ctx.font = "9px ui-monospace, Consolas, monospace";
    if (!d.length || !p) {
      ctx.fillStyle = "#6b7280";
      ctx.fillText("waiting for the probe… (ctrl-tap moves it)", 8, h / 2);
      return;
    }
    const TL = p.alloyOn === 1 ? 1 - p.mLiq * p.c0 : 1;
    const t0 = d[0].t, t1 = Math.max(d[d.length - 1].t, t0 + 1e-6);
    let lo = Math.min(TL, ...d.map(q => q.T)), hi = Math.max(TL, ...d.map(q => q.T));
    const pad = Math.max(0.05, (hi - lo) * 0.1);
    lo -= pad; hi += pad;
    const X = (t: number) => 6 + ((t - t0) / (t1 - t0)) * (w - 12);
    const Y = (T: number) => h - 6 - ((T - lo) / (hi - lo)) * (h - 12);
    ctx.strokeStyle = "rgba(107,114,128,0.55)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(6, Y(TL)); ctx.lineTo(w - 6, Y(TL)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("T liquidus", 8, Y(TL) - 3);
    const si = d.findIndex(q => q.phi > 0.5);
    if (si >= 0) {
      ctx.strokeStyle = "rgba(86,212,221,0.8)";
      ctx.beginPath(); ctx.moveTo(X(d[si].t), 6); ctx.lineTo(X(d[si].t), h - 6); ctx.stroke();
      ctx.fillStyle = "#56d4dd";
      ctx.fillText("solid", Math.min(X(d[si].t) + 3, w - 30), 14);
    }
    ctx.strokeStyle = "#ffb454";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    d.forEach((q, i) => { if (i === 0) ctx.moveTo(X(q.t), Y(q.T)); else ctx.lineTo(X(q.t), Y(q.T)); });
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /** analytic Scheil path vs measured (fs, T_interface) — needs alloy (2D port) */
  private drawScheil() {
    const ctx = this.scheilCv.getContext("2d")!;
    const w = this.scheilCv.width, h = this.scheilCv.height;
    ctx.clearRect(0, 0, w, h);
    const p = this.host.sim3d()?.params;
    ctx.font = "9px ui-monospace, Consolas, monospace";
    if (!p || p.alloyOn !== 1) {
      ctx.fillStyle = "#6b7280";
      ctx.fillText("enable ALLOY — Scheil needs a solute field", 8, h / 2);
      return;
    }
    const T = (fs: number) => 1 - p.mLiq * p.c0 * Math.pow(Math.max(1 - fs, 1e-3), p.kPart - 1);
    let lo = T(0.98), hi = T(0);
    for (const q of this.scheil) { lo = Math.min(lo, q.Ti); hi = Math.max(hi, q.Ti); }
    const pad = Math.max(0.03, (hi - lo) * 0.1);
    lo -= pad; hi += pad;
    const X = (fs: number) => 6 + fs * (w - 12);
    const Y = (t: number) => h - 6 - ((t - lo) / (hi - lo)) * (h - 12);
    ctx.strokeStyle = "#ffb454";
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const fs = (i / 120) * 0.98;
      if (i === 0) ctx.moveTo(X(fs), Y(T(fs))); else ctx.lineTo(X(fs), Y(T(fs)));
    }
    ctx.stroke();
    ctx.fillStyle = "#56d4dd";
    for (const q of this.scheil) ctx.fillRect(X(q.fs) - 1, Y(q.Ti) - 1, 2, 2);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("fs 0→1 · amber Scheil · cyan measured T_interface", 8, h - 10);
  }

  /** stereographic ⟨100⟩ pole figure (c-axis for hex, 5-fold axes for icosa) */
  private drawPole() {
    const cv = this.poleCv;
    const ctx = cv.getContext("2d")!;
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44;
    ctx.strokeStyle = "rgba(107,114,128,0.5)";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    const s3 = this.host.sim3d();
    const st = this.host.lastStats();
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px ui-monospace, Consolas, monospace";
    if (!s3 || !st) return;
    const mode = s3.params.aniMode3;
    const phi = 0.85065081, sg = 0.52573111;
    const AXES: [number, number, number][] =
      mode === 2 ? [[0, 0, 1]] :
      mode === 3 ? [[0, sg, phi], [0, -sg, phi], [sg, phi, 0], [-sg, phi, 0], [phi, 0, sg], [phi, 0, -sg]] :
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    ctx.fillText(mode === 2 ? "(0001) poles" : mode === 3 ? "5-fold poles" : "⟨100⟩ poles", 8, 12);
    const q = s3.quats;
    for (const g of st.grains) {
      const b = g.id * 4;
      const qq: [number, number, number, number] = [q[b], q[b + 1], q[b + 2], q[b + 3]];
      const hue = (() => {
        let [ax, ay, az] = qrotZ(qq);
        if (az < 0) { ax = -ax; ay = -ay; az = -az; }
        return ((Math.atan2(ay, ax) / (2 * Math.PI)) + az * 0.31) % 1;
      })();
      const r = Math.min(6, Math.max(1.2, Math.cbrt(g.vox) * 0.14));
      ctx.fillStyle = polarCol(hue, hashf(g.id, 5, 31) * 0.6);
      ctx.globalAlpha = 0.8;
      for (const a of AXES) {
        let [px, py, pz] = qrotV(qq, a);
        if (pz < 0) { px = -px; py = -py; pz = -pz; }
        const X = px / (1 + pz), Y = py / (1 + pz);
        ctx.beginPath();
        ctx.arc(cx + X * R, cy - Y * R, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawIPF() {
    const targets: [HTMLCanvasElement, number][] = [[this.ipfCv, 1]];
    if (this.bigCv) targets.push([this.bigCv, 2.6]);
    const s3 = this.host.sim3d();
    const st = this.host.lastStats();
    for (const [cv, scale] of targets) {
      const ctx = cv.getContext("2d")!;
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44;
      ctx.strokeStyle = "rgba(107,114,128,0.5)";
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.font = `${9 * scale}px ui-monospace, Consolas, monospace`;
      ctx.fillText("z ⊙", cx + 3, cy - 4);
      if (!s3 || !st) continue;
      const q = s3.quats;
      for (const g of st.grains) {
        const b = g.id * 4;
        let [ax, ay, az] = qrotZ([q[b], q[b + 1], q[b + 2], q[b + 3]]);
        if (az < 0) { ax = -ax; ay = -ay; az = -az; }   // upper hemisphere
        const X = ax / (1 + az), Y = ay / (1 + az);
        const hue = ((Math.atan2(ay, ax) / (2 * Math.PI)) + az * 0.31) % 1;
        const r = Math.min(14 * scale, Math.max(1.6, Math.cbrt(g.vox) * 0.28 * scale));
        ctx.fillStyle = polarCol(hue, hashf(g.id, 5, 31) * 0.6);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx + X * R, cy - Y * R, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
