"""Generate scripts/fixtures/quant3d-tip-driver-slabbed.mjs from the frozen
quant3d-tip-driver.mjs. Same edits the 2026-11-25 AWS Option B run applied on
the cloud box (recovered from its launcher): raise the device maxBufferSize
request to 4 GiB, split the rgba32float flux texture into two rg32float
textures (Vulkan caps a single allocation at 4 GiB), and upload the initial
fields in z-slabs. No physics or precision change; the runner checks 9/9
bit-identical equivalence against native Sim3D before any arm.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts/fixtures/quant3d-tip-driver.mjs"
DST = ROOT / "scripts/fixtures/quant3d-tip-driver-slabbed.mjs"


def sub(src, old, new):
    assert src.count(old) == 1, f"pattern count {src.count(old)}: {old[:80]}"
    return src.replace(old, new, 1)


def main():
    src = SRC.read_text(encoding="utf-8")
    src = sub(src, "maxBufferSize: Math.min(2 * 1024 ** 3, adapter.limits.maxBufferSize),",
              "maxBufferSize: Math.min(4 * 1024 ** 3, adapter.limits.maxBufferSize),")
    src = sub(src, "  const sources = [FLUX3D_WGSL, phi3dWgsl(false, latticeKinetics), transport3dWgsl(false)];",
              r'''  function splitFluxPass0(wgsl) {
    let s = wgsl;
    const decl = "@group(0) @binding(4) var flux: texture_storage_3d<rgba32float, write>;";
    const s0 = "textureStore(flux, c, vec4f(0.0, 0.0, 0.0, e2));";
    const s1 = "textureStore(flux, c, vec4f(e2 * an.a * gm * tang, e2 * an.a * an.a));";
    if (!s.includes(decl) || !s.includes(s0) || !s.includes(s1)) throw new Error("splitFluxPass0 pattern miss");
    s = s.replace(decl, "@group(0) @binding(4) var fluxA: texture_storage_3d<rg32float, write>;\n@group(0) @binding(5) var fluxB: texture_storage_3d<rg32float, write>;");
    s = s.replace(s0, "textureStore(fluxA, c, vec4f(0.0, 0.0, 0.0, 0.0));\n    textureStore(fluxB, c, vec4f(0.0, e2, 0.0, 0.0));");
    s = s.replace(s1, "let _fv = vec4f(e2 * an.a * gm * tang, e2 * an.a * an.a);\n  textureStore(fluxA, c, vec4f(_fv.xy, 0.0, 0.0));\n  textureStore(fluxB, c, vec4f(_fv.zw, 0.0, 0.0));");
    return s;
  }
  function splitFluxPass1(wgsl) {
    let s = wgsl;
    const decl = "@group(0) @binding(3) var flux: texture_3d<f32>;";
    if (!s.includes(decl)) throw new Error("splitFluxPass1 decl miss");
    s = s.replace(decl, "@group(0) @binding(3) var fluxA: texture_3d<f32>;\n@group(0) @binding(6) var fluxB: texture_3d<f32>;\nfn loadFlux(pos: vec3i) -> vec4f { return vec4f(textureLoad(fluxA, pos, 0).xy, textureLoad(fluxB, pos, 0).xy); }");
    s = s.replace(/textureLoad\(flux,\s*([^\n]+),\s*0\)/g, "loadFlux($1)");
    s = s.replaceAll("textureDimensions(flux)", "textureDimensions(fluxA)");
    if (/\bflux\b/.test(s.replace(/\/\/[^\n]*/g, ""))) throw new Error("splitFluxPass1 leftover flux ref");
    return s;
  }
  const sources = [splitFluxPass0(FLUX3D_WGSL), splitFluxPass1(phi3dWgsl(false, latticeKinetics)), transport3dWgsl(false)];''')
    src = sub(src, '      const flux = tex("rgba32float"), aux = tex("rg32float"), age = tex("rg32float"), fed = tex("r32uint"), mask = tex("r8uint");',
              '      const fluxA = tex("rg32float"), fluxB = tex("rg32float"), aux = tex("rg32float"), age = tex("rg32float"), fed = tex("r32uint"), mask = tex("r8uint");')
    src = sub(src, '[uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, { buffer: quats }), binding(4, view(flux))],',
              '[uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, { buffer: quats }), binding(4, view(fluxA)), binding(5, view(fluxB))],')
    src = sub(src, '[uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, view(flux)), binding(4, view(aux)), binding(5, view(mask)), binding(7, { buffer: status })],',
              '[uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, view(fluxA)), binding(4, view(aux)), binding(5, view(mask)), binding(6, view(fluxB)), binding(7, { buffer: status })],')
    src = sub(src, '''      const initial = fields(dims, config);
      for (let dir = 0; dir < 2; dir++) {
        device.queue.writeTexture({ texture: state[dir] }, initial.state, { bytesPerRow: dims[0] * 8, rowsPerImage: dims[1] }, dims);
        device.queue.writeTexture({ texture: grain[dir] }, initial.grain, { bytesPerRow: dims[0] * 4, rowsPerImage: dims[1] }, dims);
      }''', '''      const [nx, ny, nz] = dims;
      const SLAB_Z = Math.min(nz, 16);
      const center = config.center ?? [0, 0, 0];
      let slabIdx = 0;
      for (let z0 = 0; z0 < nz; z0 += SLAB_Z) {
        const dz = Math.min(SLAB_Z, nz - z0);
        const slabCount = nx * ny * dz;
        const slabState = new Float32Array(slabCount * 2);
        const slabGrain = new Uint32Array(slabCount);
        for (let lz = 0; lz < dz; lz++) {
          const z = z0 + lz;
          for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
            const i = (lz * ny + y) * nx + x;
            const distance = Math.hypot((x + .5) * config.dx - center[0], (y + .5) * config.dx - center[1], (z + .5) * config.dx - center[2]);
            const phi = .5 * (1 - Math.tanh((distance - config.radius) / Math.SQRT2));
            slabState[2 * i] = phi;
            slabState[2 * i + 1] = 1 - config.undercooling;
            slabGrain[i] = phi > .01 ? 1 : 0;
          }
        }
        for (let dir = 0; dir < 2; dir++) {
          device.queue.writeTexture({ texture: state[dir], origin: [0, 0, z0] }, slabState, { bytesPerRow: nx * 8, rowsPerImage: ny }, [nx, ny, dz]);
          device.queue.writeTexture({ texture: grain[dir], origin: [0, 0, z0] }, slabGrain, { bytesPerRow: nx * 4, rowsPerImage: ny }, [nx, ny, dz]);
        }
        slabIdx++;
        if (slabIdx % 4 === 0) await device.queue.onSubmittedWorkDone();
      }
      await device.queue.onSubmittedWorkDone();''')
    DST.write_text(src, encoding="utf-8", newline="\n")
    print("wrote", DST)


if __name__ == "__main__":
    main()
