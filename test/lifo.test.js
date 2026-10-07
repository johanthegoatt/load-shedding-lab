import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/queue.js";

// 80% load with a 10 s burst at three times that, 20 s in.
const rate = (t) => (t >= 20_000 && t < 30_000 ? 2.4 : 0.8);
const run = (policy) =>
  simulate({ service: 1, deadline: 200, duration: 60_000, warmup: 0, seed: 41, rate, peak: 2.4, policy, bucket: 2000 });
const runs = Object.fromEntries(["fifo", "codel", "lifo", "codel-lifo"].map((p) => [p, run(p)]));
const during = (r) => r.timeline.slice(10, 15);
const after = (r) => r.timeline.slice(15);

test("after a burst FIFO is still serving the backlog when the window ends", () => {
  for (const b of after(runs.fifo)) assert.ok(b.goodput < 0.01, `fifo ${b.t}: ${b.goodput}`);
});

test("CoDel, with or without LIFO, is back to normal in the first bucket after the burst", () => {
  for (const p of ["codel", "codel-lifo"]) {
    for (const b of during(runs[p])) assert.ok(b.goodput > 0.9, `${p} during ${b.t}: ${b.goodput}`);
    const first = after(runs[p])[0];
    assert.ok(first.goodput > 0.75 && first.p99 < 50, `${p} after: ${first.goodput} p99 ${first.p99}`);
  }
});

test("LIFO alone keeps answering in time but burns work on requests nobody wants", () => {
  for (const b of during(runs.lifo)) assert.ok(b.goodput > 0.9, `lifo during ${b.t}: ${b.goodput}`);
  assert.ok(runs.lifo.wasted > 0.15, `lifo wasted ${runs.lifo.wasted}`);
  assert.equal(runs["codel-lifo"].wasted, 0);
});

test("pairing LIFO with CoDel lowers latency for the requests that do get served", () => {
  const p99 = (r) => Math.max(...during(r).map((b) => b.p99));
  assert.ok(p99(runs["codel-lifo"]) < p99(runs.codel) * 0.8, `${p99(runs.codel)} -> ${p99(runs["codel-lifo"])}`);
  assert.ok(runs["codel-lifo"].p50 < runs.codel.p50, `${runs.codel.p50} -> ${runs["codel-lifo"].p50}`);
});

test("unknown policies are refused", () => {
  assert.throws(() => simulate({ policy: "random" }), /unknown policy/);
});
