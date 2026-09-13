# YouTube audio queue — `/yt <link/search>`

Date: 2026-09-13
Status: implemented and verified on the Windows deployment host. The guild-scoped pilot in Discord guild `467655562658578432` passed real `/yt` voice playback on 2026-09-13.

## 1. Feature and user experience

Add `/yt` with one required string option, `query`, accepting a YouTube video link or search phrase. Play the video's **audio in a Discord voice channel**. Video screen sharing is outside this feature.

Examples:

```text
/yt query:https://www.youtube.com/watch?v=VIDEO_ID
/yt query:https://youtu.be/VIDEO_ID
/yt query:lofi music
/yt query:เพลงที่อยากฟัง
```

- The requester must be in a supported guild voice channel. Validate the bot's Connect and Speak permissions.
- A link resolves one video and adds it to the existing audio queue.
- A search returns up to five results in an ephemeral selection menu: title, channel, and duration. Only the requester can select; selection expires after 60 seconds. Include Cancel. Do not automatically play the first search result.
- Acknowledge promptly with a deferred response before provider work. After selection, recheck membership, voice channel, permissions, availability, and queue limits.
- Confirm the title, canonical YouTube link, duration, and number of items ahead. Distinguish queued, preparing, and actually playing.
- `/queue view` includes YouTube alongside TTS and local sounds. Add `/queue skip`; make `/queue clear` explicitly stop current playback and clear pending items, matching current behavior.
- Provide English and Thai replies following the interaction locale. Escape untrusted titles, limit message lengths, and disable mentions.

## 2. Findings in the current repository

| Existing surface | Evidence and work needed |
| --- | --- |
| `backend/bot/audio_queue.js` | One queue/player per guild; supports local MP3 and Edge/Google TTS. Extend this manager instead of introducing another player. |
| Enqueue contract | Manager returns an ID or null asynchronously; wrapper currently reports success immediately and puts a Promise in `id`. Establish an awaited result contract and migrate callers. |
| Skip/clear lifecycle | Skip shifts the queue itself while the old completion callback can also shift it. Clear replaces the array while async preparation retains old references. Introduce cancellation and item ownership checks. |
| Timeout/error handling | MP3 gets a fixed 60-second timer; TTS gets an estimate. Player errors are logged but do not immediately finalize the item. Neither behavior is suitable for songs. |
| `commands/utility/play.js` | Local sound command, useful for voice checks; currently joins before file/queue validation. Preserve its command purpose while repairing queue integration. |
| `commands/utility/queue.js` | Existing view and clear commands; no voice membership or control authorization check in this command. Add policy checks before expanding controls. |
| `backend/bot/bot.js` | TTS/event producers and queue IPC handlers use the same manager. Audit every enqueue call when changing its contract. |
| `backend/web/web.js` | Guild-admin and developer queue endpoints already expose skip/remove/clear. Preserve their authorization and sanitize new metadata. |
| Dependencies | `@discordjs/voice`, `discord.js`, `ffmpeg-static`, and `opusscript` exist. No YouTube provider is installed. |
| `tests/audio-queue.test.js` | Existing queue regression suite to extend with deterministic playback and cancellation cases. |

## 3. Scope and operating defaults

Use FIFO playback across TTS, sounds, and YouTube. A song does not interrupt speech already playing; speech arriving during a song waits. Make that behavior clear in queue feedback. Priority interruption, mixing, and resume are future work.

Proposed configurable pilot defaults:

- YouTube disabled until configured and its provider smoke test passes.
- Maximum video length: 15 minutes; reject live, upcoming, unknown-duration, unavailable, and restricted videos.
- Maximum 20 pending YouTube tracks per guild and three per requester. Cap combined pending YouTube duration at 60 minutes. Add a separate generous bound for the complete queue after auditing existing TTS behavior.
- Five-second requester cooldown; bounded provider concurrency across guilds.
- Metadata/search timeout: 15 seconds; preparation timeout: 30 seconds; stream inactivity timeout: 20 seconds. Tune from measured behavior.
- No playlists, autoplay, looping, seeking, persistent queue restoration, or bulk downloads in the first release. A video URL containing playlist parameters queues that video only; playlist-only links receive a clear error.
- Retain the existing voice disconnect policy. Never disconnect a channel still needed by TTS or announcements.

## 4. Provider and playback architecture

Introduce `backend/bot/youtube_provider.js` behind a small interface:

