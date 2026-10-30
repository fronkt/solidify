// Independent geometry and metrology. No phase evolution is reproduced here.
export function lineFit(points) {
  if (points.length < 3) throw new Error("line fit needs at least three points");
  const n = points.length, xm = points.reduce((s, p) => s + p[0], 0) / n;
  const ym = points.reduce((s, p) => s + p[1], 0) / n;
  const xx = points.reduce((s, p) => s + (p[0] - xm) ** 2, 0);
  if (!(xx > 0)) throw new Error("degenerate fit abscissae");
  const slope = points.reduce((s, p) => s + (p[0] - xm) * (p[1] - ym), 0) / xx;
  const intercept = ym - slope * xm;
  const variance = points.reduce((s, p) => s + (p[1] - intercept - slope * p[0]) ** 2, 0) / (n - 2);
  return { slope, intercept, slopeError: Math.sqrt(variance / xx),
    interceptError: Math.sqrt(variance * (1 / n + xm * xm / xx)), rms: Math.sqrt(variance) };
}

function solve(matrix, values) {
  const n = values.length, a = matrix.map((row, i) => [...row, values[i]]);
  for (let k = 0; k < n; k++) {
    let best = k;
    for (let j = k + 1; j < n; j++) if (Math.abs(a[j][k]) > Math.abs(a[best][k])) best = j;
    if (Math.abs(a[best][k]) < 1e-12) throw new Error("singular tip surface fit");
    [a[k], a[best]] = [a[best], a[k]];
    const divisor = a[k][k]; for (let j = k; j <= n; j++) a[k][j] /= divisor;
    for (let i = 0; i < n; i++) if (i !== k) {
      const factor = a[i][k]; for (let j = k; j <= n; j++) a[i][j] -= factor * a[k][j];
    }
  }
  return a.map(row => row[n]);
}

function surfaceFit(points, radius) {
  const data = points.filter(p => p.x * p.x + p.y * p.y <= radius * radius);
  if (data.length < 12) return null;
  // Even powers enforce the independently known reflection symmetry. Quartic
  // terms keep fourfold morphology out of the local quadratic curvature.
  const features = p => {
    const x2 = (p.x / radius) ** 2, y2 = (p.y / radius) ** 2;
    return [1, x2, y2, x2 * x2, x2 * y2, y2 * y2];
  };
  const z0 = Math.max(...data.map(p => p.z));
  const a = Array.from({ length: 6 }, () => Array(6).fill(0)), b = Array(6).fill(0);
  for (const p of data) {
    const row = features(p);
    for (let j = 0; j < 6; j++) {
      b[j] += row[j] * (p.z - z0);
      for (let k = 0; k < 6; k++) a[j][k] += row[j] * row[k];
    }
  }
  const c = solve(a, b), bx = c[1] / radius ** 2, by = c[2] / radius ** 2;
  if (!(bx < 0 && by < 0)) return null;
  const rms = Math.sqrt(data.reduce((sum, p) => {
    const row = features(p), pred = row.reduce((s, x, j) => s + x * c[j], z0);
    return sum + (pred - p.z) ** 2;
  }, 0) / (data.length - 6));
  return { radius, points: data.length, tip: z0 + c[0], bx, by,
    rhoX: -1 / (2 * bx), rhoY: -1 / (2 * by), rho: -1 / (bx + by), rms };
}

export function localTip(points, dx) {
  // The first coarse estimate only selects local windows. It is never the
  // reported radius. No published target is used by this estimator.
  const initial = surfaceFit(points, 8 * dx);
  if (!initial) throw new Error("local tip is unresolved or no longer convex");
  const windows = [.25, .35, .45, .5].map(f => surfaceFit(points, initial.rho * f)).filter(Boolean);
  if (windows.length < 3) throw new Error("fewer than three resolved local curvature windows");
  const distinct = new Set(windows.map(w => w.points));
  if (distinct.size < 3) throw new Error("local windows sample the same points; refine dx");
  // After the quartic surface fit, the first unmodeled even term is sixth
  // order, making the leading quadratic-coefficient bias scale as window^4.
  const extrap = field => lineFit(windows.map(w => [w.radius ** 4, w[field]]));
  const x = extrap("bx"), y = extrap("by"), z = extrap("tip");
  if (!(x.intercept < 0 && y.intercept < 0)) throw new Error("invalid extrapolated principal curvatures");
  const rho = -1 / (x.intercept + y.intercept);
  const rhoError = Math.max(...windows.map(w => Math.abs(w.rho - rho)),
    2 * (x.interceptError + y.interceptError) * rho * rho);
  return { tip: z.intercept, tipError: Math.max(...windows.map(w => Math.abs(w.tip - z.intercept)), 2 * z.interceptError),
    rho, rhoError, rhoX: -1 / (2 * x.intercept), rhoY: -1 / (2 * y.intercept), windows };
}

