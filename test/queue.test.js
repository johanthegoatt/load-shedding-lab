import test from "node:test";
import assert from "node:assert/strict";
import { simulate, mm1Sojourn, mm1kBlocking, erlangC, mmcWait } from "../src/queue.js";
import { rng, arrivals } from "../src/rng.js";

const close = (got, want, tol) => assert.ok(Math.abs(got - want) / want < tol, `${got} vs ${want}`);

test("thinning keeps the mean count of a stepped rate", () => {
  const rate = (t) => (t < 50000 ? 0.05 : 0.15);
  const n = arrivals(rng(4), { rate, peak: 0.15, duration: 100000 }).length;
  close(n, 0.05 * 50000 + 0.15 * 50000, 0.03);
});

test("FIFO M/M/1 matches 1 / (mu - lambda)", () => {
  for (const load of [0.5, 0.8]) {
    const r = simulate({ load, service: 10, duration: 3_000_000, seed: 11 });
    close(r.meanSojourn, mm1Sojourn(load, 10), 0.05);
    close(r.utilization, load, 0.02);
  }
});

test("FIFO M/M/4 matches the Erlang C mean wait", () => {
  close(erlangC(1, 0.7), 0.7, 1e-12);
  const r = simulate({ servers: 4, load: 0.85, service: 10, duration: 2_000_000, seed: 12 });
  close(r.meanWait, mmcWait(4, 0.85, 10), 0.06);
});

test("drop-tail rejects at the M/M/1/K blocking probability", () => {
  for (const [load, room] of [[0.9, 9], [1.5, 4]]) {
    const r = simulate({ load, service: 10, capacity: room, duration: 3_000_000, seed: 13 });
    close(r.rejected / r.offered, mm1kBlocking(load, room + 1), 0.05);
  }
});
