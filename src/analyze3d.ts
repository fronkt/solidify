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
  private stereoPanel: HTMLElement;
  private ipfPanel: HTMLElement;
  private stereoBody: HTMLElement;
  private ipfCv: HTMLCanvasElement;
  private big: HTMLElement | null = null;
  private bigCv: HTMLCanvasElement | null = null;
  private stereoClock = 0;
  private lastStereo: { sections: { id: number; areaVox: number }[]; poreVox: number } | null = null;

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
    this.stereoPanel = mk("STEREOLOGY · SECTION vs TRUE 3D", null);
    this.stereoBody = document.createElement("div");
    this.stereoBody.style.cssText = "font-size:10.5px;line-height:1.55;color:#9aa1ab;width:236px";
    this.stereoPanel.append(this.stereoBody);
    this.ipfPanel = mk("TEXTURE · IPF (grain axes)", () => this.openBig());
    this.ipfCv = document.createElement("canvas");
    this.ipfCv.width = 236; this.ipfCv.height = 190;
    this.ipfPanel.append(this.ipfCv);
  }

  setStereoOn(b: boolean) { this.stereoOn = b; this.stereoPanel.style.display = b ? "block" : "none"; }
  setIpfOn(b: boolean) { this.ipfOn = b; this.ipfPanel.style.display = b ? "block" : "none"; }

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
