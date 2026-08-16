# `feat/megu-core` vs `main`

Written to be read before deciding how to merge. Six commits, `68 files
changed, +9001 / −1181`, no divergence — the branch is 6 ahead and 0 behind, so
this is a fast-forward and a normal PR works.

> One correction worth recording, because it wasted time: the **local** `main`
> is a stale single squashed commit with no shared history, and comparing
> against it reports "no merge base". `origin/main` is the real base and shares
> history at `09d06b0`. Always diff against `origin/main`.

---

## What this branch is

Two things happened here, and they are separable if you want to split the PR.

**1. A second product was added.** Everything under `core/`, `adapters/`,
`tests/`, `app/a/`, `app/activities/` is new: a group activity manager — plan a
hangout, split the bill, chase people for money. It shares the bot process and
nothing else.

**2. The existing bot console was repaired and rebranded.** It had been left
rendering against CSS variables that no longer existed. That was not a
cosmetic problem; see "Bugs found" below.

---

## Bugs found and fixed along the way

These were pre-existing on `main` and are the strongest argument for merging
rather than cherry-picking the features.

| | What was wrong | Where |
|---|---|---|
| **Console rendered against undefined variables** | An earlier redesign replaced `globals.css` wholesale and left 15 files referencing 5 tokens that no longer existed, plus ~350 hardcoded colours written for a dark-only page. | `app/components/Tabs/*`, `app/developer/` |
| **16 classes were used but never defined** | Including `.tab-btn` — the console's own tab rail — and `.toast-notification`, so every save confirmation rendered as bare text in the document flow. | `app/globals.css` |
| **Frosted glass was dead everywhere, navbar included** | `lightningcss` treats `backdrop-filter` and its `-webkit-` prefix as equivalent and keeps whichever is written **last**. Ours had the prefix last, so the bundle shipped only the prefixed form, which current Chrome no longer honours. Measured: prefixed-only computes to `none`. Three surfaces were flat. The fix is declaration order. | `app/globals.css` |
| **Guild presence failed silently** | `/api/guilds` asks the bot over IPC which servers it is in. Run `web.js` standalone and there is no IPC channel, so every server reported "no Megu" — indistinguishable from genuinely not being installed, and the UI then offered to invite a bot that was already there. Now returns `botOnline` and a three-state `isBotInGuild`. | `backend/web/web.js` |
| **Audit-log badges were unreadable in light mode** | Category colours chosen for a dark-only page measured ~2:1 once a light theme existed. Now real per-theme tokens, and in the contrast audit so a regression fails the build. | `app/globals.css`, `AuditLogsTab` |
| **Discord role colours used as label text** | A role's colour is picked to look right on Discord's dark chrome. As text on our panel, Discord green measured **1.36:1** and yellow **1.21:1**. The hue moved to the dot; the name is now `--ink`. | `MemberManagerTab`, `RoleManagerTab`, `AutoroleTab` |
| **Hero was clipped** | `overflow-x: clip` on the page wrapper pinned the full-bleed hero back to the column, and the headline landed on the clip edge with its first letter sliced off. | `app/globals.css` |

---

## Routing — breaking, but covered

`/dashboard` used to mean two different products and only one had a nav entry.

| Was | Is |
|---|---|
| `/dashboard` | `/activities` |
| `/dashboard/:guildId` | `/servers/:guildId` |
| — | `/servers` (new: the server picker) |

Both old paths **permanently redirect**, so links already sent to a group chat
keep working. The OAuth callback target moved from `/#dashboard` to
`/activities`.

---

## Rebrand

"Megu Reborn" / "MeguBot Reborn" → **Megu**, by **Megux Corp**. Covers the
Discord presence string, `/uptime`, `package.json`, page metadata, footer and
README.

**Not covered, and it cannot be from code:** the bot's account name is set in
the Discord Developer Portal. It still reads `MeguBot Reborn#6977` until
someone changes it there. `public/icon.png` is likewise still the old artwork
at 1.4 MB; `icon.svg` (~700 bytes) is the favicon now, and the png survives
only for platforms that refuse SVG.

---

## What to check before merging

1. **Two databases.** `core/` reads `MEGU_DATABASE_URL` first and falls back to
   `DATABASE_URL`. In production leave it unset so core rejoins the main
   database. `npm test` refuses to run unless core points at a local one.
2. **`config.json` carries `lastLoggedDate`**, which the bot rewrites at
   runtime. It is tracked, so it shows as dirty after every run. Worth moving
   runtime state out of a config file.
3. **`tests/e2e.test.js` hardcodes `E:/MeguBot-Reborn-main`** in its first two
   lines. Anyone cloning elsewhere cannot run it.
4. **`/api/guilds/:guildId` still has the silent-IPC bug** that was fixed on
   the list endpoint (`backend/web/web.js`, the `isBotInGuild` line). If IPC
   fails there, the console opens with every dropdown empty and no explanation.
5. **`three` is a real new dependency** (~600 KB) for the landing page's 3D
   mark. It is `ssr: false` and dynamically imported, the flat SVG ships in the
   HTML as the fallback, and the canvas stops rendering once scrolled past —
   but if the bundle size is unacceptable, deleting `MeguScene.js` and its one
   import leaves a working page.

---

## Verification

`npx next build`, `npm test` (4 suites), and `npm run contrast --strict` all
pass. The contrast audit reads the colour tokens out of `globals.css` and
measures every pair used, in both themes, so a palette change that makes
something unreadable fails the build like any other regression.

Layout and motion were verified by probing `elementFromPoint()` at real
coordinates rather than reading `getBoundingClientRect()`. That distinction
matters: the clipped-hero bug above measured as *passing* under
`getBoundingClientRect`, because the layout box really was full width — it just
was not painted there.
