# Next Projects feature: attention filters

Date: 2026-09-12
Status: implemented and verified on 2026-09-13.
References: `PROJECTS_DESIGN_PLAN.md` and `PROJECTS_REVIEW_AND_IMPROVEMENT_PLAN.md`.

## Recommendation

Build **attention filters shared by Timeline and Topics** next. Let people immediately find work that is blocked, overdue, awaiting review, or missing an accountable owner, then open the existing detail panel to act.

The current manager already supports planning, assignment, reporting, review, invitations and notifications. Its next useful feature should help users decide what needs attention among those records. Both Timeline and Topics currently receive the complete topic array; Topics supports sorting, but neither provides this focused view.

This feature uses existing topic data and actions. It can ship without a new database table, notification worker or additional navigation tab.

### Why this feature first?

| Candidate | Benefit | Recommendation |
| --- | --- | --- |
| Attention filters | Helps leads and contributors on every return visit; builds on existing data | Build next |
| Guided project setup | Helps new teams complete their first project configuration | Follow after everyday navigation is reliable |
| Collaborators in topic creation | Saves an extra assignment edit | Useful small follow-up |
| Kanban | Adds another way to organize the same work | Defer until users demonstrate a need beyond Timeline/Topics |
| Comments and attachments | Adds collaboration context | Defer: introduces storage, retention, moderation and notification decisions |

This recommendation does not replace the correctness fixes in the review. Report-action eligibility and date interpretation were repaired with this implementation before relying on them in the attention workflow. Join-link recovery can proceed independently and should remain a release priority.

## 1. User outcomes

- A lead selects “Awaiting review” and opens a topic to approve or return it.
- A contributor selects “Assigned to me” and “Blocked” to find their own stalled work.
- A lead selects “Unassigned” to find topics without a primary accountable owner.
- A viewer uses the same filters to understand status, with read-only detail actions.
- A member shares a filtered URL; the recipient sees it only after normal project authorization.

## 2. First-release scope

Place one compact filter toolbar below the workspace tabs and above the timeline controls or topic list. Keep the existing My work strip and report actions.

Provide:

1. A single attention selection: All topics, Blocked, Overdue, Awaiting review, Unassigned.
2. An independent “Assigned to me” checkbox.
3. A topic-title search field with an accessible EN/TH name.
4. A visible result count and Clear filters action when filtering is active.
5. Counts on attention choices, derived from saved topic data.

Use existing custom selectors on compact screens; desktop may use compact text buttons with `aria-pressed` when the container has enough width. Both representations use the same state. Do not introduce a fourth workspace tab or a new metric-card section.

Not included: saved personal filter presets, bulk mutations, cross-project inbox, new deadlines, predictive risk scores, automatic reminders, or new permissions.

## 3. Exact filter rules

| Filter | Rule |
| --- | --- |
| All topics | All non-archived topics, including completed work |
| Blocked | `blocked === true` and workflow is not completed |
| Overdue | Saved deadline is valid, earlier than the current instant, and workflow is not completed |
| Awaiting review | `workflow === 'in_review'` |
| Unassigned | No primary assignee and workflow is not completed; collaborators alone do not establish accountability |
| Assigned to me | Current canonical Megu user ID is present in topic assignees, whether primary or collaborator |
| Search | Case-insensitive substring match against topic title; trim outer whitespace and support Thai/mixed script |

Combine the attention choice, assigned checkbox and search with AND. A topic may contribute to multiple attention counts, but only one attention choice is selected at a time.

Compute attention counts after applying search and Assigned to me, but before the selected attention choice. This avoids all other counts turning into zero merely because one filter is selected. Label the result as “Showing X of Y topics,” with Y the full active topic count.

Do not derive overdue from display strings or subtract Buddhist years during filtering. Use canonical saved instants and the existing date contract. Explain that the Unassigned filter means “No primary assignee” in its accessible description/help text.

For paused or closed projects, filters still describe saved state. Their presence does not enable reporting, editing or reminder delivery. Archived topics stay in the existing archive area and do not affect attention counts; explicitly label that area as separate from filtered current work.

## 4. Interaction and state behavior

