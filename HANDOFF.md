# Megu — handoff

Branch: `feat/megu-core`

## Two products, one bot

`/servers/*` is the bot console for server admins; `/activities` and `/a/<CODE>`
are the group activity product for ordinary members, who need no Discord
permission and — on `/a/<CODE>` — no Discord account at all. They share an
identity and a process tree, nothing else. Both sit at the top level of the
nav on purpose; neither is a sub-feature of the other. `/dashboard` used to
mean both and now permanently redirects to whichever one the URL meant.

## Start it

```bash
docker compose up -d     # local Postgres on 55432
npm test                 # 4 suites, ~1.2s
npm run db:seed          # demo activity, prints /a/<CODE>
```

Then two processes:

```bash
node backend/web/web.js  # Express API on 3001
npx next dev -p 3100     # web on 3100
```

Ports come from `.env` and must not be improvised: `NEXT_PORT=3100`,
`EXPRESS_PORT=3001`. `DISCORD_REDIRECT_URI` points at **3100**, not 3001,
because `next.config.js` proxies `/api/*` from Next through to Express. Running
Next on any other port breaks the OAuth callback.

## Databases are separated

| | Where | Holds |
|---|---|---|
| `MEGU_DATABASE_URL` | local Docker Postgres | everything new (`megu_*`) |
| `DATABASE_URL` | Supabase | the live bot's existing tables |

Core reads `MEGU_DATABASE_URL` first and falls back to `DATABASE_URL`. In
production leave it unset and core rejoins the main database.

`npm test` refuses to run unless core points at a local database.

**Supabase was rolled back.** The seven `megu_*` tables created during the first
round of testing were dropped; `guild_variables` (3), `user_nicks` (33),
`reminders` (1) and `audit_logs` (50) were verified unchanged before and after.
`npm run db:audit` re-checks any database on demand.

## What needs you

These could not be verified without your own Discord account:

1. **The OAuth round trip.** Log in at `/api/auth/login`, then check the server
   log prints `Megu | <name> claimed N past activities` and that
   `/api/megu/me` returns a `user` plus your servers. Everything downstream of
   the callback is tested; the callback itself needs a real Discord session.
2. **`canManage` against a real server.** Confirm a server where you are only a
   member appears in the list without settings, and one where you are admin
   appears with them.
3. **The bot process.** `/api/megu/me` asks the bot which guilds it is in over
   IPC. Running `web.js` alone means that list is empty, so servers show as
   "ยังไม่มี Megu". Run the full `npm run dev` to see it correctly.

## The two axes

Plan and money run independently. This is the single most important idea in
the model and the thing the first design got wrong.

    plan   open → confirmed → done, or cancelled
    money  none → open → settled     (derived, never stored)

A badminton court has a known price before anyone plays; a dinner bill only
after. Making money the last stage of one pipeline forced an order that is
wrong half the time. `settlement()` derives the money state from the rows it
summarises, so it can never drift out of step with them.

Recurring agreements (`kind: 'recurring'`) skip the plan axis entirely and
carry `megu_periods` instead — one row per month, each settling on its own.

## Everything is correctable

A ledger nobody can fix is a ledger nobody can trust, and until recently every
route was a POST — a typo or a wrong amount was permanent. Owners can now
rename and remove people, hand a claimed name back, edit or delete an expense,
and undo a confirmation.

Two guards matter:

- Removing someone is **refused** while money is attached to them. Deleting the
  row would silently change what everyone else owes, which is the exact quiet
  wrongness this product exists to prevent.
- Editing an expense recomputes the split from scratch rather than patching it,
  so the shares always sum back to whatever the amount now is.

`tests/corrections.test.js` walks the realistic disaster: ฿4,000 typed instead
of ฿400, a misspelt name, the wrong person confirmed as paid, the wrong person
tapping a name.

## Why the UI was redesigned twice

The first two passes looked designed and read badly. Three things were wrong,
and only one of them was taste:

