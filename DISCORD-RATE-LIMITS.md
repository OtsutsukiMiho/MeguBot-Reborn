# Discord rate limits: the rules

On 18 August 2026 the deploy went dark. Every sign-in failed, for every user, at
once:

```
[System] OAuth2 token exchange failed: {"code":0,"message":"You are being
blocked from accessing our API temporarily due to exceeding global rate limits."}
```

This document is what was learned. Read it before writing anything that talks to
Discord on a timer, in a loop, or at boot.

## The failure this prevents

`code: 0` is not a Discord API error. Discord's errors have real codes and, when
you are rate limited, a `retry_after` telling you exactly how long to wait for
one route. This has neither, because it does not come from Discord's API at all
— it comes from **Cloudflare, in front of `discord.com`, banning the server's IP
address**.

Three things follow from that, and all three are why this outage is worse than
an ordinary 429:

- **It is per-IP, not per-token or per-application.** A second bot token does
  not help. Neither does a new Discord application. Everything leaving the box
  is refused: the gateway, the REST API, and the OAuth token exchange that the
  website's login depends on. That is why a bot problem logged everyone out of
  the site.
- **Nothing tells you how long.** No header, no `retry_after`. In practice it
  clears in about an hour.
- **Retrying extends it.** This is the part that turns a five-minute annoyance
  into an afternoon. Traffic sent while blocked counts against you, so a process
  that reacts to the block by trying again is holding the block open.

## The rules

### 1. Never call Discord on a short timer

The presence update in `bot.js` ran every 5 seconds and re-sent an unchanged
status. Discord's limit is **5 presence updates per 60 seconds per session**;
that was 12 a minute, forever. The `online_ping` heartbeat edited one message
every 3–9 seconds, roughly 10,000 edits a day, for a timestamp nobody was
watching.

Neither was a burst. Both were steady, permanent, pointless load, and that is
exactly the shape Cloudflare bans.

- Presence: **set it once**, on ready. discord.js keeps it on the client and
  replays it in the IDENTIFY payload, so reconnects restore it for free. Only
  send a new one when the content actually changed.
- Any recurring Discord call: **five minutes is the floor.** If you want it
  faster, you want an event instead — Discord will push it to you.
- Polling a database on a timer is fine. `reminders` does that every 5 seconds
  and only touches Discord when something is genuinely due. The rule is about
  Discord, not about timers.

### 2. A failed restart must back off

`client.login()` had no `.catch()`. A rejection killed the process silently,
`index.js` restarted it three seconds later, and it died again — a fresh gateway
IDENTIFY every three seconds, indefinitely. Once the block started, that loop
was what kept it alive.

- **Every** `client.login()` gets a `.catch()`. Recognise the block with
  `isGlobalBlock()` and exit with `BLOCK_EXIT_CODE`.
- Child restarts in `index.js` back off exponentially: 3s, 6s, 12s … capped at
  five minutes, reset only after a minute of healthy uptime. Nine crashes now
  span sixteen minutes instead of twenty-seven seconds.
- `BLOCK_EXIT_CODE` overrides the curve entirely and holds the process down for
  `BLOCK_COOLDOWN_MS` (15 minutes). Restarting into a block is the one action
  guaranteed to make it last longer.

### 3. Once blocked, stop — do not retry, do not redeploy

`adapters/discord/rate-limit.js` is the shared switch. Anything about to call
Discord asks it first:

```js
const { createBlockGuard } = require('./adapters/discord/rate-limit.js');
const guard = createBlockGuard();

if (guard.blocked()) return;          // do not touch Discord
// ... make the call ...
if (!res.ok) guard.record(await res.text());   // starts the cooldown
```

The web process uses it on both `/api/auth/login` and the OAuth callback, and
serves a page that says "try again in N minutes" **with no retry button**. The
button was the problem: a bare "Failed to exchange code" reads as *click login
again*, and each of those clicks was another round trip to Discord.

The same rule applies to you, at the keyboard. **While blocked, do not
redeploy.** A redeploy is a restart, a restart is a fresh IDENTIFY, and the
timer starts over. Stop the service, wait an hour, then deploy the fix.

### 4. Sign-in is a click, never a redirect

An expired session used to redirect the browser to `/api/auth/login`, which
redirects to Discord — and since the app is already authorised, Discord bounces
straight back with a fresh code. So every timed-out background tab silently ran
a full OAuth round trip. In the outage logs the first token exchange lands seven
seconds after a session timeout, which is precisely that.

Expired sessions now land on `/`, where there is a login button. A human decides
when to sign in.

### 5. Check every response before you read it

The callback read `/users/@me` and `/users/@me/guilds` straight into `.json()`
without checking status. A block arrived as an error object, `userData.id` came
out `undefined`, and a session was written for a user with no identity — a bug
that only surfaces later, far from its cause. Check `res.ok`, feed the body to
the guard, and stop.

### 6. Assume the IP is shared, and behave like it

Render's shared tiers put your outbound traffic behind an IP you share with
other services, and Discord polices datacenter ranges hard. You can be blocked
for a neighbour's behaviour, which is why none of this reproduces locally.

You cannot fix that in code — you can only make sure you are not the one causing
it, and never the one prolonging it. If blocks keep happening after everything
here is followed, the fix is infrastructure: a plan with a dedicated outbound
IP, or a host with a clean one.

## Before merging anything that touches Discord

- [ ] No `setInterval` or recursive `setTimeout` under 5 minutes makes a Discord
      call.
- [ ] Any repeating call sends something that actually changed since last time.
- [ ] Every `login()` and every `fetch` to `discord.com` has a failure path that
      is not "immediately try again".
- [ ] New failure paths call `guard.record()` so a block shuts the feature down
      instead of amplifying.
- [ ] Nothing redirects a browser into `/api/auth/login` automatically.
- [ ] Boot-time Discord work (`bulkDelete`, command registration, channel
      fetches) is cheap enough to survive a restart loop.

## Watching for it

`client.rest.on('rateLimited')` now logs every ordinary 429 with the route that
caused it. Those are the early warning; the Cloudflare block is what happens
after you ignore them. If that line starts appearing regularly, find the caller
before it escalates.

## Known remaining risk

Sessions live in express-session's default `MemoryStore`
(`backend/web/web.js`). Every restart signs everyone out, and everyone signing
back in is OAuth traffic. Under a restart loop that compounds. Moving to
`connect-pg-simple` on the existing Postgres would remove it — it needs a new
dependency and a session table, so it has not been done here.

`SESSION_SECRET` must be set in the environment for that to matter at all;
without it a fresh secret is generated each boot and the effect is the same.
