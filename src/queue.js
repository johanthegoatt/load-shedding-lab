import { rng, exponential, arrivals, percentile } from "./rng.js";

// A c-server queue fed by a Poisson stream, simulated event by event.
// Service times are exponential with mean `service` ms. `load` is the offered
// load as a fraction of capacity (servers / service requests per ms); pass
// `rate` (per ms, a number or a function of t) with `peak` to vary it.
//
// Arrivals and service times come from separate seeded streams and are fixed
// per request before the run, so two policies given the same seed see exactly
// the same traffic and the same work.
export function simulate({
  servers = 1,
  service = 10,
  load = 0.5,
  rate,
  peak,
  duration = 600000,
  seed = 1,
  warmup = 0.1,
} = {}) {
  const arr = arrivals(rng(seed), { rate: rate ?? (load * servers) / service, duration, peak });
  const n = arr.length;
  const srand = rng(seed + 7919);
  const svc = new Float64Array(n);
  for (let id = 0; id < n; id++) svc[id] = exponential(srand, service);

  const startAt = new Float64Array(n).fill(NaN);
  const doneAt = new Float64Array(n).fill(NaN);
  const freeAt = new Float64Array(servers);
  const q = [];
  let head = 0;

  const start = (id, s, t) => {
    startAt[id] = t;
    doneAt[id] = t + svc[id];
    freeAt[s] = doneAt[id];
  };

  let i = 0;
  while (i < n || q.length > head) {
    let s = 0;
    for (let k = 1; k < servers; k++) if (freeAt[k] < freeAt[s]) s = k;
    if (q.length > head && (i >= n || freeAt[s] <= arr[i])) {
      // Every server was busy when these requests queued, so the freed server
      // takes the next one at the moment it frees.
      start(q[head++], s, freeAt[s]);
    } else {
      const id = i++, t = arr[id];
      if (q.length === head && freeAt[s] <= t) start(id, s, t);
      else q.push(id);
    }
  }

  return measure({ arr, svc, startAt, doneAt, servers, service, duration, warmup });
}

// Summarise requests that arrived after the warmup window.
export function measure({ arr, svc, startAt, doneAt, servers, service, duration, warmup }) {
  const from = duration * warmup, span = duration - from;
  const sojourn = [], waits = [];
  let offered = 0, busy = 0;
  for (let id = 0; id < arr.length; id++) {
    if (arr[id] < from) continue;
    offered++;
    sojourn.push(doneAt[id] - arr[id]);
    waits.push(startAt[id] - arr[id]);
    busy += svc[id];
  }
  const s = Float64Array.from(sojourn).sort();
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    offered,
    served: s.length,
    capacity: (servers / service) * span,
    meanWait: mean(waits),
    meanSojourn: mean(sojourn),
    p50: percentile(s, 0.5),
    p99: percentile(s, 0.99),
    utilization: busy / (servers * span),
  };
}

// Mean time in system for M/M/1: 1 / (mu - lambda).
export const mm1Sojourn = (load, service) => service / (1 - load);

// Erlang C: probability an arrival waits in M/M/c, and the mean wait.
export function erlangC(servers, load) {
  const a = load * servers; // offered traffic in Erlangs
  let term = 1, sum = 1;
  for (let k = 1; k < servers; k++) { term *= a / k; sum += term; }
  const top = (term * a) / servers / (1 - load);
  return top / (sum + top);
}
export const mmcWait = (servers, load, service) => (erlangC(servers, load) * service) / (servers * (1 - load));
