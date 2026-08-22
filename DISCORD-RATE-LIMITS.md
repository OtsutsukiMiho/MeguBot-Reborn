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

The bot process uses it through `discordCall()` in `backend/bot/bot.js`, which is
the only way that process is allowed to reach Discord. It asks the guard, makes
the call, and hands anything that fails back to the guard. For a long time the
bot had no guard at all — so while the site correctly showed "we are blocked, do
not retry", the other half of the deploy was still editing a heartbeat message,
pulling audit logs on every event and fetching member rosters, straight into a
ban that lengthens under traffic.

**A swallowed failure is a missing guard.** Every one of those calls was written
`.catch(() => undefined)`. That is a reasonable way to say "a closed DM is not an
incident" and a catastrophic way to say "we were refused" — nothing logged,
nothing recorded, and the next caller repeats it. If a Discord call can fail,
its failure goes to `guard.record()` before it is discarded.

The same rule applies to you, at the keyboard. **While blocked, do not
redeploy.** A redeploy is a restart, a restart is a fresh IDENTIFY, and the
timer starts over. Stop the service, wait an hour, then deploy the fix.

#### The guard is per-process, so it is shared through the supervisor

The ban is on the IP. It applies to the bot, the web process and anything else
on the box — but each holds its own guard in memory, and would otherwise only
learn about the block by sending the request we are trying not to send.

Whichever process is refused first reports it to `index.js`, which is the only
thing here that outlives its children. The supervisor holds the deadline, pushes
it to everyone, and answers `discord_block_query` from a child that has just
started. Without that, a web process could crash mid-block, come back with a
clean guard, and start sending people to Discord again inside the same ban —
which is how fifteen minutes became an afternoon.

`index.js` also refuses to restart the bot into a live block, whatever killed it.

### 3b. Never let the REST client retry on its own

This one is not in your code, it is in `@discordjs/rest`, and it is the single
most dangerous default involved. Its handler for an unexpected 429 is:

```js
await sleep(retryAfter);
return this.runRequest(routeId, url, options, requestData, retries);
```

`retries` is passed through, **not incremented**. There is no cap on that path.
As long as Discord keeps answering 429 the request sleeps and sends again,
forever — and the promise never settles, so no `.catch()` above it ever runs.

A Cloudflare block answers 429 to everything, without Discord's rate-limit
headers, so `retryAfter` comes out zero. A zero-length sleep in an uncapped loop
is a busy loop, against an IP that was banned *for sending too much*, with
nothing in the logs to say so.

The client is therefore constructed with a `rest` block:

```js
rest: {
    retries: 1,
    globalRequestsPerSecond: 25,
    rejectOnRateLimit: (data) => shouldStopForRateLimit(data),
}
```

`isSevereRateLimit()` in `adapters/discord/rate-limit.js` is the decision. A
short, known per-route wait is ordinary traffic management and is slept through.
A global limit, a wait longer than a few seconds, or a 429 with no usable wait
attached fails the call instead — and three of those inside a minute trips the
guard, on the grounds that stopping voluntarily for fifteen minutes beats being
stopped involuntarily for an hour.

If you construct another `Client` or a bare `REST` anywhere, it gets the same
block.

### 4. Sign-in is a click, never a redirect

An expired session used to redirect the browser to `/api/auth/login`, which
redirects to Discord — and since the app is already authorised, Discord bounces
straight back with a fresh code. So every timed-out background tab silently ran
a full OAuth round trip. In the outage logs the first token exchange lands seven
seconds after a session timeout, which is precisely that.

Expired sessions now land on `/`, where there is a login button. A human decides
when to sign in.

### 5. Check every response before you read it — and keep the body

The callback read `/users/@me` and `/users/@me/guilds` straight into `.json()`
without checking status. A block arrived as an error object, `userData.id` came
out `undefined`, and a session was written for a user with no identity — a bug
that only surfaces later, far from its cause. Check `res.ok`, feed the body to
the guard, and stop.

**The body is the only place the block identifies itself.** It arrives as an
ordinary failed response carrying `{"code":0,"message":"You are being blocked
…"}`, and `isGlobalBlock()` matches on that sentence. `adapters/discord/oauth.js`
once threw a tidy summary instead:

```js
if (!res.ok) throw new Error('Failed to read Discord profile.');   // body gone
```

which reads like good hygiene and is the exact opposite. The guard could no
longer recognise the block, so the user got a generic error — and the obvious
response to a generic error is to click sign in again. Every failed Discord
`fetch` puts `await res.text()` in the error it throws.

The same applies to a `catch` that ends a feature quietly.
`restoreDiscordConnection()` swallowed the block whole and set
`discordReconnectRequired`, which the site renders as a *reconnect Discord*
button — an invitation to click, straight back into the ban.

### 5b. Sessions survive a restart

Sessions live in Postgres (`adapters/http/pg-session-store.js`), not in the web
process. This is a rate-limit rule, not a storage one: `MemoryStore` emptied on
every restart, which signed out every user at once, and every one of them
signing back in is an OAuth round trip. One restart produced a burst of Discord
traffic proportional to how many people were using the site, and a restart loop
multiplied it.

