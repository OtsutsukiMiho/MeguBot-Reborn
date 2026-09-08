# Server dashboard tabs redesign plan

Route: `/servers/{id}` (`app/servers/[guildId]/page.js`)
Date: 2026-09-08
Status: Implemented in the current server dashboard redesign.
Scope: The content and interactions inside all 13 server tools, with minimal integration into the existing dashboard shell.

## 1. Direction and intended outcome

Make each tab feel like part of one calm, practical settings workspace. A person should immediately see what the tool does, the first useful control, and how its changes take effect. Replace dense custom panels with consistent settings rows, readable result lists, and focused editors.

Inherit Megu's existing visual identity: warm paper and forest accents in light mode, dark ink and sapphire accents in dark mode, Thai-capable typography, and Lucide icons. The redesign changes tab composition and interaction, not the product's identity.

Assumptions: administrators use multiple tools in one session; members primarily use Personal Settings; desktop and phone use are both important. These follow `PRODUCT.md` and the existing route. This is a recommended direction, not a user-tested result.

The earlier `SERVER_DASHBOARD_REDESIGN_PLAN.md` remains the shell reference. Keep the compact server context, searchable grouped rail, mobile tool selector, URL tab IDs, permission handling, and persistent server save bar already present in source. Do not add an Overview step before settings.

## 2. Current evidence and remaining friction

This plan is based on current tab source, shared workspace primitives, the earlier dashboard plan, `PRODUCT.md`, and `DESIGN.md`. No fresh rendered screenshots were captured for this planning task; visual observations below are source-based and need confirmation during implementation. Some shell descriptions in `DESIGN.md` predate the recent implementation; current route code is the baseline for that shell.

| Evidence in the current files | Design response |
| --- | --- |
| All tools use `TabWorkspace`, but several still contain large inline-styled panels and custom controls | Extend shared sections and fields so consistency reaches inside each tool |
| Welcome already has local tabs, disclosures, and a responsive preview | Use it as the editor reference; refine only gaps discovered during validation |
| Autorole separates humans and bots into large decorated panels | Use two compact role-assignment sections with clear add/remove controls |
| Automod has four rule choices, one shared violation response, and a conditional block list | Make the relationship between detection rules and their shared response explicit |
| Members and Nicknames use repeated member cards with search, filters, and pagination | Use compact desktop rows and labeled mobile records to improve comparison |
| Embed Creator exposes many optional fields alongside core content | Put message content first and disclose optional appearance and metadata |
| Reaction Roles saves mappings and triggers a Discord reaction through its own action | Give the action a precise label and preserve its independent persistence |
| Audio Queue combines playback state, queue operations, history, and injection forms | Separate current operations from history without duplicating tool navigation |
| Several tools still contain hardcoded English labels and small helper text | Translate all touched copy and establish a readable bilingual type scale |

## 3. One shared structure, three useful layouts

Every tool uses the existing shell heading as its only page title. Below it, show a short scope/status line only when it adds information, then the primary task. Avoid repeated introductions, decorative count cards, and banners above the controls.

### A. Settings layout

For Autorole, Automod, Honeypot, Voice automation, and personal preference sections.

```text
Auto moderation                         [shell heading]
Choose which messages Megu checks.
Changes use Save server settings.

Detection rules
------------------------------------------------------
Rapid message spam                         [switch]
Detect repeated messages sent in a short period.
------------------------------------------------------
Blocked words and phrases                  [switch]
  Words or phrases
  [multiline input                                  ]
------------------------------------------------------

Response to violations
Applies to all enabled rules.
[existing response choices                          ]
[specific consequence notice when needed]

Unsaved server settings              Discard   Save
```

Use a single column for related decisions. On wide screens, a field row may have a 200–240px label/help column and a flexible control column. Stack the row when the available content width is below approximately 680px. Do not squeeze fields merely because the browser itself is wide.

### B. List and focused editor layout

For Members, Roles, Nicknames, Reaction Roles, Audit Logs, and reminder lists.

```text
Members                                 [shell heading]
[Search members...                     ] [Refresh]
[All / Humans / Bots] [Sort]             Result count
------------------------------------------------------
Member              Roles                       Action
[avatar] Name       @Moderator, +2        Manage roles
[avatar] Name       @Member               Manage roles
------------------------------------------------------
Showing loaded results                 Previous  Next

Selected member editor, opened on demand:
Member identity
[Search roles...]
[ ] role      [x] role
Changes: add 1 role, remove 1 role
Cancel                                  Apply roles
```

