import { rng, exponential, arrivals, percentile } from "./rng.js";

export function throttleProbability(requests, accepts, k) {
  if (!Number.isFinite(k)) return 0;
  return Math.max(0, (requests - k * accepts) / (requests + 1));
}

export function simulateThrottle({
  service = 1,
  load = 3,
  rate,
  peak,
  duration = 300_000,
  capacity = 20,
  deadline = 100,
  rejectCost = 0.25,
  k = Infinity,
  window = 30_000,
  bucket = 0,
  seed = 1,
  warmup = 0.2,
} = {}) {
  const arr = arrivals(rng(seed), { rate: rate ?? load / service, duration, peak });
  const n = arr.length;
  const srand = rng(seed + 7919);
  const crand = rng(seed + 104729);
  const svc = new Float64Array(n);
  for (let id = 0; id < n; id++) svc[id] = exponential(srand, service);

  const doneAt = new Float64Array(n).fill(NaN);
  const outcome = new Uint8Array(n);
  const reqTimes = [], accTimes = [];
  let reqHead = 0, accHead = 0;
  const q = [];
  let head = 0, freeAt = 0, rejectBusy = 0;
  const from = duration * warmup;

  const serveUntil = (t) => {
    while (q.length > head && freeAt <= t) {
      const id = q[head++];
      doneAt[id] = freeAt + svc[id];
      freeAt = doneAt[id];
    }
  };

  for (let id = 0; id < n; id++) {
    const t = arr[id];
    serveUntil(t);
    while (reqHead < reqTimes.length && reqTimes[reqHead] <= t - window) reqHead++;
    while (accHead < accTimes.length && accTimes[accHead] <= t - window) accHead++;
    const p = throttleProbability(reqTimes.length - reqHead, accTimes.length - accHead, k);
    reqTimes.push(t);
    if (crand() < p) { outcome[id] = 1; continue; }
    if (q.length === head && freeAt <= t) {
      q.length = head = 0;
      doneAt[id] = t + svc[id];
      freeAt = doneAt[id];
      accTimes.push(t);
    } else if (q.length - head < capacity) {
      q.push(id);
      accTimes.push(t);
    } else {
      outcome[id] = 2;
      const begin = Math.max(freeAt, t);
      freeAt = begin + rejectCost;
      rejectBusy += Math.max(0, Math.min(freeAt, duration) - Math.max(begin, from));
    }
  }
  serveUntil(Infinity);

  const span = duration - from;
  let offered = 0, local = 0, rejected = 0, served = 0;
  const good = [];
  for (let id = 0; id < n; id++) {
    if (arr[id] < from) continue;
    offered++;
    if (outcome[id] === 1) local++;
    else if (outcome[id] === 2) rejected++;
    else {
      served++;
      const rt = doneAt[id] - arr[id];
      if (rt <= deadline) good.push(rt);
    }
  }
  const g = Float64Array.from(good).sort();
  const out = {
    offered,
    sent: offered - local,
    throttled: local,
    rejected,
    served,
    good: g.length,
    goodput: g.length / (span / service),
    rejectShare: rejectBusy / span,
    sentPerAccepted: (offered - local) / (served || 1),
    goodP99: percentile(g, 0.99),
  };
  if (bucket > 0) {
    const kb = Math.ceil(duration / bucket);
    const gb = new Float64Array(kb), tb = new Float64Array(kb), ob = new Float64Array(kb);
    for (let id = 0; id < n; id++) {
      const b = Math.floor(arr[id] / bucket);
      ob[b]++;
      if (outcome[id] === 1) tb[b]++;
      else if (outcome[id] === 0 && doneAt[id] - arr[id] <= deadline) gb[b]++;
    }
    out.timeline = Array.from(gb, (x, b) => ({ t: b * bucket, goodput: x / (bucket / service), throttled: tb[b] / (ob[b] || 1) }));
  }
  return out;
}

export function fluidAccepted({ load, rejectCost, k = Infinity }) {
  if (load <= 1) return load;
  const throttled = 1 / (1 + rejectCost * (k - 1));
  if (Number.isFinite(k) && k * throttled < load) return throttled;
  return Math.max(0, (1 - rejectCost * load) / (1 - rejectCost));
}
