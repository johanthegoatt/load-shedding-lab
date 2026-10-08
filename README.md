# load-shedding-lab

What should a server do when more work arrives than it can finish? This repo simulates the common answers on the same seeded traffic and checks each one against queueing theory, so the numbers below can be trusted and reproduced.

```bash
npm test
npm run compare
```

No dependencies. Node 20 or newer.

## The problem

A server past 100% load does not slow down gently. With a plain first-in, first-out queue it stays fully busy, but every answer it sends arrives after the client has already given up. Throughput looks fine on a dashboard while goodput, the answers that arrive in time, falls to zero.

## Results

`npm run compare` prints these tables. Same seed, same requests, same work per request for every row.

Server policies at 120% load, 10 ms mean work, clients give up after 200 ms:

| Policy | Goodput | Work wasted | p99 of good answers |
| --- | --- | --- | --- |
| FIFO, unbounded | 0.0% | 100.0% | - |
| Drop-tail, room for 10 | 97.4% | 0.5% | 173 ms |
| Drop-tail, room for 19 | 78.1% | 27.6% | 199 ms |
| CoDel timeouts | 94.2% | 0.0% | 108 ms |
| Adaptive LIFO | 94.1% | 21.7% | 173 ms |
| CoDel + adaptive LIFO | 91.0% | 0.0% | 95 ms |

Client throttling at 300% load, where turning a request away costs the server 25% of the work of serving it:

| Client | Goodput | Server time on rejections | Sent per accepted |
| --- | --- | --- | --- |
| No throttling | 31.8% | 66.6% | 8.96 |
| K = 2 | 80.1% | 20.0% | 2.00 |
| K = 1.1 | 94.9% | 2.4% | 1.10 |

## What each policy does

**FIFO.** Serve the oldest request first. Fine below capacity. Past it, the queue grows without end and every request waits longer than its deadline.

**Drop-tail.** Cap the queue and reject arrivals when it is full. It works, but only when the cap is tuned well below the deadline. Room for 19 requests of 10 ms sounds like it fits a 200 ms deadline, yet the wait is a sum of random service times, so over a quarter of the work still finishes after the client left. The sim matches the M/M/1/K blocking probability.

**CoDel queue timeouts** (Maurer, Fail at Scale, ACM Queue 2015, after RFC 8289). Do not look at the queue length. Look at whether the queue ever drains. Each request gets a timeout of `interval` ms normally, cut to `target` ms once the queue has stood non-empty for a whole interval. Requests that outwait their timeout are dropped before any work is spent on them.

**Adaptive LIFO** (same article). Once the queue stands, serve the newest request first, since its client is the one most likely still waiting. On its own it keeps goodput up but still burns work on stale requests at the back. Paired with CoDel it wastes nothing and has the lowest tail.

**Client-side adaptive throttling** (Google SRE book, ch. 21). Rejecting is not free: the server still parses the request and writes an error. If every client keeps retrying at 3x capacity, rejections alone eat two thirds of the server. Each client tracks how many requests it sent and how many were accepted over a window, and drops new requests locally with probability `max(0, (requests - K * accepts) / (requests + 1))`. That caps what reaches the server at about K times what it accepts. Goodput then follows `1 / (1 + c (K - 1))` for a rejection cost `c`, and the tests check the sim against that and against `(1 - c * load) / (1 - c)` with no throttling. A lower K wastes less server time but can turn away requests the server would have served.

## How it is checked

- `test/queue.test.js`: M/M/1 mean time in system, Erlang C waits for several servers, M/M/1/K blocking.
- `test/goodput.test.js`: FIFO collapse past saturation, drop-tail tuned vs naive.
- `test/codel.test.js` and `test/lifo.test.js`: a 10 s burst at 3x load, with goodput and p99 per 2 s bucket before, during and after.
- `test/throttle.test.js`: the throttle formula, both fluid models, the 2x goodput gain at 3x overload, and the throttle letting go within one window once a burst ends.

Arrivals are a seeded Poisson stream (thinned for varying rates, Lewis and Shedler 1979) and service times come from a separate seeded stream fixed per request, so two policies with the same seed see exactly the same traffic.

## Layout

```
src/rng.js        seeded RNG, exponential draws, Poisson arrivals, percentiles
src/queue.js      c-server queue: FIFO, drop-tail, CoDel, adaptive LIFO, closed forms
src/throttle.js   client-side adaptive throttling and its fluid model
examples/         npm run compare
docs/             research notes behind each change
```

## License

MIT, see [LICENSE](LICENSE).
