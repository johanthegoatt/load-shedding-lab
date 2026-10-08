import test from "node:test";
import assert from "node:assert/strict";
import { simulateThrottle, throttleProbability, fluidAccepted } from "../src/throttle.js";

test("the client rejects with max(0, (requests - K * accepts) / (requests + 1))", () => {
  assert.equal(throttleProbability(100, 100, 2), 0);
  assert.equal(throttleProbability(100, 40, 2), 20 / 101);
  assert.equal(throttleProbability(0, 0, 2), 0);
  assert.equal(throttleProbability(1000, 0, Infinity), 0);
});

test("below capacity throttling never fires", () => {
  for (const k of [Infinity, 2, 1.1]) {
    const r = simulateThrottle({ load: 0.5, k, seed: 3 });
    assert.equal(r.throttled, 0);
    assert.ok(Math.abs(r.goodput - 0.5) < 0.01, `k ${k}: ${r.goodput}`);
  }
});

test("without throttling, rejections eat the server and goodput follows (1 - c * load) / (1 - c)", () => {
  for (const load of [2, 3]) {
    const r = simulateThrottle({ load, seed: 5 });
    const want = fluidAccepted({ load, rejectCost: 0.25 });
    assert.ok(Math.abs(r.goodput - want) < 0.03, `load ${load}: ${r.goodput} vs ${want}`);
    assert.ok(r.rejectShare > 0.3, `reject share ${r.rejectShare}`);
  }
});

test("with K = 2 the client sends about twice what is accepted, and goodput holds at 1 / (1 + c (K - 1))", () => {
  for (const load of [2, 3]) {
    const r = simulateThrottle({ load, k: 2, seed: 5 });
    assert.ok(Math.abs(r.sentPerAccepted - 2) < 0.05, `ratio ${r.sentPerAccepted}`);
    assert.ok(Math.abs(r.goodput - 0.8) < 0.03, `load ${load}: ${r.goodput}`);
  }
});

test("at 3x overload, throttling more than doubles goodput", () => {
  const off = simulateThrottle({ load: 3, seed: 9 });
  const on = simulateThrottle({ load: 3, k: 2, seed: 9 });
  assert.ok(on.goodput > off.goodput * 2, `${off.goodput} -> ${on.goodput}`);
});

test("a lower K wastes less server time on rejections but sends less", () => {
  const two = simulateThrottle({ load: 3, k: 2, seed: 11 });
  const tight = simulateThrottle({ load: 3, k: 1.1, seed: 11 });
  assert.ok(tight.rejectShare < two.rejectShare / 4, `${two.rejectShare} -> ${tight.rejectShare}`);
  assert.ok(tight.throttled > two.throttled);
});

test("once a burst ends the client stops throttling within one window", () => {
  const rate = (t) => (t >= 60_000 && t < 120_000 ? 3 : 0.5);
  const r = simulateThrottle({ rate, peak: 3, k: 2, window: 10_000, duration: 240_000, warmup: 0, bucket: 10_000, seed: 13 });
  const during = r.timeline.slice(7, 12);
  for (const b of during) assert.ok(b.throttled > 0.3, `during ${b.t}: ${b.throttled}`);
  const settled = r.timeline.slice(14);
  for (const b of settled) assert.ok(b.throttled < 0.01 && b.goodput > 0.48, `after ${b.t}: ${b.throttled} ${b.goodput}`);
});
