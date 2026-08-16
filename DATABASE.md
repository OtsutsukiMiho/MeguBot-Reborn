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

Core is namespaced and non-destructive, which is what makes sharing safe:

- every table it creates is prefixed `megu_`
- every statement is `CREATE TABLE IF NOT EXISTS`, so re-running is a no-op
- no query in `core/` or `adapters/` touches a table without that prefix, and
  there is no `DROP`, `TRUNCATE`, or unscoped `DELETE` anywhere in either

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

It prints row counts for the four legacy bot tables (`guild_variables`,
`user_nicks`, `reminders`, `audit_logs`) and for every `megu_*` table. On a
fresh project the `megu_*` ones will error, which is expected — they do not
exist yet.

**Write the legacy numbers down.** They are how you prove afterwards that
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

- the four legacy tables must show **exactly the numbers you wrote down**
- the `megu_*` tables now exist and read `0 rows`

If a legacy number moved, stop and investigate — nothing in this codebase
should be able to do that.

---

## What gets created

Eleven tables and fourteen indexes, all prefixed `megu_`:

```
megu_users          accounts
megu_identities     Discord ID -> Megu user
megu_activities     the root entity
megu_participants   who is in an activity
megu_slots          candidate times
megu_slot_votes     availability answers
megu_periods        one row per month, for recurring agreements
megu_expenses       what was spent
megu_shares         who owes what part of an expense
megu_payments       claims and confirmations
megu_reminders      what was sent, and when
```

Created by `core/schema.js`, which runs on boot from both `backend/bot/bot.js`
and `backend/web/web.js`. Running it twice is harmless.

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

## Rolling back

Nothing here alters an existing table, so removing Megu's data is a matter of
dropping what it made. Order matters — foreign keys point inwards:

```sql
DROP TABLE IF EXISTS
  megu_reminders, megu_payments, megu_shares, megu_expenses,
  megu_slot_votes, megu_slots, megu_periods, megu_participants,
  megu_activities, megu_identities, megu_users
CASCADE;
```

The bot's own tables are untouched by this and keep working.

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