Keep search closest to results. Place filters after search, with a clear reset when active. Use existing dialogs for bounded edits; use inline expanded rows for simple edits such as a nickname. Show destructive actions in a secondary action menu with explicit labels.

### C. Editor and preview layout

For Welcome & Goodbye and Embed Creator.

```text
Welcome & goodbye                       [shell heading]
[Welcome] [Goodbye]

Destination                   Example preview
[channel selector]            ------------------------
                              Example member / message
Message format                Preview of this draft
[Text] [Embed]                ------------------------
[Title, where applicable]
[Message editor           ]
[Insert variable]
Appearance [expand]
```

Use roughly 60/40 editor-to-preview space when the content area is at least 900px wide. Otherwise stack the preview below core content. Keep optional appearance after the preview on narrow screens when DOM order can support that without confusing keyboard order. A preview may be sticky only when it fits within the usable viewport; long previews scroll with the document.

These wireframes show structure only. Their example content and counts are not real server data.

## 4. Design for each tab

### 4.1 Welcome & goodbye — `welcome`

- Keep the existing accessible Welcome/Goodbye tabs and both drafts. Show Off, Configured, or Unsaved as distinct concepts; selecting a destination in a draft must not imply the bot is already configured.
- Order fields: destination, Text/Embed format, core message, variables, optional appearance. Preserve every current placeholder and configuration key.
- Retain local preview and caret-aware variable insertion. Use readable preview text, including Thai; the preview should not become a miniature unreadable screenshot.
- Use color, thumbnail, image, footer, and timestamp controls inside labeled disclosures. Open any disclosure containing an error.
- Preserve content when a channel is disabled or the format changes. An unavailable destination remains visible until deliberately replaced.
- Persistence: existing global server save. Previewing never sends a Discord message.

### 4.2 Automatic roles — `autorole`

- Two divider-separated sections: **New human members** and **New bot accounts**. Each starts with its searchable role selector, followed by selected roles.
- Render selected roles as compact rows: color dot, full role name, and an accessible Remove action. Use role color as a small identity cue, never as the only readable text color.
- Empty text: “Choose roles to assign when a human member joins.” Use equivalent bot-specific copy in the second section.
- Exclude duplicates and preserve the existing `@everyone` restriction. Show unavailable roles with their IDs and a removal path; do not silently drop them.
- Preserve the legacy `autorole_id` and plural role-array behavior during migration. Removing an assignment here does not claim to remove roles from existing members.
- Persistence: global server save.

### 4.3 Reaction roles — `reactionroles`

- Start with existing mappings and an **Add reaction role** button. Show message reference, emoji, role, mode, status, and row actions. Group mappings by message when the loaded data supports it.
- Open an inline creation section in this order: message link/ID, channel when needed, emoji, assigned role, existing mode choices. Explain each supported mode in plain language without adding new modes.
- When a pasted link supplies the channel, display the resolved destination. Validate conflicting server/channel information before submission using existing validation contracts.
- Final action: **Add reaction role**, with nearby copy explaining that it saves the mapping and adds a reaction on Discord. Keep status toggles and removal as independent operations.
- Move **Clear all mappings** out of the main action position and retain a confirmation naming the affected scope. Describe only deletion effects the backend actually guarantees.
- Preserve the unsent creation draft across tool switches within the current server, or guard departure; do not invent an unsupported edit endpoint.

### 4.4 Members — `members`

- Desktop: compact member rows with avatar/name, username, role summary, and **Manage roles**. Put user ID in secondary details with Copy ID.
- Mobile: one member per labeled record; keep Manage roles visible. Collapse long role lists behind “Show all roles,” preserving keyboard access.
- Keep existing search, human/bot filter, sort, refresh, and pagination behavior. Label counts as loaded/matching results unless the API provides a verified total.
- Role editor: member identity, searchable role checklist, readable additions/removals summary, and **Apply roles**. Do not close or clear selections on failure.
- Preserve existing role restrictions and display reasons where known. A successful member action must not clear unrelated server drafts.
- Persistence: explicit per-member action, independent of server save.

### 4.5 Role manager — `roles`

- Start with search and **Create role**, then a table showing role name/color, supported properties, and actions. Avoid a separate card for each role.
- Reuse one role editor structure for create/edit: name, color, existing display and mention settings. Keep delete separate from save.
- Managed or otherwise restricted roles show the actual known reason an action is unavailable; retain server-side authorization.
- Keep page sizes 10, 30, 50, and 100. Preserve the current page after an edit when possible; clamp it after deletion.
- Confirm deletion with the exact role name and only verified consequences. No decorative permission score or fabricated member count.
- Persistence: explicit Create role / Save role / Delete role actions.

