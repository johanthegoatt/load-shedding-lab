# Research notes

Every change in this repo starts from a source. One line each on why it went in.

| Date | Change | Source | Why |
| --- | --- | --- | --- |
| 2026-10-06 | FIFO, drop-tail, deadlines and goodput | [Harchol-Balter, Performance Modeling and Design of Computer Systems](https://www.cs.cmu.edu/~harchol/PerformanceModeling/book.html) | The M/M/1, M/M/1/K and Erlang C results give the sim something exact to be checked against. |
| 2026-10-06 | CoDel queue timeouts | [Maurer, Fail at Scale, ACM Queue 2015](https://queue.acm.org/detail.cfm?id=2839461), [RFC 8289](https://www.rfc-editor.org/rfc/rfc8289) | A standing queue is the signal, not its length. |
| 2026-10-07 | Adaptive LIFO | [Maurer, Fail at Scale](https://queue.acm.org/detail.cfm?id=2839461) | Under a standing queue the newest request is the one whose client is still waiting. |
| 2026-10-08 | Client-side adaptive throttling | [Google SRE book, ch. 21 Handling Overload](https://sre.google/sre-book/handling-overload/) | Rejecting a request still costs the server work. If every client keeps sending at 3x capacity, rejections alone can eat most of the server. The SRE book's rule (reject locally with probability max(0, (requests - K x accepts) / (requests + 1))) caps what reaches the server at about K times what it accepts. |