### Switching views

Timeline and Topics share the same search/attention state. Switching to Updates preserves those selections but hides the topic-filter toolbar; Updates retains its own event filters.

### URLs

Suggested query parameters:

```text
/p/ABC2345?view=topics&attention=blocked&assigned=me&q=backend&topic=top_example
```

The example is illustrative, not a real project link. Preserve unrelated parameters. Omit default values. Validate attention values against the supported list and bound search to 120 characters. Use replace for debounced search edits and deliberate history handling for view/filter changes; restore state on browser Back/Forward. Avoid adding one history entry per keystroke.

“Assigned to me” always resolves to the signed-in recipient, not the sender of a shared link. A URL is never authority for project access.

### Detail panel and edits

If a selected topic stops matching after a report or filter change, retain the detail panel and show a small “This topic is outside the current filters” notice with Clear filters. Do not silently select another topic or discard a report draft.

If an action is being edited, filtering must preserve that draft or use the existing explicit discard behavior. Do not make merely hiding a row destroy unsaved work.

### Timeline behavior

Filter visible topic rows only. Continue to use the full topic collection for dependency editing, validation, project schedule bounds and milestone context. Do not pass a reduced array into scheduling forms that need to reference hidden topics.

“Fit project” keeps its literal meaning: fit the whole project. Filtering does not change dates, rollups, topic counts in the project header, or dependencies. Any future “Fit filtered topics” action must be separately named.

### Empty and loading states

- No project topics: retain the existing first-topic empty state.
- No matching topics: explain that filters have no matches and offer Clear filters.
- Refresh in progress: retain current rows and filters with a subtle busy indication.
- Refresh failure: keep usable rows, show retry feedback, and do not claim an empty result.

## 5. Implementation steps

### Step A — extract filtering rules

Add a small pure helper, suggested path `app/components/projects/projectFilters.js`, containing allowed attention values, URL parsing/serialization, filtering and count derivation. Pass the current instant into computations so boundary behavior can be tested deterministically.

Keep raw data immutable. Use memoized derivations in the workspace. At the current 100-topic pilot limit, client filtering should be sufficient; measure before introducing API filtering or virtualization.

### Step B — add shared workspace state

In `app/components/projects/ProjectWorkspace.js`, initialize filter state from the URL and synchronize navigation changes. Keep the full authorized topic collection as the source of truth. Derive visible topics and attention counts separately from My work, rollup and report eligibility.

Use a bounded local clock refresh while the page is visible, plus a visibility/focus refresh, so overdue state can change without reloading. It needs no network polling. Clear timers/listeners on unmount.

### Step C — build the toolbar

Add `ProjectTopicFilters.js` using the existing `CustomSelect`, checkbox, search icon and theme tokens. Give the search field a real accessible name, label the assigned checkbox, and provide a clear reset target.

Add styles in `projectWorkspace.module.css`, preferably using the main content container width so the toolbar also adapts when the detail panel is open. Maintain the current circular avatar and clear percentage treatments.

### Step D — integrate both views

Pass visible topics into TopicList. For Timeline, introduce an explicit visible-row input while retaining full topics for scheduling context. Apply the selected sort after filtering. Render the filtered-empty state instead of the first-project setup prompt when the project has topics.

Keep selected-topic lookup against all authorized topics. Implement the out-of-filter notice and verify that closing the panel restores focus sensibly even when its original row is hidden.

### Step E — localization and accessible behavior

Add matching keys to `app/copy/en.js` and `app/copy/th.js` for all choices, result counts, search, reset, the unassigned explanation and out-of-filter detail notice. Reuse existing wording where it matches the intended meaning.

Support keyboard operation, visible focus and debounced polite result announcements. No color-only state. On mobile, controls stack without forcing page-wide horizontal scrolling.

### Step F — verify and document

Run focused filter behavior tests, existing Projects contract tests, copy checks and a production build. Update source-contract tests only where behavior intentionally changed; do not use regex checks as a substitute for functional coverage.

Record the feature and its exact count/URL semantics in the baseline plan. Mark browser checks as completed only after running them.

## 6. Verification matrix

