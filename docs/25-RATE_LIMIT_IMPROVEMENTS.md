# Rate Limit Improvement Plan

**Date**: 2025-11-16

## Purpose

Summarize findings about current interaction / cleanup code that can cause Discord API rate-limiting, and propose concrete, prioritized mitigations and an implementation plan to reduce 429s and improve reliability.

## Quick Executive Summary

- Current code already uses small delays (`config.messageDeleteDelay`, `startupDMCleanupDelay`, `startupChannelCleanupDelay`) and tracks menu message IDs in memory.
- Hotspots: startup DM cleanup (iterating many DMs deleting messages), DM single-message deletes (no bulk delete), and message fetch + filter patterns used in some cleanup flows.
- Short-term: increase delays and add retry-on-429 handling; add central rate-limited wrapper for Discord API calls.
- Medium-term: batch/bulk operations where possible, persist message IDs to avoid fetches, and add a job queue with concurrency limits (per-channel + global).

## Files inspected (representative)

- `utils/cleanupService.js` — many per-message deletes in loops, uses `config.messageDeleteDelay` (currently 50ms)
- `utils/startupCleanup.js` — deletes bot messages across tracked DMs and temporary channels, uses `startupDMCleanupDelay` and `startupChannelCleanupDelay`
- `utils/menuBuilder.js`, `interactions/shared/*` — generate many messages and track message IDs via `trackMenuMessage`
- `config/config.js` — current timing knobs (see section below)

## Observed behavior & risk

- Deleting messages one-by-one against many DMs or channels means N HTTP requests (N deletes). DMs cannot bulk-delete, so they require individual deletes but should be rate-throttled.
- Startup cleanup iterates tracked DMs/channels sequentially but still may perform many deletes quickly; current delays may be insufficient if scale grows or when Discord returns global rate limits.
- Fetching large message windows frequently (`messageFetchLimit = 100`) increases REST calls. Where message IDs are already tracked, fetching can be avoided.

## Concrete Recommendations (prioritized)

1) Add a central Discord API rate-limiter/queue wrapper
   - Single module (e.g., `utils/discordRateLimiter.js`) that exposes `enqueue(fn)` or `restCall(fn)` and enforces:
     - Global concurrency cap (e.g., 5 concurrent API requests by default)
     - Per-channel concurrency cap (1-2 concurrent deletes/edits per channel)
     - Respect `Retry-After` / `retry_after` values returned by Discord on 429s
     - Implement exponential backoff for transient failures
   - Implementation options: lightweight homegrown queue, or use `bottleneck` / `p-queue` NPM package (recommended for robustness).

2) Add 429-aware retry wrapper around critical operations
   - For functions that call Discord API (delete/send/fetch/create), wrap in a small helper that checks for HTTP 429 and sleeps `retry_after` (or uses exponential backoff) then retries up to N times.

3) Reduce fetchs by using tracked message IDs
   - Where the system already tracks menu messages (`trackMenuMessage`, `menuHierarchy`), use tracked IDs directly for deletion instead of fetching `channel.messages.fetch({ limit: ... })` and filtering by content.
   - This avoids many unnecessary fetch requests.

4) Use bulk deletes where possible (guild channels only)
   - When cleaning guild text channels (not DMs), use `channel.bulkDelete(arrayOfMessageIds)` for messages younger than 14 days. This reduces requests and is faster. Add fallback for older messages.

5) Stagger startup cleanup and add a low-priority background job
   - Rather than deleting all tracked DMs/channels aggressively at startup, schedule startup cleanup as a background job that runs with low concurrency (e.g., `2` concurrent DM cleanups) and longer delays between users.
   - Add an option to disable aggressive startup cleanup when large numbers of tracked DMs exist.

6) Increase monitoring/logging for rate-limit events
   - Log 429 events with route, retry_after, and timestamp.
   - Expose a runtime metric (counter) for recent 429s to guide tuning.

7) Config knobs to add
   - `apiGlobalConcurrency` (default: 5)
   - `apiPerChannelConcurrency` (default: 1)
   - `dmDeleteDelay` (ms) (explicitly named for DM deletes; default: 100ms)
   - `startupCleanupConcurrency` (default: 2)
   - `rateLimiterStrategy` (options: `token-bucket`, `fixed-window`, `queue`) — just for documentation/ops

## Implementation Plan (step-by-step)

1. Add `utils/discordRateLimiter.js`
   - Minimal API: `async function run(actionFn, options = {})` where `actionFn` is an async closure performing the actual Discord call.
   - Enforce concurrency and exponential backoff; parse 429 responses and respect `retry_after`.

2. Replace inline sleep/`setTimeout` calls on deletes with enqueued jobs through the rate limiter.
   - E.g., in `cleanupService.js`, instead of `await message.delete(); await sleep(config.messageDeleteDelay)`, do `await rateLimiter.run(() => message.delete(), { routeKey: message.channel.id });`

3. For guild channel cleanups, detect candidate messages and call `channel.bulkDelete(idsChunk)` for messages <=14 days old.

