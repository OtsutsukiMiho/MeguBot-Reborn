---
name: Megu
description: Calm, server-aware operations for Discord communities.
colors:
  primary: "#2F5340"
  primary-hover: "#3B6650"
  on-brand: "#FFFFFF"
  accent: "#235C48"
  accent-soft: "#E6EEE6"
  paper: "#F5F0E4"
  surface: "#FDFAF3"
  surface-raised: "#F8F3E7"
  sunk: "#EDE5D4"
  ink: "#241E15"
  muted: "#6A5A44"
  line: "#E4DAC6"
  line-strong: "#947C50"
  gold: "#C8A24C"
  warning: "#9B3521"
  warning-soft: "#F7EAE3"
  success: "#4E6B1B"
  success-soft: "#EEF1E1"
  band: "#1E2A21"
  band-ink: "#F6F1E4"
  dark-primary: "#2B57E0"
  dark-accent: "#8FAEFF"
  dark-paper: "#07090F"
  dark-surface: "#0E121C"
  dark-surface-raised: "#141926"
  dark-ink: "#E9EDF7"
  dark-muted: "#8D97AE"
  dark-line: "#1B2130"
  dark-line-strong: "#5C6680"
typography:
  display:
    fontFamily: "Anuphan, IBM Plex Sans Thai, Leelawadee UI, Tahoma, sans-serif"
    fontSize: "clamp(1.7rem, 4vw, 2.8rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Anuphan, IBM Plex Sans Thai, Leelawadee UI, Tahoma, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Anuphan, IBM Plex Sans Thai, Leelawadee UI, Tahoma, sans-serif"
    fontSize: "1.02rem"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "IBM Plex Sans Thai, Anuphan, -apple-system, Segoe UI, Leelawadee UI, Tahoma, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans Thai, Anuphan, -apple-system, Segoe UI, Leelawadee UI, Tahoma, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.68rem"
    lineHeight: 1.65
rounded:
  sm: "6px"
  md: "10px"
  tab-button: "0.65rem"
  tab-input: "0.7rem"
  panel: "0.9rem"
  lg: "1rem"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.55rem"
  md: "0.9rem"
  lg: "1.15rem"
  xl: "1.55rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.tab-button}"
    padding: "0.66rem 1.05rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tab-input}"
    padding: "0.58rem 0.72rem"
  status-chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "0.3rem 0.58rem"
  workspace-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1.15rem"
---

# Design System: Megu

## Overview

**Creative North Star: "The Fired Celadon Console"**

Descriptive names are inferred from the existing implementation, not newly confirmed brand commitments. Exact component values here describe the server workspace; shared page tokens remain defined in `app/globals.css`.

Megu should feel like a calm operations desk made from two related materials: warm celadon paper in light mode and ink-dark sapphire in dark mode. The interface is compact and purposeful, with color reserved for meaning, state, and the next useful action. It should feel friendly enough for a community tool and disciplined enough for moderation work.

The system favors readable hierarchy, fine rules, restrained tonal layers, and Thai-capable typography. It avoids ornamental admin-dashboard noise. Each screen establishes one title authority, then lets state, controls, and results carry the task.

**Key Characteristics:**

- Warm paper and forest accents in light mode; near-black ink and luminous sapphire in dark mode.
- Anuphan-led headings, IBM Plex Sans Thai body copy, and JetBrains Mono metadata.
- Flat, divider-led workspaces with depth reserved for floating menus and dialogs.
- Compact controls with visible focus, explicit state, and reduced-motion behavior.
- Server context stays present while tools remain consistent and task-focused.

## Colors

The palette treats light and dark themes as distinct materials rather than a mechanical inversion.

### Primary

- **Kiln Forest:** The light-theme primary action and brand field; use it where a user commits a change.
- **Luminous Sapphire:** The dark-theme primary and active color; it carries the same operational authority without becoming neon.

### Secondary

- **Celadon Signal:** Links, focus, selected controls, and current-state emphasis in the light theme.
- **Honey Iron:** A small Megu identity accent and warm emphasis; keep it rare.

### Tertiary

- **Terracotta Warning:** Destructive, failed, or attention-required states, paired with its soft tint.
- **Olive Resolution:** Saved, enabled, settled, and successful states, paired with its soft tint.

### Neutral

