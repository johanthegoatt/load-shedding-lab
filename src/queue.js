import { rng, exponential, arrivals, percentile } from "./rng.js";

// A c-server queue fed by a Poisson stream, simulated event by event.
// Service times are exponential with mean `service` ms (an RPC doing about a
// millisecond of work by default). `load` is the offered
// load as a fraction of capacity (servers / service requests per ms); pass
// `rate` (per ms, a number or a function of t) with `peak` to vary it.
//
// `capacity` bounds the waiting room (requests in service do not count). An
// arrival that finds it full is rejected on the spot: drop-tail.
//
// `deadline` is how long a client waits before giving up. The server cannot
// see it: a request whose client has gone still gets served, and that work is
// wasted. Goodput counts only answers that arrive in time.
//
// `policy: "codel"` is the server-side variant of CoDel that Facebook describes
// in Fail at Scale (Maurer, ACM Queue 2015). Nichols and Jacobson's insight
// (RFC 8289) is that a good queue drains and a bad one stands. So instead of a
// size limit, each request gets a queue timeout when it is enqueued: `interval`
// ms (N) normally, but only `target` ms (M) once the queue has not been empty
// for N ms. A request that outwaits its timeout is shed when it reaches the
// front, before any work is spent on it.
//
// Arrivals and service times come from separate seeded streams and are fixed
// per request before the run, so two policies given the same seed see exactly
// the same traffic and the same work.
export function simulate({
  servers = 1,
  service = 1,
  load = 0.5,
  rate,
  peak,
  duration = 600000,
  capacity = Infinity,
  deadline = Infinity,
  policy = "fifo",
  target = 5,
  interval = 100,
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
  const shed = new Uint8Array(n);
  const timeout = new Float64Array(n).fill(Infinity);
  const codel = policy === "codel";
  const q = [];
  let head = 0;
  // When the queue last went from empty to non-empty.
  let nonEmptySince = 0;

  const enqueue = (id, t) => {
    if (q.length === head) { q.length = head = 0; nonEmptySince = t; }
    if (codel) timeout[id] = t - nonEmptySince > interval ? target : interval;
    q.push(id);
  };
  // Next request worth serving at time t, or -1 if the queue runs dry.
  const dequeue = (t) => {
    while (q.length > head) {
      const id = q[head++];
      if (t - arr[id] <= timeout[id]) return id;
      shed[id] = 1;
    }
    return -1;
  };

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
      const t = freeAt[s], id = dequeue(t);
      if (id >= 0) start(id, s, t);
      // If everything queued had timed out, the server idles until the next arrival.
      else freeAt[s] = Math.min(t, i < n ? arr[i] : t);
    } else {
      const id = i++, t = arr[id];
      if (q.length === head && freeAt[s] <= t) start(id, s, t);
      else if (q.length - head < capacity) enqueue(id, t);
      // Rejected requests never reach a server; startAt stays NaN.
    }
  }

  return measure({ arr, svc, startAt, doneAt, shed, servers, service, duration, warmup, deadline });
}

// Summarise requests that arrived after the warmup window.
export function measure({ arr, svc, startAt, doneAt, shed, servers, service, duration, warmup, deadline = Infinity }) {
  const from = duration * warmup, span = duration - from;
  const sojourn = [], waits = [], good = [];
  let offered = 0, work = 0, busy = 0, rejected = 0, dropped = 0, wasted = 0;
  for (let id = 0; id < arr.length; id++) {
    // Busy time counts every request served inside the window, including a
    // backlog that queued during warmup.
    if (!Number.isNaN(startAt[id])) busy += Math.max(0, Math.min(doneAt[id], duration) - Math.max(startAt[id], from));
    if (arr[id] < from) continue;
    offered++;
    if (shed?.[id]) { dropped++; continue; }
    if (Number.isNaN(startAt[id])) { rejected++; continue; }
    sojourn.push(doneAt[id] - arr[id]);
    waits.push(startAt[id] - arr[id]);
    work += svc[id];
    if (doneAt[id] - arr[id] <= deadline) good.push(doneAt[id] - arr[id]);
    else wasted += svc[id];
  }
  const g = Float64Array.from(good).sort();
  const capacity = (servers / service) * span;
  const s = Float64Array.from(sojourn).sort();
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    offered,
    served: s.length,
    rejected,
    // Timed out in the queue and dropped before any work was spent.
    shed: dropped,
    good: g.length,
    late: s.length - g.length,
    capacity,
    // Answers delivered in time, as a fraction of what the servers can do.
    goodput: g.length / capacity,
    // Share of server time spent on answers nobody was waiting for.
    wasted: wasted / (work || 1),
    goodP99: percentile(g, 0.99),
    meanWait: mean(waits),
    meanSojourn: mean(sojourn),
    p50: percentile(s, 0.5),
    p99: percentile(s, 0.99),
    // Server time inside the measured window that was spent serving.
    utilization: busy / (servers * span),
  };
}

// Mean time in system for M/M/1: 1 / (mu - lambda).
export const mm1Sojourn = (load, service) => service / (1 - load);

// M/M/1/K blocking probability, K counting the request in service:
// (1 - rho) rho^K / (1 - rho^(K + 1)).
export function mm1kBlocking(load, K) {
  if (load === 1) return 1 / (K + 1);
  return ((1 - load) * load ** K) / (1 - load ** (K + 1));
}

// Erlang C: probability an arrival waits in M/M/c, and the mean wait.
export function erlangC(servers, load) {
  const a = load * servers; // offered traffic in Erlangs
  let term = 1, sum = 1;
  for (let k = 1; k < servers; k++) { term *= a / k; sum += term; }
  const top = (term * a) / servers / (1 - load);
  return top / (sum + top);
}
export const mmcWait = (servers, load, service) => (erlangC(servers, load) * service) / (servers * (1 - load));