It also broke sign-ins already in flight — `beginOAuth()` keeps the OAuth state
in the session, so anyone sitting on Discord's authorize page during a restart
came back to "this sign-in request expired" and started the whole round trip
again.

`SESSION_SECRET` must still be set. Without it the cookies are signed with a
fresh key each boot, so the rows survive but nobody can present a cookie that
matches them, and you are back to the stampede.

### 6. Assume the IP is shared, and behave like it

Render's shared tiers put your outbound traffic behind an IP you share with
other services, and Discord polices datacenter ranges hard. You can be blocked
for a neighbour's behaviour, which is why none of this reproduces locally.

You cannot fix that in code — you can only make sure you are not the one causing
it, and never the one prolonging it. If blocks keep happening after everything
here is followed, the fix is infrastructure: a plan with a dedicated outbound
IP, or a host with a clean one.

### 7. Do not ask Discord the same expensive question twice

`GET /guilds/{id}/members?limit=1000` is the heaviest thing this bot asks for,
and the dashboard used to ask twice per page load — once for the server
overview, once when the Member Manager tab opened. Three refreshes was six full
roster pulls, uncached, on one of the tightest per-guild buckets there is.

`fetchGuildRoster()` caches for a minute and serves the last good roster when a
fetch fails, including while blocked. A stale member list is a far better answer
than an empty one, and a minute of staleness is invisible in a settings screen.

Watch for loops, too. Reaction-role setup without a channel id searched *every*
text channel for the message, one request each, as fast as the loop could issue
them — a hundred-request burst for one click. It is capped at 25 now and stops
the moment it is refused, but the real fix is passing the message link so there
is nothing to search for.

## Before merging anything that touches Discord

- [ ] No `setInterval` or recursive `setTimeout` under 5 minutes makes a Discord
      call.
- [ ] Any repeating call sends something that actually changed since last time.
- [ ] Every `login()` and every `fetch` to `discord.com` has a failure path that
      is not "immediately try again".
- [ ] Every Discord call in the bot goes through `discordCall()`; no new
      `.catch(() => undefined)` around one.
- [ ] New failure paths call `guard.record()` so a block shuts the feature down
      instead of amplifying, and failed `fetch`es keep `await res.text()` in the
      error so the guard can recognise it.
- [ ] Any new `Client` or `REST` sets `rejectOnRateLimit`. The default retries
      an unexpected 429 forever.
- [ ] Nothing redirects a browser into `/api/auth/login` automatically.
- [ ] Boot-time Discord work (`bulkDelete`, command registration, channel
      fetches) is cheap enough to survive a restart loop.
- [ ] Nothing loops over guilds, channels or members issuing a request per item
      without a cap and a blocked-check.
- [ ] `npm test` — `rate-limit.test.js` covers the guard, `session-store.test.js`
      covers sessions outliving a restart.

## Watching for it

`client.rest.on('rateLimited')` logs the pre-emptive waits — our own bucket
accounting saying "hold on". A 429 coming back from Discord does not emit that
event at all; those are logged by `shouldStopForRateLimit()` with the route that
caused them. Both are the early warning; the Cloudflare block is what happens
after they are ignored. If either line starts appearing regularly, find the
caller before it escalates.

`npm run bot:instances` answers the other question worth asking first: is more
than one copy of the bot running on this token? Two instances on one IP double
every number in this document.

It reads the `[hostname#pid.hex]` stamp the bot appends to the audit rows it
writes — `stamp()` in `backend/bot/bot.js`. Anything written often enough to be
a useful sample should go through it. Slash commands alone were not: thirty days
of them came to twenty-one rows, and a whole day could pass with none, which
reads as "nothing is running" while the bot is up and busy. TTS carries the
stamp for that reason, and the web layer strips it back off before the dashboard
shows the line.

The report groups by instance with the window each was seen in, and says which
pairs overlap. Read that distinction carefully — it is two different problems:

- **Overlapping** windows are one token on several gateways. Both copies receive
  every event and both answer it, and they share one global request budget.
- **Consecutive** windows are the same service being restarted, redeployed, or
  woken from sleep. Each one is a fresh gateway IDENTIFY plus all the boot-time
  work, which is its own kind of traffic — a service that hibernates produces
  this all day without anyone deploying anything.

## Known remaining risk

The IP is still shared, and still not ours (rule 6). Everything above makes sure
we are not the cause and never the one prolonging it; none of it helps if a
neighbour on the same Render address is the one being banned. If blocks keep
happening with all of this in place, the remaining fix is infrastructure — a
plan with a dedicated outbound IP, or a host with a clean one.

`next dev` on a deploy is the other one to watch. It compiles on demand and
holds several times the memory of `next start`, so on a small instance it gets
killed and restarted, and every restart of these processes is another IDENTIFY
and another round of boot-time Discord calls. `index.js` warns when it sees
`PORT` set without a production build; set `NODE_ENV=production` and run
`npm run build` during deploy.