- **Parchment Ground:** The warm page field in light mode.
- **Glazed Surface:** Primary panels and controls; raised surfaces use one slightly deeper tonal step.
- **Brown Ink:** Primary readable content, with warm muted copy and brown rules instead of neutral grey.
- **Midnight Ground:** The near-black blue ground in dark mode, with two small surface steps and cool readable ink.

### Named Rules

**The Meaningful Color Rule.** Color must communicate brand, focus, status, or action; neutral structure does the rest.

**The Two Materials Rule.** Tune light and dark themes independently. Do not create dark mode by simply inverting light tokens.

**The Gold Is Megu Rule.** Gold is an identity mark or rare warm emphasis, never a general-purpose accent.

## Typography

**Display Font:** Anuphan with IBM Plex Sans Thai and platform Thai fallbacks
**Body Font:** IBM Plex Sans Thai with Anuphan and platform UI fallbacks
**Label/Mono Font:** JetBrains Mono for IDs, counts, and compact machine metadata

**Character:** The pairing is rounded and approachable without becoming playful. Thai coverage is mandatory; type hierarchy must retain the same clarity and apparent weight in both scripts and both themes.

### Hierarchy

- **Display:** server identity and singular page-level statements, using the display token.
- **Headline:** the active tool title and major panel headings.
- **Title:** section titles inside a tool workspace, with the stronger explicit section weight.
- **Body:** primary reading copy; descriptions generally stop near 68ch. Global weights become optically lighter in dark mode.
- **Label:** field names and compact UI copy.
- **Mono:** server IDs and machine-oriented metadata. Tables use tabular numerals.

### Named Rules

**The Thai First Rule.** A display treatment without Thai coverage is not an acceptable Megu treatment.

**The Single Title Authority Rule.** The shell names the current tool; tab contents begin with status or section hierarchy, not a duplicate page title.

## Layout

Server administration uses a bounded shell: server identity and facts first, then a sticky tool rail beside one fluid panel. Tool contents follow a 1.55rem vertical rhythm, use sections divided by fine rules, and keep descriptive copy near 68ch. Two-column field, choice, and settings-row grids collapse to one column at 760px; the server tool rail becomes a compact selector below 780px. Editor-and-preview layouts use an approximately 3:2 split while space allows, then stack at 1023px with the preview after the editor.

Dense comparison tables retain their operating width inside horizontal scroll frames instead of crushing labels. When a table represents people or similarly discrete records, it may transform below 620px into bordered records whose cells keep visible labels; never hide the column meaning when removing the header row.

Primary state and actions appear near the start of the workspace. Destructive choices and dense secondary configuration remain below the main task. At small widths, section headers, notices, and action bars stack; controls stretch only where that improves reach and legibility.

## Elevation & Depth

Megu is flat by default. Page, panel, raised, and sunk tonal steps create most depth; borders define operated surfaces. Shadows are reserved for floating select menus and modal dialogs, where separation from the current task is functional. Hover movement is subtle and never required to understand state.

### Shadow Vocabulary

- **Floating menu:** A soft, compact shadow using the theme shadow color at low opacity; only for content that opens above the document.
- **Dialog:** A broader shadow at moderate opacity; only for modal decisions.
- **Focus halo:** A three-pixel accent-tinted ring paired with an accent border, never a shadow used as decoration.

### Named Rules

**The Flat Workspace Rule.** Sections use whitespace and dividers; do not stack cards inside the primary tool panel.

**The Functional Lift Rule.** Within server tool workspaces, reserve shadows for floating menus, dialogs, and focus. Other product surfaces retain their existing elevation treatments.

## Shapes

Controls use compact, gently rounded corners. Global buttons use the small radius; server-tab buttons and fields use the slightly softer tab-specific radii in the frontmatter. Panels use the panel radius and dialogs use the large radius. Pills belong to compact statuses and badges. Avatars may be circular or softly squared according to their source; icon containers use simple rounded squares. Fine one-pixel borders carry structure, with stronger lines reserved for controls users operate.

## Components

### Buttons

- **Shape:** Compact rounded rectangle using the tab button radius and a minimum height of 2.35rem.
- **Primary:** Filled with the theme primary token, high-contrast text, and confident label weight.
- **Hover / Focus:** One-pixel upward movement on hover; focus uses the shared visible accent outline. Reduced-motion mode removes movement.
- **Secondary / Ghost:** Surface or transparent background with a clear operated edge; destructive variants use warning semantics and explicit copy.

