// Seeded randomness and percentiles shared by every simulation.

// mulberry32: small, fast, and good enough for simulation. Same seed, same run.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const exponential = (rand, mean = 1) => -Math.log(1 - rand()) * mean;

// Nearest-rank percentile on an ascending array, q in (0, 1].
export function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[i - 1];
}

// Arrival times of a Poisson process whose rate (per ms) may change over time.
// `rate` is a number or a function of t. A varying rate is sampled by thinning
// (Lewis and Shedler 1979): draw at the peak rate, keep each point with
// probability rate(t) / peak.
export function arrivals(rand, { rate, duration, peak }) {
  const f = typeof rate === "function" ? rate : () => rate;
  const top = peak ?? (typeof rate === "function" ? undefined : rate);
  if (!(top > 0)) throw new Error("a varying rate needs its peak");
  const out = [];
  for (let t = exponential(rand, 1 / top); t < duration; t += exponential(rand, 1 / top)) {
    if (f(t) >= top || rand() * top < f(t)) out.push(t);
  }
  return out;
}