4. Persist or continue to track sent message IDs
   - Where messages are created (menu creation), continue calling `trackMenuMessage(userId, level, message.id)`; use these IDs in cleanup routines.
   - Where possible persist recent menu message IDs to DB for startup use (so startup cleanup can delete known message IDs rather than fetching many messages).

5. Add 429 logging and instrumentation
   - Update `logWriter.js` to capture `RATE_LIMIT` entries and include `route`, `retry_after`, `remaining` if available.

6. Tune config values and run load tests
   - Start with `apiGlobalConcurrency = 5`, `dmDeleteDelay = 150ms`, `startupCleanupConcurrency = 2`.
   - Run stress tests (10-50 simultaneous DM users) and monitor 429 counts.

## Example rate-limiter (pseudocode)

```js
// utils/discordRateLimiter.js (concept)
const PQueue = require('p-queue'); // or implement in-house

const globalQueue = new PQueue({ concurrency: config.apiGlobalConcurrency });

async function run(actionFn, opts = {}) {
  return globalQueue.add(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await actionFn();
      } catch (err) {
        if (err.status === 429 || err.code === 429) {
          const waitMs = err.retry_after ? Math.ceil(err.retry_after * 1000) : (1000 * 2 ** attempt);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Discord API call failed after retries');
  });
}

module.exports = { run };
```

## Low-effort short-term changes (apply quickly)

- Increase `config.messageDeleteDelay` from `50`ms to `100-150`ms while adding logging for 429s.
- Increase `config.startupDMCleanupDelay` from `100`ms to `250-500`ms if many DMs tracked.
- Add try/catch to detect 429s and log `err.retry_after` in `cleanupService.js` and `startupCleanup.js`.

## Medium-term (recommended)

- Implement the centralized rate limiter and replace critical deletes with `rateLimiter.run(...)`.
- Use `bulkDelete` in guild channels where appropriate.
- Persist recent menu message IDs to DB so startup cleanup doesn't fetch large message windows.

## Long-term

- Introduce a background worker (separate process or internal job queue) for large cleanup tasks.
- Add test harness to simulate bulk DM and channel cleanups and tune config values automatically.

## Comparison summary vs `14-PARALLEL_SESSION_ANALYSIS.md`

- Overlap:
  - Both docs note that DM mode avoids channel limits and that startup cleanup currently deletes DMs (we observed same). Both note cleanup timers and channel deletion behavior.

- Differences:
  - This document focuses specifically on Discord API rate limiting and proposes a central rate-limiter and 429-aware retrying, plus job-queue/concurrency knobs. `14-PARALLEL_SESSION_ANALYSIS.md` is focused on session isolation and concurrency correctness rather than API-level throttling.
  - `14-PARALLEL_SESSION_ANALYSIS.md` recommends DM mode for high concurrency; this doc augments that guidance with concrete throttling and batching strategies to ensure large-scale cleanup or bursts don't hit rate-limits.

## Next steps & checklist

- [ ] Review and approve short-term config changes (increase delete delays + 429 logging)
- [ ] Add `utils/discordRateLimiter.js` and replace critical deletes with `rateLimiter.run(...)`
- [ ] Add bulk delete logic for guild channels
- [ ] Persist message IDs for reliable startup cleanup
- [ ] Run load tests and tune `apiGlobalConcurrency` and delays

---

If you'd like, I can implement the `utils/discordRateLimiter.js` module and wire it into `utils/cleanupService.js` and `utils/startupCleanup.js` next — do you want me to proceed with those code changes now?



Batch Operations Where Possible

Use bulk delete for messages instead of deleting them one by one.
When cleaning up messages, collect IDs and use bulkDelete (where supported).
Minimize Redundant Fetches

Cache user, channel, and guild objects locally (in memory) for the duration of a flow/session.
Avoid repeated calls to guild.members.fetch, channel.fetch, or client.users.fetch for the same entity within a short time window.
Reduce Message Edits

Only edit messages if the content or components have actually changed.
Debounce or throttle rapid-fire edits (e.g., from pagination or fast user input).
Queue and Throttle Outbound Requests

Implement a simple queue for high-frequency actions (like sending or editing messages in busy channels).
Use setTimeout or a queue manager to space out requests, especially for actions that may be triggered in bursts.
Optimize Cleanup Logic

When cleaning up, avoid fetching or deleting messages that are already deleted or expired.
Track message state in your own data structures to avoid unnecessary API calls.
Leverage Discord.js Built-in Rate Limiting

Rely on discord.js’s internal rate limit manager, but avoid overwhelming it with unnecessary requests.
Use Ephemeral Messages for Temporary UI

Where possible, use ephemeral replies (which auto-clean up and don’t require manual deletion).
Batch Data Fetches

When you need to fetch multiple pieces of data (e.g., requests, users), use bulk queries to your database and cache results for the session.
Avoid Unnecessary Component Updates

When disabling buttons or updating menus, only update the affected components, not the entire message.
Log and Monitor API Usage

Add logging for API-heavy operations to identify hotspots and optimize them further.
Would you like a code example o