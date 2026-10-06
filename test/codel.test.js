import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/queue.js";

// 1 ms of work per request, clients give up after 200 ms, and Facebook's
// published M = 5 ms, N = 100 ms.
const base = { service: 1, deadline: 200, duration: 120_000, seed: 31 };

test("CoDel leaves a healthy queue alone", () => {
  const r = simulate({ ...base, load: 0.7, policy: "codel" });
  assert.ok(r.shed / r.offered < 0.005, `shed ${r.shed / r.offered}`);
  assert.ok(Math.abs(r.goodput - 0.7) < 0.02, `goodput ${r.goodput}`);
});

test("under overload CoDel sheds the excess and keeps goodput near capacity", () => {
  for (const load of [1.2, 2, 3]) {
    const fifo = simulate({ ...base, load });
    const codel = simulate({ ...base, load, policy: "codel" });
    assert.ok(fifo.goodput < 0.01, `fifo ${load}: ${fifo.goodput}`);
    assert.ok(codel.goodput > 0.95, `codel ${load}: ${codel.goodput}`);
    assert.ok(codel.wasted < 0.01, `codel ${load} wasted ${codel.wasted}`);
    // Every answer still arrives before the N = 100 ms queue timeout plus service.
    assert.ok(codel.goodP99 < 110, `codel ${load} p99 ${codel.goodP99}`);
  }
});

test("no server time leaks past the window when FIFO falls behind", () => {
  const r = simulate({ ...base, load: 2 });
  assert.ok(r.utilization <= 1 + 1e-9 && r.utilization > 0.99, `utilization ${r.utilization}`);
});