export function operatingState(samples, { D, d0, dims, dx, relativeTarget }) {
  if (samples.length < 10) return { ready: false, reason: "ten curvature samples are required" };
  const last = samples.slice(-10), windows = [];
  for (let i = 0; i < 3; i++) {
    const data = last.slice(i * 3, i * 3 + 4), span = data.at(-1).time - data[0].time;
    const velocity = lineFit(data.map(s => [s.time, s.tip]));
    const rho = data.reduce((sum, s) => sum + s.rho, 0) / data.length;
    const rhoError = Math.max(...data.map(s => s.rhoError));
    const velocityError = Math.max(2 * velocity.slopeError, 2 * Math.max(...data.map(s => s.tipError)) / span);
    const rhoDrift = lineFit(data.map(s => [s.time, s.rho]));
    windows.push({ velocity: velocity.slope, velocityError, rho, rhoError,
      rhoDrift: rhoDrift.slope, rhoDriftError: Math.max(2 * rhoDrift.slopeError, 2 * rhoError / span) });
  }
  const velocity = windows.reduce((s, w) => s + w.velocity, 0) / 3;
  const rho = windows.reduce((s, w) => s + w.rho, 0) / 3;
  const velocityError = Math.max(...windows.map(w => w.velocityError));
  const rhoError = Math.max(...windows.map(w => w.rhoError));
  const stationary = windows.every(w => Math.abs(w.velocity - velocity) <= w.velocityError + velocityError
    && Math.abs(w.rho - rho) <= w.rhoError + rhoError && Math.abs(w.rhoDrift) <= w.rhoDriftError);
  const resolved = velocity > 0 && rho > 0 && velocityError / velocity < relativeTarget
    && rhoError / rho < relativeTarget;
  const diffusionLength = D / velocity, tip = last.at(-1).tip;
  const aheadDiffusionLengths = (dims[2] * dx - tip) / diffusionLength;
  const sideDiffusionLengths = (Math.min(dims[0], dims[1]) * dx - .5 * rho) / diffusionLength;
  return { ready: true, stationary, resolved, velocity, velocityError, rho, rhoError,
    rhoX: last.at(-1).rhoX, rhoY: last.at(-1).rhoY, tip, windows, diffusionLength,
    aheadDiffusionLengths, sideDiffusionLengths,
    P: rho * velocity / (2 * D), sigmaStar: 2 * D * d0 / (rho * rho * velocity),
    thinInterface: { W0OverRho: 1 / rho, W0OverDiffusionLength: 1 / diffusionLength,
      tau0VOverW0: velocity } };
}

export function selfTestTipGeometry() {
  const expected = { tip: 73.25, rhoX: 12, rhoY: 12 }, dx = .4, points = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const X = (x + .5) * dx, Y = (y + .5) * dx;
    points.push({ x: X, y: Y, z: expected.tip - X * X / 24 - Y * Y / 24
      + .00006 * (X ** 4 - 6 * X * X * Y * Y + Y ** 4) });
  }
  const measured = localTip(points, dx);
  if (Math.abs(measured.rho / expected.rhoX - 1) > 1e-8 || Math.abs(measured.tip - expected.tip) > 1e-8) {
    throw new Error("quartic morphology contaminated the local radius");
  }
  const samples = Array.from({ length: 12 }, (_, j) => ({ time: j * 20, tip: 10 + .14 * j * 20,
    tipError: 1e-4, rho: 12, rhoError: 1e-3, rhoX: 12, rhoY: 12 }));
  const state = operatingState(samples, { D: 2.5, d0: .2, dims: [256, 256, 512], dx: .8, relativeTarget: .1 });
  const drifting = operatingState(samples.map((s, j) => ({ ...s, rho: 12 + .1 * j })),
    { D: 2.5, d0: .2, dims: [256, 256, 512], dx: .8, relativeTarget: .1 });
  if (!state.stationary || !state.resolved || drifting.stationary) throw new Error("stationarity estimator failed positive/negative controls");
  return { expected, measured, stationaryControl: state.stationary, driftingControl: drifting.stationary };
}