### 4.6 Nicknames — `nicknames`

- Present **Member**, **Discord name**, **Custom spoken name**, and **Actions** as aligned desktop columns. Stack with visible labels on mobile.
- Make the difference between a custom TTS nickname and a Discord profile name explicit.
- **Edit spoken name** expands a small inline form with Save and Cancel. **Reset to Discord name** names its result and preserves the existing reset operation.
- Keep search, filters, sorting, refresh, and pagination. Preserve a failed draft and show its error beside the input.
- Persistence: per-member nickname operation, independent of global server settings.

### 4.7 Auto moderation — `automod`

- Replace equal-weight choice tiles with four scan-friendly switch rows for the existing detection rules. Put the block-list editor directly below its enabled rule.
- Follow with one **Response to violations** section stating that the selected response applies to all enabled rules. Preserve current response choices and thresholds.
- Keep raw block-list text editable while typing; normalize it on validation/save rather than rebuilding the input on every comma or space. Preserve current matching semantics.
- Explain kick/ban consequences beside the relevant choice. Do not add presets, test enforcement, extra thresholds, or per-rule response settings without backend support.
- Persistence: staged automod save through the existing shared save flow. Partial success with other server settings must remain accurately represented.

### 4.8 Honeypot — `honeypot`

- One focused section: **Decoy channel**, destination selector, and an adjacent consequence notice visible before saving.
- Give Disabled an explicit option. Distinguish the draft destination from the saved configuration.
- Verify enforcement copy against bot code before shipping. Current UI says posting can cause a permanent ban and up to seven days of message removal; do not turn that source copy into an unverified promise.
- Help administrators choose a channel that ordinary conversation should never use. Do not claim visibility or permissions have been checked unless actual data proves it.
- Persistence: global server save; choosing a channel does not run a live trap test.

### 4.9 Voice automation — `tts`

- Break the long form into four sections: **Text channel**, **Voice and speech**, **Greetings and announcements**, **Limits and behavior**.
- Keep destination and voice selection first. Pair numeric/sliding controls with readable values and units; retain current limits and accepted values.
- Reveal room greeting, join announcement, and leave announcement editors under their respective switches. Preserve distinct settings and supported placeholders.
- Put lower-frequency behavior controls later in the page, retaining all existing capabilities. Disabled announcement editors retain their drafts.
- Do not add sample playback controls or new voice-provider calls. Voice greeting configuration remains available.
- Persistence: global server save.

### 4.10 Audio queue — `audioqueue`

- First show current playback state and the existing Skip action, then upcoming items with Remove. Keep **Clear queue** secondary and confirmed.
- Use compact local **Queue / History** tabs to reduce vertical competition. Preserve existing history status/search filters and distinguish an empty queue from a failed fetch.
- Keep text/audio injection as explicit **Add to queue** flows using supported inputs. Show the known destination before submission and state that the action affects playback.
- Preserve existing refresh/polling behavior without adding presentation-only polling. Keep focus and open editors stable when queue data changes.
- Do not show an animated progress bar or remaining duration unless the API provides usable timing data. Label stale data if a refresh fails.
- Persistence: immediate operational actions; the server save bar never queues or clears audio.

### 4.11 Embed creator — `embeds`

- Use the shared editor/preview layout. Primary content: title, description, and supported fields. Put author, links, images, color, footer, and timestamp in appropriate optional disclosures.
- Each field has clear Name/Value labels, an Inline control, and Remove. Preserve existing ordering; do not add drag-and-drop as a prerequisite.
- Display validation and length limits from the existing API/schema; verify those limits during implementation rather than inventing them in this plan.
- Put destination and **Send embed** together at the end of the editor, showing server and channel names. A visible initial destination summary may link to that section.
- Label preview as approximate/local. Failed images get a stable fallback, and preview formatting must use safe text/rendering rather than arbitrary HTML.
- Retain drafts across local tool switches within the same guild. Guard/reset explicitly on guild changes so a previous server's destination cannot carry over.
- Persistence: explicit Discord send. After an ambiguous network failure, explain that delivery is unconfirmed; do not automatically retry a potentially delivered message.

### 4.12 Audit logs — `audit`

