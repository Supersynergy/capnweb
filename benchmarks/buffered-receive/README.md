# Buffered WebSocket receive experiment

Baseline: cloudflare/capnweb 098dca7c9f3c9fba9dfb29da92dbde2f6adac199. Patch: fd061c2f51db3d0b09aafc8501c25810a364f3c2.

The baseline.mjs and candidate.mjs files are frozen transport bundles built from actual source with Bun 1.4.4. MIT licensing is in the repository's LICENSE.txt. benchmark.mjs is the measured script with only its local package-location reference made portable; the TypeScript equivalent is benchmark.mts. No timed code was changed for publication.

Install the repository's locked dependencies and use a new output filename. From this directory:

```sh
BENCH_OUTPUT=/tmp/capnweb-new-node.jsonl BENCH_PHASE=reproduction node benchmark.mjs
BENCH_OUTPUT=/tmp/capnweb-new-bun.jsonl BENCH_PHASE=reproduction bun benchmark.mjs
```

The queued workload fills the actual transport before timing. The direct control alternates one arrival and one read. The socket workload opens a real IPv4 loopback connection, sends a burst, intentionally waits until all frames are buffered, then drains them. Client and server share one process. Connection setup and correctness assertions are outside timing. Send, delivery, buffering and complete drain are inside socket timing. Every frame and its ordering are checked afterward. This is a paused-reader transport test, not ordinary RPC latency or a production traffic sample.

Apple M4 Max, macOS 15.8.2; Node 26.13.0 and Bun 1.4.4 discovery and confirmation in fresh processes, six alternating A/B pairs per workload plus one warm-up per variant. Node 24.22.3 adds a CI-major-version socket/control check. All 378 final samples validate their messages. Older exploratory implementation results are excluded.

The Node 24 64,000-frame socket median fell from 566.20 to 232.57 ms; Node 26 confirmation from 489.71 to 213.84 ms. Both win six of six pairs. Bun confirmation changed from 28.24 to 26.60 ms, a small effect that should not be generalized. Baseline absolute timings varied substantially. summary.json and the five raw JSONL files retain all final results, including controls.

The implementation uses an additional internal array per transport; it does not bound buffers, claim RAM savings, alter the public API or change wire bytes. See checks.json for local validation. Remote CI and maintainer acceptance remain separate.
