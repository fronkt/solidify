// Integer geometry only. Scenario-zero production physics remains untouched.
// The alloy face guard must change too, or faces beyond a cube edge vanish.
export function rect3dSpecialize(source, dims) {
  if (dims.length !== 3 || !dims.every(n => Number.isSafeInteger(n) && n > 1)) {
    throw new Error("rectangular dimensions must be three positive grid extents");
  }
  const guard = "gid.x >= P.n || gid.y >= P.n || gid.z >= P.n";
  const upper = "vec3i(i32(p.n) - 1)";
  const face = "vec3i(i32(P.n))";
  if (source.split(guard).length !== 2 || source.split(upper).length !== 2) {
    throw new Error("production bounds changed; rectangular specialization needs review");
  }
  return source.replace(guard, `any(gid >= vec3u(${dims.map(n => `${n}u`).join(", ")}))`)
    .replace(upper, `vec3i(${dims.map(n => n - 1).join(", ")})`)
    .replaceAll(face, `vec3i(${dims.join(", ")})`);
}
