import { simulate } from "../src/queue.js";
import { simulateThrottle } from "../src/throttle.js";

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const ms = (x) => (Number.isFinite(x) ? `${x.toFixed(0)} ms` : "-");

const base = { service: 10, deadline: 200, duration: 600_000, load: 1.2, seed: 21 };
const servers = [
  ["FIFO, unbounded", {}],
  ["Drop-tail, room for 10", { capacity: 10 }],
  ["Drop-tail, room for 19", { capacity: 19 }],
  ["CoDel timeouts", { policy: "codel", target: 50, interval: 100 }],
  ["Adaptive LIFO", { policy: "lifo", interval: 100 }],
  ["CoDel + adaptive LIFO", { policy: "codel-lifo", target: 50, interval: 100 }],
];
console.log("Server policies at 120% load, 10 ms mean work, clients give up after 200 ms\n");
console.log("| Policy | Goodput | Work wasted | p99 of good answers |");
console.log("| --- | --- | --- | --- |");
for (const [name, opts] of servers) {
  const r = simulate({ ...base, ...opts });
  console.log(`| ${name} | ${pct(r.goodput)} | ${pct(r.wasted)} | ${ms(r.goodP99)} |`);
}

console.log("\nClient throttling at 300% load, a rejection costs 25% of a request\n");
console.log("| Client | Goodput | Server time on rejections | Sent per accepted |");
console.log("| --- | --- | --- | --- |");
for (const [name, k] of [["No throttling", Infinity], ["K = 2", 2], ["K = 1.1", 1.1]]) {
  const r = simulateThrottle({ load: 3, k, seed: 5 });
  console.log(`| ${name} | ${pct(r.goodput)} | ${pct(r.rejectShare)} | ${r.sentPerAccepted.toFixed(2)} |`);
}