1. **The display face carried no Thai glyphs.** Measured, not guessed: Thai set
   in Fraunces came out at exactly the same width as generic serif, while Latin
   differed. Every Thai heading had been silently falling back to a system
   serif, so the editorial identity was invisible to the people this is built
   for. Anuphan replaced it — one voice across Thai and Latin.
2. **Dot leaders read as a fax, not a product.** Elegant in isolation, but a
   page of dotted rules is noise, and the empty middle of every row destroyed
   hierarchy. Rows now carry an avatar, a name, a sub-line and a figure.
3. **Nothing anchored the page.** No colour, no image, no focal point. The
   activity page now opens on a navy card with the one number the reader came
   for — what they owe — set large, with the pay button beside it.

Separation comes from filled surfaces and real corner radius now, which is what
"แบ่งให้ชัด" and "เข้าถึงง่าย" were actually asking for.

## The console runs on a token bridge

The bot console (`/servers/*`, `/developer`, everything in `app/components/Tabs/`)
was written against an earlier dark-only palette. This branch replaced
`globals.css` wholesale, which left those fifteen files referencing tokens that
no longer existed — they were rendering against undefined variables.

Rather than freeze the console in the old palette or rewrite every file, the
old token names live on at the bottom of `globals.css` as aliases onto the
current ones (`--text-secondary: var(--muted)` and four more). The console
therefore inherits this design system and gained a light theme it never had.

The ~350 hardcoded hex literals in those files were mapped to tokens in the
same pass. Four kinds of literal are deliberate and must stay:

- **Colours sent to Discord.** `presetColors` in `RoleManagerTab` and
  `EmbedCreatorTab`, the `ColorPicker` palette, and its default prop are role
  and embed colours posted to the API. A `var(--accent)` here reaches Discord
  as a literal string. A blind find-and-replace put tokens in all three; if you
  run one, exclude these.
- **`#000000` comparisons** in the role pickers — Discord's "no colour"
  sentinel, not a colour we paint with.
- **The Discord message previews** in `WelcomeTab` and `EmbedCreatorTab`
  (`#2b2d31`, `#dbdee1`, `#5865f2`) — they imitate Discord's own chrome, which
  does not follow our theme.
- **The log terminal** in `/developer` (`#0d1117` on `#c9d1d9`) — a terminal
  that inverts with the page stops reading as a terminal, and its level colours
  are calibrated for that ground.

**Discord role colours are never used as text.** A role's colour is chosen to
look right on Discord's own dark chrome; as label text on our panel it lands
wherever it lands. Measured on a light panel: Discord green `#57F287` gives
1.36:1 and yellow `#FEE75C` gives 1.21:1 — invisible. So in `MemberManagerTab`,
`RoleManagerTab` and `AutoroleTab` the role colour goes on the dot beside the
name and the name itself is `var(--ink)` (15:1+ light, 9.7:1+ dark). The hue
still identifies the role; the word stays readable.

Tints built from a role colour use `color-mix(in srgb, ${hex} 14%, transparent)`
rather than appending alpha digits to the hex. The old `${hex}14` form silently
produces invalid CSS the moment `hex` is anything but a six-digit literal.

Audit-log category badges got real tokens instead (`--cat-pink` … `--cat-tint`).
They are the one place hue is decorative rather than meaningful, so they are
the one place carrying an explicit value per theme. The originals were picked
for a dark-only page and measured about 2:1 in light; all seven are in
`npm run contrast` now and clear 4.5:1 in both themes.

## Readability is measured, not judged

`npm run contrast` reads the colour tokens straight out of `globals.css` and
measures every foreground/background pair we actually use, in both themes,
against WCAG. `npm test` runs it with `--strict`, so a palette change that
makes something unreadable fails the build like any other regression.

The first run failed nine pairs, all in the light theme, including the two
that matter most — the amount someone owes (`--rose`, 4.07:1) and Megu's own
label (`--gold-deep`, 3.58:1). Dark passed everything, which is why the
problem was easy to miss while working at night.