- Compact filter bar followed by a readable event list/table: time, actor, action, target/details when supplied.
- Visually emphasize the action and target; show metadata and identifiers in expandable details. Keep event types searchable using existing filters.
- Distinguish no loaded events, no filter matches, loading, and errors. State when search only covers loaded records; current fetch requests up to 150 entries.
- Refresh preserves filters and usable records. Do not add unsupported date-range controls, export, server-wide search, or analytics charts.
- Persistence: read-only.

### 4.13 Personal settings — `personal`

- Begin with whose preferences are being edited and the current server. Use three sections: **Spoken name**, **Announcements**, **Reminders**.
- Spoken name: one input, **Save spoken name**, and a clear reset action. Announcement controls retain their existing immediate-save behavior with local saving/error feedback.
- Reminders: readable list with message, scheduled time, channel, recurrence, and delete; creation opens a focused form using existing time parsing and channel requirements.
- Explain the timezone and schedule interpretation supported by the application. Show a resolved time only when the current parser/API can supply it reliably.
- Preserve member access without displaying unavailable admin navigation. For administrators, pending server settings remain visibly separate from personal actions.
- Persistence: existing personal endpoint operations, not global server save.

## 5. Consistent interaction rules

| Interaction | Required behavior |
| --- | --- |
| Staged server settings | Existing global save bar names affected tools; Discard resets only unsaved changes in that scope |
| Independent editor | Own explicit submit action; local draft survives failures and local navigation or is protected by a clear departure guard |
| Immediate toggle | Label its immediate effect, show pending state, block duplicates, and restore the previous value if rejected |
| Successful request | Announce success after acknowledgement and reconcile returned state; do not claim Discord delivery unless confirmed |
| Partial save | Keep failed scopes dirty and explain what succeeded; Discard cannot reverse successful writes |
| Refresh | Update operational data without overwriting other drafts; retain filters and focused editing controls |
| Invalid field | Inline error connected to its input; expand enclosing disclosure and focus the first invalid field on submit |
| Deleted resource | Show unavailable role/channel plus ID; never silently replace a selected destination |
| Destructive action | Name the item/scope and consequence; cancel remains safe and returns focus to the trigger |
| Permission change | Explain the rejected action, preserve reviewable draft data, and avoid presenting an unauthorized success |

Keep server drafts scoped to guild ID. Preserve the existing navigation guard and history behavior. Guard independently owned editors as well as shared configuration. Session-only draft retention is sufficient; do not introduce persistent browser storage of message content by default.

## 6. Visual and responsive specification

| Element | Proposed treatment |
| --- | --- |
| Tool title | Existing shell title; no duplicate tab heading |
| Section title | 17–18px, weight 600; heading order follows the shell |
| Body and labels | 15–16px with Thai-friendly line height around 1.5–1.65 |
| Help and metadata | 13–14px; readable contrast; IDs in existing mono font |
| Spacing | 8/12/16px within groups, 24–32px between sections |
| Forms | Approximately 720px maximum width for simple forms; longer data lists use available width |
| Controls | Consistent 40–44px visual height; mobile touch areas at least 44px; mobile text inputs at least 16px |
| Surfaces | Flat sections and fine dividers; distinct surfaces for editable records, previews, menus, and dialogs |
| Corners | Reuse existing compact control tokens; avoid a new radius per tool |
| Color | Existing semantic variables; accents for selection/actions, warning for consequences/errors, neutral for inactive state |
| Motion | 150–200ms feedback transitions; no hover movement or decorative loading choreography; respect reduced motion |

- Preserve the shell's existing rail-to-selector breakpoint below 780px. Make tab columns depend on actual content width.
- On phones, use one column with 16px gutters. Stack toolbars and keep search full width. Use labeled records for management tools; retain bounded horizontal scrolling where a true table needs it.
- Never stack two fixed action bars over content. Keep local actions in normal document flow when the global server save bar is visible. Reserve space for that bar and mobile safe areas.
- Long names, Thai copy, URLs, and IDs wrap without page-level overflow. Secondary truncation must have a keyboard-accessible way to reveal the full value.
- Dialogs fit the available height with an internal scroll area, visible actions, focus containment, Escape handling, and focus restoration. A mobile keyboard must not hide the active field or submit action.
- Use visible labels, associated hints/errors, semantic tables, and named controls. Real local tabs need arrow-key navigation and tab/panel relationships; binary choices use standard radio/switch semantics.
- Status must be understandable without color. Announce submission outcomes and meaningful errors; do not announce every preview keystroke or queue refresh.

## 7. State and content coverage

Implementation fixtures should cover both themes and languages with empty, typical, and crowded content: zero roles, many selected roles, long Thai names, missing avatars, unavailable channels, long embed content, many members, and repeated log events. Fixtures must be clearly synthetic and isolated from live Discord writes.

