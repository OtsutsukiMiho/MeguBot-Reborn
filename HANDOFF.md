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
npm test                 # isolated sibling database (`*_test`), ~6s
npm run ocr:setup        # the slip/receipt reader into public/ocr (once)
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
| `MEGU_DATABASE_URL` | local Docker Postgres | core's own tables |
| `DATABASE_URL` | Supabase | the live bot's existing tables |

Core reads `MEGU_DATABASE_URL` first and falls back to `DATABASE_URL`. In
production leave it unset and core rejoins the main database.

`npm test` derives `megu_dev_test` (or reads `MEGU_TEST_DATABASE_URL`) and
refuses any host that is not local or any database name without the `_test`
suffix. Destructive migration coverage therefore cannot touch `megu_dev`, even
when a test file is invoked directly.

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
carry `periods` instead — one row per month, each settling on its own.

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

## Paying

A PromptPay QR is a string, not a transaction. `core/promptpay.js` builds the
EMVCo payload — the PromptPay AID in field 29, the amount in field 54, a
CRC-16/CCITT checksum in field 63 — and `qrcode` renders it. No gateway, no
merchant account, no fee, because none of that is involved in *encoding* a
request for ฿60. What costs money is the bank telling you it arrived, and that
is the part we do not have.

The V0 flow is optimistic and reversible:

    exact QR → transfer → mandatory slip → strict match → auto-confirm
                                                ↘ exception → owner review
    cash/offline payment → owner records receipt → owner-confirmed

`slip_matched` deliberately does not mean `bank_verified`. Megu has no bank API.
The server decodes the uploaded slip pixels itself, re-parses the checksummed
QR, refuses a duplicate reference, and compares its own OCR reading to the
exact expected amount, configured receiver name, and a plausible Bangkok
timestamp. Browser-supplied OCR fields are ignored. A five-month-old transfer is allowed
and flagged; an impossible future clock or any mismatch stays pending. The
sender's bank-account name is evidence only — somebody else may transfer for
the debtor. If the owner checks their bank and the optimistic result is wrong,
they reverse it with a required reason and the debtor is notified.

One payment has child rows in `payment_allocations`: one transfer can cover
several recurring periods, and several partial transfers can cover one period.
The payment and every state change also write append-only `payment_events`.

**The thing that is easy to get wrong.** The person paying is holding the phone
the QR is displayed on, and a phone cannot scan its own screen. Saving the
image to the photo library and letting the banking app read it from there is
the primary path in Thailand, not a fallback — so the pay screen offers an
explicit save button (share sheet on iOS, download elsewhere), a long-press
hint, and the number and amount as separate copy buttons for anyone who would
rather type. A QR alone would fail for most of the people this is built for.

Two rules the code enforces rather than assumes:

- **The full number never renders.** `payTo.masked` goes on screen and
  `payTo.number` goes to the clipboard, and both are gated behind the same
  `viewAmounts` check that hides everyone's balances — a forwarded link gets
  neither. Screens end up in screenshots; clipboards do not.
- **The QR keeps a white ground in dark mode.** `.pay-qr` carries its own
  background rather than the theme's. An inverted code is one a good many Thai
  banking apps quietly fail to read, and the person holding the phone has no
  way to know the theme is why.

The original slip is normalized to a bounded JPEG first, stripping EXIF/GPS,
then kept as temporary `bytea` readable only by payer/payee while an exception
is pending. Forged image MIME headers and oversized pixel surfaces are refused.
The server renders its own standardized evidence PNG
from an allow-list (bank, reference, names, last four account digits, amount,
date/time); it never trusts a client-provided derivative. A final decision
deletes the raw image immediately, and boot-time retention deletes unresolved
raw images after seven days. Structured evidence, allocations and audit events
remain.

## Reading pictures

Three things arrive as photographs now, and they are worth very different
amounts. Confusing them is the mistake this part of the codebase is arranged to
prevent.

| | Source | Worth |
|---|---|---|
| The account on a saved PromptPay QR | EMVCo payload, checksummed | Exact. `promptpay.readQr` |
| The bank and reference on a slip | The slip's own QR, checksummed | Exact. `core/slip.js` |
| The amount, date and dish names | OCR on a photograph | **A reading.** `core/receipt.js` |

**Importing an account.** `promptpay.readQr` is `buildPayload` run backwards.
The number is already in the picture the bank saved for its customer, and
asking somebody to copy thirteen digits by hand is asking for the one
transposed pair that quietly pays a stranger — a wrong account does not fail,
it succeeds at the wrong destination. It refuses with a reason per case, and the
reasons matter: a shop's bill-payment id (field 30) is fifteen digits and so is
an e-wallet id, so only the tag they arrive under tells them apart. Read by
length alone, a shop's code would be saved as a person's and look perfectly
fine. An amount baked into the imported QR is reported and then dropped, out
loud, because keeping it would fix every future request at whatever they were
paid once.

