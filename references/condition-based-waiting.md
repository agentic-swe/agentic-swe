# Condition-based waiting

When code depends on an asynchronous result, wait for the condition to be true — not for a fixed amount of time to pass. Fixed sleeps are fragile: too short causes flaky failures, too long wastes budget.

## The waitFor/polling pattern

Poll a condition function at a regular interval until it returns true or a timeout is exceeded.

```
function waitFor({ condition, timeout, interval, label }) {
    const deadline = now() + timeout
    while (now() < deadline) {
        if (condition()) return true
        sleep(interval)
    }
    throw TimeoutError(`${label}: condition not met after ${timeout}ms`)
}
```

### Required parameters

| Parameter | Purpose | Omission risk |
|-----------|---------|---------------|
| `condition` | What to check each iteration | Waiting for nothing |
| `timeout` | Maximum total wait time | Infinite hang |
| `interval` | Delay between polls | CPU spin or log flood |
| `label` | Human-readable description for error messages | Opaque timeout errors |

Every poll loop must have all four. No exceptions.

## Polling hygiene

**Timeouts must be finite and explicit.** An unbounded poll is an unbounded hang. Set the timeout based on the expected operation duration plus a reasonable buffer (2-3x is common).

**Intervals should match the operation's expected latency.** Polling a database every 10ms when queries take 500ms is wasteful. Polling a health endpoint every 30s when startup takes 2s is sluggish.

| Operation type | Suggested interval | Suggested timeout |
|----------------|--------------------|-------------------|
| Process startup | 500ms – 1s | 30s |
| HTTP service health | 1s – 2s | 60s |
| File appearance | 200ms – 500ms | 10s |
| CI check completion | 10s – 30s | 15min |
| DNS propagation | 30s – 60s | 10min |

**Fail explicitly on timeout.** Never return false or null on timeout — throw an error with the label, the timeout value, and the last observed state. Silent timeout failures are the hardest bugs to diagnose.

**Log each poll attempt at debug level.** When investigating a timeout, the poll log shows whether the condition was "almost true" (converging) or "always false" (wrong condition).

## When fixed delay is acceptable

A fixed `sleep()` is appropriate only when:

1. **A protocol or specification mandates a minimum wait.** DNS TTL, rate-limit backoff headers (`Retry-After`), documented eventual-consistency windows with a contractual SLA.
2. **The upstream system has no queryable readiness signal.** If there is no health endpoint, no status file, no event to subscribe to, a fixed delay with a generous buffer is the only option. Document why polling is impossible.
3. **Debouncing intentionally.** You want to wait for activity to stop (e.g., file system settle after a batch write). Even here, prefer a debounce pattern (reset timer on each event) over a flat sleep.

In all three cases, document the source of the delay value (spec URL, API docs, measured baseline) so future maintainers know it is intentional and not arbitrary.

## Example patterns

### Waiting for a server to start

```
startServer(port=8080)
waitFor(
    condition = () => httpGet(`http://localhost:8080/health`).status === 200,
    timeout   = 30_000,
    interval  = 1_000,
    label     = "server health check"
)
```

### Waiting for a file to appear

```
triggerExport(outputPath)
waitFor(
    condition = () => fileExists(outputPath) && fileSize(outputPath) > 0,
    timeout   = 10_000,
    interval  = 250,
    label     = "export file creation"
)
```

### Waiting for CI checks (with exponential backoff)

```
waitFor(
    condition = () => getCheckStatus(pr).conclusion !== null,
    timeout   = 15 * 60_000,
    interval  = (attempt) => min(10_000 * 2^attempt, 60_000),
    label     = "CI check completion"
)
```

## Scope

Consumed by `${CLAUDE_PLUGIN_ROOT}/references/debugging-playbook.md` (condition-based waiting section).

Related: `${CLAUDE_PLUGIN_ROOT}/references/root-cause-tracing.md`, `${CLAUDE_PLUGIN_ROOT}/references/defense-in-depth.md`