Weights are per-theme too (`--w-body` … `--w-heavy`): light text on a dark
ground optically gains weight, so the dark theme sets each step lower to land
at the same apparent weight.

## The time poll

The wedge from the badminton story: nobody in a group chat wants to be the one
who says "right, Saturday 7pm then." Megu holds the candidate times, collects
availability, and calls it.

Scoring deliberately punishes a veto harder than it rewards a yes
(`no: -3` against `yes: +2`), and slots are ranked by fewest objections before
score. The goal is a time nobody is blocked on, not the most popular one — in
`tests/poll.test.js` that picks Saturday 19:00 over a slot with more total
enthusiasm but two people who cannot make it.

Locking the winner sets `starts_at`, moves the plan to `confirmed`, and marks
anyone who voted no on that slot as not coming — so nobody has to ask them.

## Reminders

`core/reminders.js` decides who is late and writes the statement;
`adapters/discord/reminder-sender.js` opens the DM. The bot arms an hourly
loop on ready. One person gets one message per cooldown covering everything
they owe across every group — a statement, not a pile of pokes. Only people
with a linked Discord account are reachable; the rest are skipped rather than
silently counted as reminded.

## What is deliberately absent

Frozen out of V0, per the scope we agreed:

- PromptPay QR and slip verification — `megu_payments.method` accepts them,
  only `manual` is implemented
- A `Group` entity — activities are the root; groups emerge later from repeats
- Discord slash commands for activities (the bot only sends reminders so far)
- Automatic month rollover — a new period opens when the owner asks for it,
  not on a schedule

## Layout

```
core/                    knows nothing about Discord, HTTP or React
  activities.js          activity, participants, expenses, shares, payments
  users.js               accounts, multi-provider identity, participant merge
  money.js               satang integers; splits always sum back to the total
  auth/access.js         the two permission domains
  megu/voice.js          every line Megu says, in one place
  reminders.js           who is late, and the statement she sends them
adapters/
  discord/oauth.js       token exchange and profile reads
  http/megu-api.js       REST over core, mounted at /api/megu
  discord/reminder-sender.js   opens the DM and records delivery
app/
  a/[code]/page.js       public activity page, no login required
  activities/page.js     organizer view — the group/money product
  servers/page.js        server list
  servers/[guildId]/page.js    the bot console — automod, welcome, roles, TTS
  components/MeguMark.js the cat, as vector
  components/ThemeToggle.js    light / dark / system
tests/                   npm test
scripts/                 seed-demo, db-audit
```

## Two rules worth keeping

**Server permissions never reach activity money.** Discord roles decide who
configures the bot in a guild. Nothing else. A guild administrator who is not in
an activity sees no amounts — there is a test for exactly this.

**A claim is not a payment.** Pressing "จ่ายแล้ว" writes a `pending` row. Only
the owner, or later a verified transaction, moves it to `confirmed`.

## Bugs found and fixed during the build

- Roster order shuffled between loads: `now()` in Postgres is the transaction
  timestamp, so every participant inserted together shared it to the
  microsecond. Added an explicit `position` column.
- `.page-title` carried `flex: 1`, which stretched the heading down the page
  inside any column layout.
- Megu said "เหลือ X คนเดียว" when more than one person was outstanding.
- The navbar overflowed below ~400px.
- Server card avatars flew to the page corner: the card had no
  `position: relative`, so the absolutely positioned avatar resolved against
  the viewport.
- Dark mode put white text on light fills. `--navy` and `--royal` were flipped
  for dark (correct for text) but also used as solid backgrounds. Fills now use
  `--brand-*` tokens that never flip; only ink and accent tokens do.
- `markSent` stamped the database clock, which made the reminder cooldown
  untestable without waiting a real day. The caller passes the time now.

## Verifying

```bash
npm test      # 50 checks across 4 suites, ~1.2s against the local container
npx next build
```

`tests/recurring.test.js` is the one to read first: it demonstrates money
opening while the plan is still gathering answers, which the old model could
not express.