```text
parseInput(query) -> canonical video ID or bounded search phrase
search(query, signal) -> bounded metadata results
getVideo(videoId, signal) -> validated title, channel, duration, URL
openAudio(videoId, signal) -> readable audio stream + input type + dispose()
```

Start with a **yt-dlp adapter candidate**, validated in a short Windows and deployment-host spike before committing to its command arguments or binary version. Keep it isolated so provider changes do not alter queue semantics. yt-dlp's current YouTube support requires an external JavaScript runtime and challenge-solving components; provision and pin these alongside the executable, rather than assuming Node being installed is sufficient. See the [official runtime documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

Use maintained release artifacts, record versions/checksums, and update deliberately. No automatic tool installation or self-update inside a slash command. Official YouTube search is an alternative metadata adapter, with separately configured credentials and quota handling; it does not itself supply playable audio. See [YouTube search documentation](https://developers.google.com/youtube/v3/docs/search/list).

Resolve the actual audio stream **when the item reaches the head**, so queued signed URLs do not expire before playback. Pass a readable stream to the existing voice resource pipeline, with FFmpeg conversion only where needed. Verify the packaged FFmpeg path on both target platforms. Bound buffering and clean up stream/process resources after every terminal outcome.

Treat provider unavailability as an expected operational error: report it, finalize the item, and continue the queue. Do not introduce account-cookie collection or access-restriction workarounds. A provider spike must demonstrate playback of an available test video before enabling the feature; availability cannot be guaranteed for every YouTube video.

## 5. Queue model and lifecycle repair

Preserve compatibility fields used by current views (`id`, `text`, `options`, `guildName`) while adding typed source metadata:

```text
id, guildId, voiceChannelId, requestedByUserId, requestedByName
source: TTS | AUDIO_MP3 | YOUTUBE
title, canonicalUrl?, videoId?, durationSeconds?, enqueuedAt
state: QUEUED | PREPARING | PLAYING | COMPLETED | SKIPPED | CLEARED | ERROR
```

Keep runtime connections, streams, child processes, abort controllers, and signed URLs out of IPC snapshots and database metadata.

1. Give each running item an execution token and AbortController.
2. Route idle, player error, preparation failure, timeout, skip, and clear through one idempotent finalizer.
3. Finalization removes the item only if its ID and execution token still own the active slot. Late callbacks cannot remove or stop a newer item.
4. Skip/clear abort preparation, stop the owned player resource, destroy streams, terminate owned child processes, and detach item listeners/timers.
5. After each await, check cancellation and ownership before subscribing or playing.
6. Register completion/error listeners before starting playback. Use actual playback state for PLAYING, not successful enqueue or stream creation.
7. A watchdog terminates playback and records ERROR, rather than claiming completion. Bound YouTube playback by validated duration plus startup grace.
8. Return an awaited enqueue result such as `{ success, id, position, reason }`. Distinguish duplicate, full, channel conflict, and invalid source. Migrate both object and positional callers without breaking TTS producers.

Preserve existing stored status values where possible. Audit database constraints before adding PREPARING or new source metadata; a migration is needed only if the existing schema requires it. Queue runtime remains in memory and is not restored after restart.

## 6. Voice ownership, controls, and input handling

- One active voice channel per guild queue. Reject requests from another channel while playback or pending work exists; do not move the bot away from listeners.
- Centralize connection reuse across `/yt`, `/play`, TTS, and IPC producers so another producer cannot silently move the shared connection. Recheck channel state after asynchronous metadata work.
- Wait for a ready voice connection before playing. Disconnect, loss of permissions, and externally moved connections cancel the active execution cleanly.
- Skip is available to the current requester in the same channel or a member with Manage Guild. Clear requires Manage Guild. Existing authorized dashboard controls retain their scope. Enforce these rules server-side, including component actions.
- Parse links with URL APIs; accept exact supported YouTube hosts and recognized video paths, extract a video ID, and reconstruct a canonical HTTPS URL. Reject credentials, unexpected ports, arbitrary hosts, malformed links, and playlist-only URLs.
- Treat strings that look like unsupported URLs as errors rather than sending them to a generic extractor. Bound searches to 200 characters and links to 2,048 characters.
- Spawn the configured executable with an argument array and `shell: false`. Ignore ambient extractor configuration, constrain extraction to YouTube, and never interpolate user input into shell commands or output paths.
- Apply provider timeouts, bounded output, and cancellation. Do not log signed stream URLs, authorization data, or raw provider dumps.
- Bind search selections to user, guild, voice channel, and an opaque request ID; enforce one successful enqueue even on double clicks or repeated interactions.

## 7. Implementation sequence

### A — Queue foundation

Refactor `audio_queue.js` around execution ownership, cancellation, and one finalizer. Normalize source types and repair the asynchronous enqueue contract. Migrate callers in `bot.js` and `play.js`; retain TTS/local playback. Add race regression tests before introducing external streams.

### B — Provider spike and adapter

Implement input parsing and injectable search/metadata/stream adapters. Prove link resolution, Thai/English search, audio conversion, cancellation, and child-process cleanup on Windows and the deployment host. Document exact dependencies and environment settings. Fail startup diagnostics clearly when the feature is enabled but dependencies are missing.

### C — `/yt` command

Add `commands/utility/yt.js`, required `query`, guild-only handling, deferred ephemeral responses, voice checks, search selection/cancel/expiry, limits, and duplicate-interaction protection. Confirm existing command discovery and component routing before choosing the handler registration mechanism. Deploy the command to a test guild before wider registration.

### D — Playback and queue visibility

Connect YOUTUBE preparation to the shared player. Update `/queue` and sanitized queue IPC snapshots to show source, title, requester, duration, and real state. Add skip and correct clear wording/permissions. Update existing guild/developer queue UI consumers only where their TTS-only assumptions require it; no new web player is needed.

### E — Verification and rollout

Run isolated mocked tests, existing audio/voice announcement tests, command serialization checks, and applicable app checks if UI code changes. Enable in one test guild for explicit manual playback. Record dependency versions and observed failure behavior. Roll back by disabling new YouTube requests and cancelling YouTube items cleanly while allowing TTS/local items to continue.

## 8. Acceptance tests

| Area | Required evidence |
| --- | --- |
| Input | Watch/short/share links; playlist parameters; malformed/arbitrary URLs; oversized input; Thai and English queries |
| Search | No results; timeout; selection expiry; wrong user; double click; voice change before selection |
| Permissions | No voice channel; missing Connect/Speak; other-channel request; unauthorized skip/clear; guild-only handling |
| Playback | Track longer than 60 seconds plays through; next TTS/local/YouTube item starts once; duration and source display correctly |
| Races | Skip/clear during extraction, during playback, and alongside idle/error; enqueue immediately after clear; late completion never starts cleared work |
| Resources | No leaked child processes, streams, timers, listeners, or temporary files after completion/error/cancellation/shutdown |
| Failure | Provider rejection; unavailable video; unknown duration; lost voice connection; stream stall; FFmpeg failure; logging failure does not stall playback |
| Limits | Concurrent requests cannot exceed count/duration limits; cooldown and search concurrency apply before expensive work |
| Regression | Existing TTS, `/play`, announcement playback, and authorized dashboard queue controls retain their behavior |

Automated tests use mocked providers, voice connections, players, and database logging. Manual YouTube/Discord playback uses an explicitly selected test guild and test video; do not make real network playback part of ordinary unit tests.

## 9. Definition of done

- `/yt query:<link>` queues one validated video and plays its audio.
- `/yt query:<search>` lets the requester choose a result and queues exactly once.
- All source types share the queue and voice ownership rules.
- Skip, clear, errors, and disconnects cannot corrupt queue order or leak processes.
- Queue feedback reflects preparation/playback accurately and provides useful EN/TH errors.
- Provider dependencies, configuration, test results, and disable procedure are documented.

Suggested follow-ups after stable playback: pause/resume with explicit TTS behavior, requester remove controls, optional per-guild duration settings, and queue wait estimates. Defer playlists and autoplay until resource limits and everyday playback reliability are proven.

## 10. Implementation record

Implemented surfaces:

- `backend/bot/youtube_provider.js`: strict link parsing, bounded search and metadata, cancellable `yt-dlp` streaming, process cleanup, and a startup binary check.
- `backend/bot/audio_queue.js`: typed YouTube items, synchronous enqueue results, FIFO execution ownership, cancellation, a single finalizer, duration and inactivity watchdogs, voice-loss handling, resource cleanup, whole-process shutdown cleanup, queue limits, and fail-closed provider readiness.
- `commands/utility/yt.js`: localized `/yt query:<link/search>`, deferred ephemeral replies, voice and permission checks, requester-bound result selection, cooldown/concurrency controls, and safe queue confirmation.
- `commands/utility/queue.js`, `commands/utility/skip.js`, and `commands/utility/stop.js`: source-aware queue view plus one shared authorization policy for every skip/clear command path.
- `backend/bot/voice_connection.js`, `commands/utility/play.js`, `commands/utility/say.js`, and `backend/bot/bot.js`: shared connection creation/readiness cleanup, voice-channel ownership, the repaired enqueue contract, startup dependency diagnostics, and shutdown cleanup.
- `backend/database/database.js`: audio state is finalized by the runtime lifecycle instead of being falsely marked complete by age during reads.
- `tests/audio-queue.test.js` and `tests/youtube-audio.test.js`: mocked queue races, watchdogs, provider boundaries, command selection, serialization, and control authorization.
- `scripts/youtube-provider-smoke.js`: an opt-in live check that resolves metadata, passes the provider stream through the same Discord voice/FFmpeg resource pipeline, receives bounded output bytes, cancels the extractor, and prints no signed media URLs.
- `scripts/youtube-pilot-preflight.js`: a no-network, fail-closed rollout check that restricts enablement to exactly the selected guild and verifies the pinned extractor digest, executable/runtime readiness, and packaged FFmpeg before command deployment.
- `scripts/command-deployment-target.js` and `deploy-commands.js`: explicit full-command test-guild deployment with validated configuration and a nonzero exit on invalid rollout configuration; global deployment requires an argument-free invocation, while unknown or duplicate flags fail before any Discord request.
- `app/components/Tabs/AudioQueueTab.js` and `app/developer/page.js`: dashboard queue views prefer source titles and show lifecycle state, source, known duration, and requester; canonical YouTube titles link to the safe source URL.

### Deployment configuration

The feature is fail-closed. It remains unavailable unless this is set:

```dotenv
MEGU_YOUTUBE_ENABLED=1
MEGU_YOUTUBE_GUILD_IDS=123456789012345678
MEGU_DISCORD_TEST_GUILD_ID=123456789012345678
YT_DLP_PATH=C:/tools/yt-dlp/yt-dlp.exe
MEGU_YOUTUBE_YTDLP_SHA256=66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a
YT_DLP_JS_RUNTIME="node:C:/Program Files/nodejs/node.exe"
```

Use an official `yt-dlp` release executable so the matching EJS challenge scripts are bundled. The Windows pilot uses [official release `2026.08.19`](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19); `yt-dlp.exe` was verified against the release's `SHA2-256SUMS` entry with SHA-256 `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`. Repeat checksum verification whenever provisioning another host. Do not use `yt-dlp -U` during bot startup or a slash command. The Windows host has Node `v24.14.0`, which satisfies the documented Node 22+ runtime floor, and packaged FFmpeg exists at `node_modules/ffmpeg-static/ffmpeg.exe`. The pinned executable is provisioned in the ignored `tools/yt-dlp/` runtime directory and is never committed to Git.

Supported tuning variables and defaults:

| Variable | Default | Bound / purpose |
| --- | ---: | --- |
| `MEGU_YOUTUBE_MAX_DURATION_SECONDS` | `900` | Maximum accepted video duration. |
| `MEGU_YOUTUBE_GUILD_IDS` | empty | Optional comma-separated pilot allowlist; empty enables every guild when the feature flag is on. |
| `MEGU_DISCORD_TEST_GUILD_ID` | empty | Required only by `npm run deploy:guild`; selects the one guild that receives the complete current slash-command set for pilot testing. |
| `MEGU_YOUTUBE_YTDLP_SHA256` | empty | Required by `npm run youtube:preflight`; pins the provisioned executable to the deployment owner's verified asset digest. |
| `MEGU_YOUTUBE_METADATA_TIMEOUT_MS` | `15000` | Metadata/search process timeout. |
| `MEGU_AUDIO_PREPARATION_TIMEOUT_MS` | `30000` | Maximum time any queue source may spend preparing before it is aborted and the queue advances. |
| `MEGU_YOUTUBE_STREAM_INACTIVITY_MS` | `20000` | Stop a stream that produces no bytes. |
| `MEGU_YOUTUBE_PROVIDER_CONCURRENCY` | `4` | Global concurrent metadata/search jobs; clamped to 1–20. |
| `MEGU_YOUTUBE_USER_COOLDOWN_MS` | `5000` | Requester cooldown before provider work. |
| `MEGU_YOUTUBE_GUILD_QUEUE_LIMIT` | `20` | YouTube items per guild queue. |
| `MEGU_YOUTUBE_USER_QUEUE_LIMIT` | `3` | YouTube items per requester. |
| `MEGU_YOUTUBE_GUILD_DURATION_SECONDS` | `3600` | Combined queued YouTube duration. |
| `MEGU_AUDIO_QUEUE_MAX_ITEMS` | `100` | Complete shared audio queue limit. |
| `MEGU_AUDIO_VOICE_DISCONNECT_GRACE_MS` | `5000` | Grace period for a transient Discord voice disconnect before active playback is cancelled. |

### Enablement checklist

1. Download the pinned official `yt-dlp` asset and its `SHA2-256SUMS`; verify the asset before placing it on the host.
2. Run `yt-dlp --version` as the service account. When the feature flag is enabled, the bot verifies `MEGU_YOUTUBE_YTDLP_SHA256` before executing the binary, repeats the version check at startup, and logs a clear dependency error without exposing requests.
3. Configure Node 22+ explicitly with `YT_DLP_JS_RUNTIME=node:<absolute path>`, or provision supported Deno and use `deno:<absolute path>`.
4. Keep legacy `MEGU_DISCORD_TEST_MODE` disabled: that older mode intentionally accepts only the payment test command and would filter `/yt`.
5. Run `node tests/youtube-audio.test.js`, `node tests/audio-queue.test.js`, and `node tests/voice-announce.test.js`.
6. Set `MEGU_YOUTUBE_YTDLP_SHA256` to the digest verified for the provisioned platform asset and run `npm run youtube:preflight`. It fails unless the feature is restricted to exactly `MEGU_DISCORD_TEST_GUILD_ID`, the executable hash matches, the absolute Node/Deno runtime passes, and packaged FFmpeg exists.
7. Run `node scripts/youtube-provider-smoke.js` (or `npm run youtube:smoke`) as the service account. This performs a deliberate live request using a short public test video, proves voice-ready bytes pass through packaged FFmpeg, then cancels and cleans up.
8. Run `npm run deploy:guild`, and verify the complete current slash-command set was registered only in that guild. The existing `npm run deploy` remains the deliberate global-registration path. Then test one short public video plus one Thai and one English search.
9. Verify `/queue view`, requester skip, manager skip/clear, stream cancellation, next-item playback, and empty-channel disconnect behavior.
10. Roll back immediately by setting `MEGU_YOUTUBE_ENABLED=0`; already queued work can be cleared through the existing authorized queue controls.

Verification on 2026-09-13:

- `youtube-audio.test.js`: 29 checks passed.
- `audio-queue.test.js`: 24 checks passed.
- `voice-announce.test.js`: 47 checks passed.
- `server-tabs-ui.test.js`: all 13 server tools retain the shared responsive/accessibility contracts, including YouTube queue metadata coverage.
- `locales.test.js`: 16 checks passed with English/Thai registry behavior intact.
- All 23 discovered slash-command definitions serialized successfully.
- New backend, command, provider, and deployment modules passed focused ESLint; `backend/bot/bot.js` passed Node syntax validation; and all changed files passed `git diff --check`. The repository's current ESLint parser does not parse JSX, so the production Next.js build is the executable UI gate.
- `node deploy-commands.js --guild` exited with code 1 before any Discord request when `MEGU_DISCORD_TEST_GUILD_ID` was absent, confirming the test-guild rollout path fails closed.
- `npm run youtube:preflight` has both passing-fixture coverage and a real missing-configuration check that exits with code 1; startup and the live smoke independently enforce the configured extractor SHA-256 digest.
- The Next.js 16.3.0 production build compiled and prerendered successfully after the dashboard queue update.
- The final Windows live-provider/voice-pipeline smoke was repeated against the current script and passed with checksum-verified `yt-dlp 2026.08.19`, explicit Node `v24.14.0`, packaged FFmpeg, video `jNQXAC9IVRw` (`Me at the zoo`, 19 seconds), and 32,809 voice-ready output bytes received before intentional cancellation.
- The bounded flat-search path was also exercised live with the same checksum-verified release: `Me at the zoo` returned four playable results and `เพลงช้าง 1 นาที` returned five playable results after duration/live filtering. The temporary executable was removed after the check.
- The pinned executable was provisioned persistently at the configured absolute path and its SHA-256 matched the pinned release digest. Pilot preflight passed on the deployment host.
- All 23 slash commands were registered through the explicit guild-only route in Discord guild `467655562658578432`; no global command deployment was performed.
- The user completed a real `/yt` playback in that guild and confirmed that the requested track played successfully in voice.
