import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/queue.js";

const base = { service: 10, deadline: 200, duration: 600_000, seed: 21 };

test("below saturation FIFO delivers nearly everything in time", () => {
  const r = simulate({ ...base, load: 0.7 });
  // M/M/1: P(sojourn > t) = e^-(mu - lambda) t = e^-6 at t = 200 ms.
  assert.ok(r.late / r.served < 0.01, `late ${r.late / r.served}`);
  assert.ok(Math.abs(r.goodput - 0.7) < 0.02, `goodput ${r.goodput}`);
});

test("past saturation FIFO stays fully busy and its goodput collapses", () => {
  const r = simulate({ ...base, load: 1.2 });
  assert.ok(r.utilization > 0.99, `utilization ${r.utilization}`);
  assert.ok(r.goodput < 0.01, `goodput ${r.goodput}`);
  assert.ok(r.wasted > 0.99, `wasted ${r.wasted}`);
});

test("drop-tail only works when the room is tuned well below the deadline", () => {
  const run = (capacity) => simulate({ ...base, load: 1.2, capacity });
  // Room for 10 behind the one in service: half the deadline's worth of mean work.
  const tuned = run(10);
  assert.ok(tuned.goodput > 0.95, `goodput ${tuned.goodput}`);
  assert.ok(tuned.wasted < 0.02, `wasted ${tuned.wasted}`);
  // Room for 19 sounds right (19 x 10 ms < 200 ms) but the wait is a sum of
  // exponentials, so a quarter of the work still finishes after the client left.
  const naive = run(19);
  assert.ok(naive.wasted > 0.2, `wasted ${naive.wasted}`);
  // A little more room and the collapse is back.
  assert.ok(run(30).goodput < 0.3);
});