**The slip's QR carries no amount.** It is a nested TLV under tag `00` — API
type `000001`, sending bank, transaction reference — with its checksum under
`91` rather than the `63` a PromptPay QR uses, and resolving it into an actual
amount needs a bank's API, which costs money and an account and which Megu
deliberately does not have. What it gives is an *identifier*, and that is
enough for the one automatic check with teeth. Two things the code insists on:
the reference is namespaced (`th-bank:004:…`) because two banks may issue the
same number and a bare collision would tell an innocent person their slip was a
duplicate; and some banks print the checksum with its leading zeros stripped,
which is padded back before comparison — otherwise the bug reads as "the app
hates SCB".

**OCR proposes; the policy may accept optimistically.** A complete strict match
can mark a transfer paid, but the stored verification level remains
`slip_matched`, never `bank_verified`, and every result is reversible. Receipt
scanning remains form-fill only: it never adds expenses without a person
committing the edited proposal.

The one signal worth leaning on is `reconciles`: when the lines read off a bill
add up to the total read off the same bill, two independent readings agree.
That is the same argument as a checksum, and it is the only thing on the panel
that gets colour.

**Two non-obvious things, both verified rather than assumed.**

- Tesseract defaults to `SINGLE_BLOCK`, which *silently deletes the amount* on
  a bank slip: the figure is set two or three times larger than everything
  around it and layout analysis discards it as an outlier. The text comes back
  containing "Amount:" with nothing after it — no error, no warning. A slip is
  one column at many sizes, so `app/lib/receipt.js` sets `SINGLE_COLUMN`.
- The engine is served from this origin, not a CDN. `npm run ocr:setup` copies
  the worker and the LSTM cores out of `node_modules` and downloads the `_fast`
  language data into `public/ocr/` (gitignored, ~22MB on disk, of which a
  browser fetches one core and the languages it needs). It runs as part of
  `npm run build`. Without it the reader reports itself unavailable and every
  other part of the page carries on — an unread slip is still a slip a human
  can look at.

PromptPay account import and receipt preview decode in the browser. A payment
slip is different: the phone still shrinks it to a few hundred kilobytes, but
the server normalizes and decodes those pixels again because editable client
JSON cannot authorize an automatic payment. Server decoding is bounded to
40 megapixels and the normalized JPEG strips source metadata before temporary
storage.

## Two languages, and how not to freeze one in

English leads and Thai follows — reversed from the original decision, because
the link travels further than the group it started in. `app/copy/{en,th}.js`
hold the interface copy, `core/megu/voice.js` holds Megu's own lines in both,
and `core/format.js` holds everything built from data. `tests/copy.test.js`
fails the build when the two dictionaries drift apart, including when a phrase
that takes a value forgets to print it.

The bug worth remembering: `periods.label` used to store `"สิงหาคม 2569"`,
written on the day the month opened. A stored rendering cannot be re-rendered,
so every month created before the switch would have kept its language forever.
The key (`2026-08`) is the fact and the label is a view of it, so the API now
sends `period.key` and the browser formats it. The column still exists and is
no longer read.

`core/format.js` also fixed a live bug on the way past: month boundaries are
Bangkok's now, not the server's. `periodKeyFor` used `getUTCMonth`, so a period
opened at 02:00 on the first of September in Thailand was filed under August.

## Reminders

`core/reminders.js` decides who is late and writes the statement;
`adapters/discord/reminder-sender.js` opens the DM. The bot arms an hourly
loop on ready. One person gets one message per cooldown covering everything
they owe across every group — a statement, not a pile of pokes. Only people
with a linked Discord account are reachable; the rest are skipped rather than
silently counted as reminded.

## What is deliberately absent

Frozen out of V0, per the scope we agreed:

- Bank-verified payments — strict slip matches are optimistic and reversible;
  `bank_verified` is reserved for a future provider/API
- A `Group` entity — activities are the root; groups emerge later from repeats
- Passive Discord channel scanning — payment intake is explicit `/จ่าย` with a
  required attachment; ordinary messages are never treated as financial input
- Automatic month rollover — a new period opens when the owner asks for it,
  not on a schedule

## Layout

```
core/                    knows nothing about Discord, HTTP or React
  activities.js          activity, participants, expenses, shares, payments
  users.js               accounts, multi-provider identity, participant merge
  money.js               satang integers; splits always sum back to the total
  promptpay.js           the EMVCo QR payload, and nothing that talks to a bank
  format.js              months, dates and money, per language, from keys only
  auth/access.js         the two permission domains
  megu/voice.js          every line Megu says, in one place
  reminders.js           who is late, and the statement she sends them
adapters/
  discord/oauth.js       token exchange and profile reads
  http/megu-api.js       REST over core, mounted at /api/megu
  discord/reminder-sender.js   opens the DM and records delivery
app/
  copy/{en,th}.js        every word of the interface, one shape, two languages
  components/PayPanel.js the QR, the save button, the number, the slip
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

**A claim is not a payment.** Pressing "จ่ายแล้ว" writes a `pending` row. A
bank transfer needs a slip and either a strict optimistic match or owner review;
cash needs an explicit owner action. `confirmation_source` and
`verification_level` must always explain why a confirmed row counts.

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
npm test      # all suites against an isolated local `*_test` database
npm run build # vendors the OCR engine, then next build
```

`tests/recurring.test.js` is the one to read first: it demonstrates money
opening while the plan is still gathering answers, which the old model could
not express.
