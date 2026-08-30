# Database setup

How to point Megu at a Supabase project — yours or someone else's — from
nothing. Written so it can be followed on a fresh project without reading any
other file.

## The decision this document assumes

**One database.** Core stores its data in the same Postgres the bot already
uses. The alternative — a second database just for activities — was considered
and rejected: it does not remove the risk people expect it to, and it charges
you two backups, two restores and two things that can be down independently,
every day, forever.

The risk it was supposed to remove is connection exhaustion, and that is not
caused by sharing a database. It is caused by unbounded pools, which follow you
to any database you move to. That is fixed directly instead — see
[Connections](#connections).

Core's tables carry plain names — `users`, `activities`, `payments` — because
they are the product's own data. The Discord bot's four tables
(`guild_variables`, `user_nicks`, `reminders`, `audit_logs`) are the ones that
belong to a single adapter, and they are what should eventually move into a
schema of their own; core will not have to follow when they do.

Sharing is safe because core is additive, not because of how anything is
spelled:

- core creates its own tables and never reads or writes the bot's four
- every statement is `CREATE TABLE IF NOT EXISTS`, so re-running is a no-op
- there is no `DROP`, `TRUNCATE`, or unscoped `DELETE` in `core/` or `adapters/`

The one name both sides wanted is `reminders`. The bot has had it for years and
keeps it: a row there is a message scheduled into a Discord channel. Core's is a
record of a payment nag that was sent, so it is called `payment_reminders`.

---

## 1. Get the connection string

Supabase → **Project Settings → Database → Connection string → URI**.

You will be offered more than one. Which you pick matters:

| Port | What it is | Use it? |
|---|---|---|
| **5432** | Direct connection | **Yes.** Megu is a long-lived process, which is what direct connections are for. |
| 6543 | Transaction pooler (pgbouncer) | Also fine, and safer if you are near your plan's connection limit. Core's transactions work through it — each one is a single checked-out client. |

Either works. If you are unsure, take **5432**.

It looks like:

```
postgresql://postgres:YOUR-PASSWORD@db.PROJECT-REF.supabase.co:5432/postgres
```

## 2. Set the environment

In `.env`:

```
DATABASE_URL=postgresql://postgres:...@db.PROJECT-REF.supabase.co:5432/postgres
```

**Leave `MEGU_DATABASE_URL` unset.** Core reads it first and falls back to
`DATABASE_URL`, so leaving it empty is what makes core share the bot's
database. It exists so development and tests can run against a local container
without ever touching production — see [Development](#development).

TLS is handled for you. `core/db.js` detects a non-local host and enables SSL;
you do not need `?sslmode=require` in the URL.

## 3. Record what is there before you start

```bash
npm run db:audit
```

It prints row counts for the four Discord bot tables (`guild_variables`,
`user_nicks`, `reminders`, `audit_logs`) and for each of core's. On a fresh
project core's will read `n/a`, which is expected — they do not exist yet.

**Write the bot's numbers down.** They are how you prove afterwards that
nothing was disturbed.

## 4. Start it

```bash
npm run dev
```

On boot the bot and the web process each print which database they reached,
with the password masked:

```
[Bot] Core database: postgresql://postgres:***@db.PROJECT-REF.supabase.co:5432/postgres  (remote)
[Bot] Megu core schema verified.
```

`(remote)` confirms you are on Supabase and not a local container. If it says
`(local)` you still have `MEGU_DATABASE_URL` set somewhere.

## 5. Verify nothing was disturbed

```bash
npm run db:audit
```

- the four bot tables must show **exactly the numbers you wrote down**
- core's tables now exist and read `0 rows`

If one of the bot's numbers moved, stop and investigate — nothing in this
codebase should be able to do that.

---

## What gets created

Nineteen tables and twenty-five indexes:

```
users                     accounts
identities                a provider login -> Megu user, one per provider
user_aliases              a merged account's old id -> the account that absorbed it
account_merges            who merged which two accounts, and what moved
notification_preferences  where this person wants to be told
oauth_credentials         sealed Discord refresh tokens
notification_events       one thing worth telling somebody about
notification_deliveries   one row per channel, with its own retries
activities                the root entity
participants              who is in an activity
slots                     candidate times
slot_votes                availability answers
periods                   one row per month, for recurring agreements
expenses                  what was spent
shares                    who owes what part of an expense
payments                  claims and confirmations, and who the money went to
payment_allocations       one transfer split across several months
payment_events            the append-only history of a payment
payment_reminders         which nag was sent, and when
```

Created by `core/schema.js`, which runs on boot from both `backend/bot/bot.js`
and `backend/web/web.js`. Those are separate forked processes and they boot at
the same time, so the whole thing runs inside one transaction behind a Postgres
advisory lock: the second process waits, then finds every guard already false
and does nothing. Running it twice is harmless, and a failure part-way through
rolls back rather than leaving the schema half-built.

### If your database predates this naming

Core's tables used to be prefixed `megu_`, and `payment_reminders` used to be
`megu_reminders`. `core/schema.js` renames them on boot, along with the indexes
and constraints that would otherwise keep carrying the old name. Every step is
guarded, so it does nothing on a fresh database and nothing on the second boot
of a migrated one. Data is not copied or rewritten — Postgres renames are a
change to the catalogue only.

Nothing is renamed *to* `reminders`, so the bot's table of that name is never
in the path.

### If your database predates `payments.creditor_participant_id`

A payment used to record who paid and not who was paid, because the product
assumed one person collected for the whole activity. That column is added on
boot like every other, nullable, and existing rows keep their NULL.

NULL means *unknown*, not *nobody*. `settlement()` recognises those rows and
reconstructs them at read time — spending each payer's unattributed money
against their largest debt first — and reports `hasLegacyPayments` so a screen
can say the figure was reconstructed rather than read. Balances are unchanged
by this: the per-person `outstanding` every screen and every reminder shows is
computed from who paid, never from who was paid.

To place those rows properly:

```
node scripts/backfill-payment-creditor.js            # dry run, prints what it would do
node scripts/backfill-payment-creditor.js --commit   # writes
```

It infers a creditor from the destination frozen onto the payment first, then
from the activity's payee, then from the owner's roster row — and leaves the
row alone when none of those produce an answer. Every row it writes also gets a
`creditor_backfilled` row in `payment_events` naming the basis it used, because
a guess written into financial history without a trail is indistinguishable
from a fact.

**Row Level Security does not apply here.** Megu connects as the `postgres`
role over a direct Postgres connection, which bypasses RLS. RLS only governs
access through Supabase's own API with an anon or authenticated key. If you
later expose these tables through PostgREST you will need policies; until then
you do not.

---

## Connections

This is the part that actually protects the database, and the reason a second
database was not needed.

`index.js` forks two processes. Each opens core's pool **and** the legacy bot's
pool, so there are four pools against one database. At pg's default of ten per
pool that is **forty connections**, and a web process stuck in a crash-loop
would keep opening more until the database refused everyone — the exact failure
people are afraid of when they hear "shared database".

Each pool is now capped:

```
max                       5      up to 20 connections in total, from 40
idleTimeoutMillis     10 000     idle connections are handed back, not held
connectionTimeoutMillis 8 000    an unreachable database errors instead of queueing
```

Override with `PG_POOL_MAX` if you ever need to; it applies to both pools.

If your plan's connection limit is tight, use the **6543** pooler URL from
step 1 and you can leave the cap where it is.

---

## Development

To work locally without touching production, point core somewhere else:

```bash
docker compose up -d          # Postgres on 55432
```

```
MEGU_DATABASE_URL=postgresql://megu:megu@localhost:55432/megu_dev
```

Core now uses the container and the bot still uses `DATABASE_URL`. `npm test`
**refuses to run** unless core is pointed at a local database, so the suite
cannot reach production by accident.

```bash
npm run db:seed               # a demo activity; prints its /a/<CODE>
```

---

## Deploying to the cloud

Production is Supabase, and the way you get there is by **not** setting one
variable:

| Variable | Set it to | On the cloud host |
|---|---|---|
| `DATABASE_URL` | the Supabase URI | **set** |
| `MEGU_DATABASE_URL` | a local container | **leave unset** |

That is the whole switch. Core reads `MEGU_DATABASE_URL` first and falls back to
`DATABASE_URL`, so an unset `MEGU_DATABASE_URL` is what makes core and the bot
share one database. The most common deploy mistake is copying the whole local
`.env` up, which carries `MEGU_DATABASE_URL=...localhost...` with it — core then
tries to reach a container that does not exist on that host, and activity
features come up dead while the bot itself looks fine.

Boot prints which one it reached, with the password masked. `(remote)` is what
you want:

```
[Bot] Core database: postgresql://postgres.PROJECT-REF:***@aws-0-REGION.pooler.supabase.com:5432/postgres  (remote)
```

**Which Supabase URI.** Prefer a pooler host (`...pooler.supabase.com`) over the
direct `db.PROJECT-REF.supabase.co` one. The direct host resolves over IPv6, and
plenty of cloud runtimes still only give you IPv4 — a deploy that works locally
and fails with `ENETUNREACH` in production is almost always this. Both pooler
ports work here: **5432** is session mode and behaves like an ordinary
connection, **6543** is transaction mode and is the safer pick if you are near
your plan's connection limit.

**Set `PG_POOL_MAX` if the host runs more than one instance.** The cap is per
pool and `index.js` opens two per process, so one instance is up to twenty
connections. Two instances is forty. See [Connections](#connections).

**The first boot on Supabase is the one that migrates.** If that project still
has `megu_*` tables, the rename described above happens the first time the bot
or the web process starts there. It is one transaction behind an advisory lock,
so it either completes or rolls back — but run the audit either side of it
anyway, because that is the run where you would want the before-and-after
numbers:

```bash
npm run db:audit              # read-only; safe against production
```

---

## Rolling back

Nothing here alters an existing table, so removing Megu's data is a matter of
dropping what it made. Order matters — foreign keys point inwards:

```sql
DROP TABLE IF EXISTS
  payment_reminders, payments, shares, expenses,
  slot_votes, slots, periods, participants,
  activities, identities, users
CASCADE;
```

The bot's own tables are not in that list and keep working.

---

## Troubleshooting

**`MEGU_DATABASE_URL or DATABASE_URL is required for Megu core`**
Neither is set. The bot itself still runs — `web.js` catches this and logs it —
but activity features are off until one is provided.

**Boot says `(local)` when you expected `(remote)`**
`MEGU_DATABASE_URL` is still set, probably in a shell that outlives the
terminal you edited `.env` in.

**`Core schema init failed`**
The role in your connection string cannot create tables. On Supabase the
`postgres` role can; a restricted role you made yourself may not.

**Servers all show "no Megu" in the web console**
Not a database problem. The web process asks the bot over IPC which servers it
is in, and running `backend/web/web.js` on its own has no IPC channel. Start
everything with `npm run dev` so `index.js` forks all three together.
