"""Float64 magnitude of the sealed angular kinetic term over dendrite-tip normals.

Uses the sealed continuum form from quant3d-oblique-kinetic-angular.md:
  gamma = (16 eps / 3) (S6 - S4^2) / a(n),  a = 1 + eps (4 S4 - 3),
  c_total = 1321/9870 + (1084/1645) gamma.
Reports the largest relative change of the h^2 kinetic coefficient,
(1084/1645) gamma / (1321/9870), over normals within a polar angle theta_max of
the [001] growth axis (all azimuths). Closed forms checked: in a {100} plane
S6 - S4^2 = sin^2(4 theta)/16. Diagnostic only; no coefficient is fitted.
"""
import math

EPS = 0.0171
C0, C1 = 1321 / 9870, 1084 / 1645


def gamma(n):
    s4 = sum(x ** 4 for x in n)
    s6 = sum(x ** 6 for x in n)
    a = 1 + EPS * (4 * s4 - 3)
    return 16 * EPS / 3 * (s6 - s4 * s4) / a


def scan(theta_max_deg, steps=721):
    best = (0.0, None)
    for i in range(steps):
        th = math.radians(theta_max_deg) * i / (steps - 1)
        for j in range(steps):
            ph = (math.pi / 2) * j / (steps - 1)
            n = (math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))
            g = gamma(n)
            if g > best[0]:
                best = (g, (math.degrees(th), math.degrees(ph)))
    return best


if __name__ == "__main__":
    # Closed-form control in the (100) plane at 22.5 degrees.
    th = math.radians(22.5)
    n = (math.sin(th), 0.0, math.cos(th))
    expect = 16 * EPS / 3 * (math.sin(4 * th) ** 2 / 16) / (1 + EPS * (4 * (math.sin(th) ** 4 + math.cos(th) ** 4) - 3))
    assert abs(gamma(n) - expect) < 1e-15, (gamma(n), expect)
    for theta_max in (30, 45, 60, 90):
        g, where = scan(theta_max)
        print(f"theta<= {theta_max:2d} deg: max gamma {g:.6f} at (theta,phi)=({where[0]:.2f},{where[1]:.2f}) deg; "
              f"angular/principal h^2 coefficient {C1 * g / C0:.4%}")