Every tool needs distinct initial loading, empty, filtered-empty, error, and populated states where applicable. Editors additionally need clean, dirty, validating, submitting, rejected, and confirmed states. Preserve loaded content during recoverable refresh failures and offer an explicit retry. Respect supplied rate-limit retry information without inventing a countdown.

## 8. Implementation sequence and file map

This section describes future work. Delivering this plan does not implement it or modify application files.

1. **Baseline and contracts:** capture current desktop/mobile tools using isolated fixtures. Inventory each form's fields, persistence, permissions, validation, and side effects. Confirm where source observations appear in the actual render.
2. **Shared patterns:** extend `TabWorkspace.js` and `tabWorkspace.module.css` with reusable setting rows, field help/errors, compact filter bars, and consistent local actions. Reuse `TabSection`, `TabTable`, `TabDialog`, and `CustomSelect`; introduce a helper only when multiple tools need it.
3. **Settings family:** migrate Autorole, Automod, Honeypot, and Voice TTS. Use the existing Welcome editor as a reference and close verified accessibility/readability gaps there.
4. **Management family:** migrate Members, Roles, Nicknames, and Reaction Roles; preserve list behavior and add clear local draft handling.
5. **Editors and operations:** redesign Embed Creator and Audio Queue, including destination clarity, preview states, and operation feedback.
6. **Personal and history:** align Personal Settings and Audit Logs with the shared language and patterns.
7. **Validation:** inspect representative flows at desktop/mobile sizes in both themes and languages, fix the findings together, and document the resulting shared patterns after implementation.

| Location | Responsibility |
| --- | --- |
| `app/components/Tabs/*Tab.js` | Per-tool layouts, field order, copy, local drafts and feedback |
| `app/components/Tabs/TabWorkspace.js` | Shared semantic sections, settings rows, filters, tables, dialogs |
| `app/components/Tabs/tabWorkspace.module.css` | Shared spacing, typography, responsive behavior and states |
| `app/components/Tabs/WelcomeTab.module.css` | Reference editor/preview styles; extract only genuinely shared pieces |
| `app/components/CustomSelect.js` | Accessible searchable resource selection, unavailable options and labeling |
| `app/servers/[guildId]/page.js` | Minimal draft/navigation integration needed by independently owned editors |
| `app/components/FloatingSaveBar.js` and its CSS | Preserve save scope and prevent overlap with local actions |
| `app/copy/en.js`, `app/copy/th.js` | Every touched label, hint, error, status and action in both languages |

Use the current React/Next.js, CSS Modules, Lucide, and shared component stack. Backend changes, new dependencies, generated artwork, added analytics, new moderation features, and additional polling are outside this design plan.

## 9. Acceptance criteria

- [ ] All 13 tools retain their existing capabilities, authorized access, and `?tab=` IDs.
- [ ] Each tab opens with its main setting, search, or operational control visible at 1366×768 and 390×844 under typical fixture content.
- [ ] Settings, list, and editor patterns use the same labels, spacing, control states, and feedback conventions.
- [ ] Users can tell whether an action saves server settings, updates one item, changes personal preferences, or sends to Discord.
- [ ] Global and local drafts survive tool navigation and operational refresh, or departure clearly offers a recovery choice.
- [ ] Failed and partial saves preserve the appropriate drafts; duplicate submissions are prevented without freezing unrelated tools.
- [ ] Welcome and Embed previews remain local; switching formats or disclosures does not erase content.
- [ ] Role/member/nickname operations retain search, filters, pagination, identity context, and permission restrictions.
- [ ] All redesigned text is translated in English and Thai, including empty states, accessibility labels, and errors.
- [ ] Light/dark themes, 320px width, 200% zoom, long text, reduced motion, and keyboard-only flows remain usable.
- [ ] Save bars, dialogs, menus, and mobile keyboards do not obscure the focused control or required action.
- [ ] During implementation, run relevant copy/locale/UI checks and the production build. Use behavioral tests for draft preservation and request outcomes; avoid source-text assertions that merely mirror a chosen layout.
- [ ] No live Discord operation is performed merely to create a preview, populate screenshots, or demonstrate the redesign.

Suggested usability tasks: configure a welcome destination; enable a moderation rule and explain its response; assign a member role; change a spoken name; compose an embed and identify its destination; recover from a failed save. Observe whether people locate the controls, understand the effects, and retain their work. These are validation goals, not claimed improvements already measured.