| Area | Required cases |
| --- | --- |
| Filtering | Each attention rule; combined search/assigned filters; overlapping counts; completed and archived exclusion rules |
| Accountability | No assignees, collaborators without primary, primary plus collaborators |
| Dates | Before, exactly at, and after deadline; missing/invalid date; canonical Thai-year input result |
| Permissions | Owner, lead, member and viewer use filters; allowed detail mutations remain unchanged |
| Navigation | Direct filtered URL, refresh, tab changes, Back/Forward, unknown parameters and shared Assigned to me link |
| Drafts | Active report survives filtering; saved topic leaves filter while detail stays open; hidden trigger focus recovery |
| Timeline | Filtered rows do not remove dependency choices or change Fit project bounds |
| Layout | Detail open/closed, 320/390/768/1024/1440 widths, 200% zoom, long Thai/English, both themes |
| Accessibility | Named search, keyboard select/checkbox/reset, result announcements and visible focus |
| Performance | Representative 100-topic project; filtering remains responsive without additional API requests |

Automated tests should use fixtures and mocked transports. No real Discord messages or membership mutations are needed to verify this feature.

## 7. Definition of done

- Timeline and Topics display identical matching records and counts.
- Filters and search restore from a URL and browser history.
- Users can find blocked/review/unassigned work without manually scanning every row.
- Report drafts and selected-topic context survive filter changes.
- Project progress and scheduling context remain based on the whole project.
- EN/TH and both themes pass focused browser checks.
- Existing permission checks and report tests remain valid.
- Documentation records the actual behavior and verification evidence.

After this feature, prioritize guided first-project setup and notification delivery clarity. Reassess larger additions after observing whether teams can find and resolve work efficiently with the existing views.

## 8. Implementation result

The first release is implemented in the project workspace.

- Timeline and Topics share one attention state, title search, and Assigned to me constraint. Updates hides the toolbar without clearing it.
- Attention choices are All topics, Blocked, Overdue, Awaiting review, and Unassigned. Counts are derived after title/assignee constraints and before the selected attention choice.
- Unassigned uses the primary-assignee contract; collaborators without a primary remain visible in that view.
- The query string uses `attention`, `assigned=me`, and `q`, preserves unrelated parameters, bounds search to 120 characters, omits filter defaults, and restores state on Back/Forward. Search edits use a 250 ms replace update; deliberate view/filter changes create history entries.
- A selected detail stays open when its row is filtered out and offers a clear-filter recovery. Closing it returns focus to the original row when present, or the active tab when the row is gone.
- Timeline renders only matching rows while project bounds, Fit project, dependencies, milestones, header counts, progress, My work, and report eligibility continue to use all current topics.
- Report eligibility now has one shared derivation across the header, chooser, and topic detail: active owners/leads may report every unfinished topic, active members may report their assigned unfinished topics, and viewers or inactive projects receive no report action. The core mutation independently rejects viewers.
- Archived topics stay outside attention counts and remain in a separately labelled archive section.
- A one-minute visible-page clock plus focus/visibility refresh keeps overdue classification current without network polling. Quiet data refreshes retain rows, expose a busy state, and keep retry feedback on failure.

Verification completed on 2026-09-13:

- `node tests/project-filters.test.js` passed exact attention rules, overlapping counts, completed-work exclusions, deadline boundaries, invalid dates, collaborator accountability, owner/lead/member/viewer report eligibility, Thai/mixed title search, URL validation, length bounds, and unrelated-parameter preservation.
- `node tests/copy.test.js` and `node tests/projects-contract.test.js` passed. The contract explicitly protects the full-topic scheduling context while Timeline receives visible rows.
- `node node_modules/next/dist/bin/next build` completed successfully with Next.js 16.3.0.
- Focused browser rendering covered the compact selector with detail open, desktop attention buttons with detail closed, a 390 CSS-pixel mobile viewport, English and Thai copy, and light/dark theme tokens. The browser check found and corrected a visible screen-reader helper before completion.
- `git diff --check` passed. The repository ESLint command is not configured with a JSX parser, so direct ESLint reports the existing JSX parse limitation rather than a feature lint result.