### Chips

- **Style:** Pill-shaped, compact, and always paired with text; a small dot may reinforce state but never replaces the label.
- **State:** Accent for current context, olive for success, terracotta for warning or destructive state, neutral for unavailable information.

### Cards / Containers

- **Corner Style:** Panel radius for shell-level containers.
- **Background:** Primary surfaces use the surface token; raised or selectable areas use the next tonal step.
- **Shadow Strategy:** No resting shadow in the workspace.
- **Border:** One-pixel neutral rule; stronger only for operated or selected controls.
- **Internal Padding:** Usually 0.9–1.2rem, with larger composition spacing handled between sections.

### Inputs / Fields

- **Style:** Full-width surface field, strong one-pixel edge, tab input radius, compact 2.65rem minimum height.
- **Focus:** Accent border plus a three-pixel translucent accent halo.
- **Error / Disabled:** Errors use warning color with text; disabled controls use the sunk surface, muted text, and reduced opacity.

### Navigation

Desktop server navigation is sticky, grouped, searchable, and uses Lucide icons with text labels. The active item receives an accent tint and stronger weight; hover uses a sunk tonal field with restrained movement. Below 780px, it becomes one labeled native selector that preserves every group and tool.

### Local Tabs and Disclosures

Local tabs are a compact control inside one server tool, not a second page-navigation rail. They use proper tab semantics, a single selected tonal surface, and arrow, Home, and End key movement. Disclosures use fine top and bottom rules instead of nested cards; their summary pairs a clear label with optional help text, and any disclosure containing an invalid field opens automatically.

### Settings Rows and Lists

Settings rows pair a concise label-and-help column with one flexible control column, separated by fine rules. Switches are reserved for binary settings; segmented controls handle small, mutually exclusive choices. Resource lists use identity, supporting data, and actions in stable columns on wide screens, then stack without losing labels or action access on narrow screens.

### Dialogs

Dialogs are bounded task surfaces with a clear heading, scrollable body, and separated footer. Opening a dialog moves focus inside and locks background scrolling; Escape closes when safe, Tab remains trapped within the dialog, and closing restores focus to the trigger. On narrow screens, dialogs align to the bottom edge and use dynamic viewport height so browser chrome does not hide actions. Destructive dialogs name the item or scope and pair warning language with explicit Cancel and confirm actions.

### Task Workspace

Every server tool uses the shared workspace primitives: an optional status/action rail, semantic sections, choice tiles, notices, empty/loading states, tables, and accessible dialogs. Section headers describe the decision or data beneath them; status sits adjacent on wide screens and stacks above controls on narrow screens.

Staged server settings use one floating save bar and unsaved status marks. Immediate operations and independently submitted editors keep their own action labels, pending states, and feedback; they must never imply that the shared save bar will commit them. Refresh failures preserve usable results and identify them as stale rather than replacing them with an empty-state claim.

### Custom Select

The custom select uses a real button trigger and labeled listbox options. It supports search when useful, restores focus after Escape, shows role colors or avatars when data provides them, and uses Lucide search, check, channel, and chevron icons instead of emoji glyphs.

## Do's and Don'ts

### Do:

- **Do** preserve one visible title authority and begin tab content with state or task context.
- **Do** use dividers and tonal steps before introducing another container.
- **Do** keep state labels textual, contrast-safe, and understandable without color.
- **Do** use semantic controls, visible focus, reduced-motion fallbacks, and bilingual-safe wrapping.
- **Do** require an in-document confirmation dialog for destructive bulk actions.
- **Do** preserve useful results and active drafts during refresh or submit failures, then label stale or unconfirmed state explicitly.

### Don't:

- **Don't** recreate each server tab as an isolated mini-page with its own heading system.
- **Don't** use native browser confirmation prompts, text glyphs as icons, or emoji as control chrome.
- **Don't** flatten dense tables until labels become unreadable; use an intentional scroll frame.
- **Don't** turn a responsive table into anonymous values; retain a visible label for every mobile record field.
- **Don't** use shadows, gradients, or color as decoration when hierarchy and state already communicate the purpose.
- **Don't** fabricate Discord state, activity, metrics, or success claims to make an interface feel populated.
