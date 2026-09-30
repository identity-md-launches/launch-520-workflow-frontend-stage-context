# COMP frontend design

## Overview

This interface lets a Sepolia wallet holder monitor the price and NHI feeds, manage a collateralized COMP position, inspect liquidation eligibility, consume work rights, and trade the separate CPL launch token. The source is `web/src/App.tsx`, `web/src/Swap.tsx` and `web/src/style.css`. It uses a compact monospace hierarchy, flat dark surfaces, subdued borders and one pale green action accent.

The supplied repository contains no incumbent website, stylesheet, palette specification or frog SVG in its current tree or 37 reachable commits. The implemented palette, spacing, motion and vector drawing are therefore disclosed fallback choices. IBM Plex Mono and a raster-free frog are explicit assignment requirements. Verbatim preservation of omitted design assets cannot be established; see `docs/DESIGN-RESEARCH.md`. This document is under `docs/` because the assignment's hard write scope excludes a repository-root `DESIGN.md`.

Feed metrics precede the main task. The deposit/mint/repay/withdraw form and position summary share the initial workspace; native disclosure sections hold position inspection, work minting, CPL swaps, reporter/faucet tools and contract details. This arrangement belongs to this page, not a required layout for every future page. Browser observations and limitations are recorded separately in the validation report; the values below describe the source implementation.

## Colors

All values are semantic custom properties on `:root` in `web/src/style.css`. The appearance is deliberately dark-only, with no theme switch.

| Token | Hex | Actual role |
| --- | --- | --- |
| `--page` | `#101811` | Page, inputs, nested disclosure panels and frog facial features |
| `--surface` | `#18231a` | Feed cells, panels, disclosures and disabled controls |
| `--raised` | `#202e22` | Neutral buttons and active action selectors |
| `--text` | `#edf3e7` | Primary text and links |
| `--muted` | `#abbba5` | Supporting text, labels and disabled text |
| `--border` | `#52634d` | Structural separators, field/control borders and ratio track |
| `--accent` | `#b5e878` | Primary action fill, selected action text, frog, ratio fill and live indicator |
| `--ink` | `#101811` | Text on the primary action |
| `--warning` | `#f4c87c` | Stale/eligibility notices and caution text |
| `--error` | `#ffb4a6` | Errors and invalid-field border |
| `--focus` | `#d7fda7` | Keyboard focus perimeter and primary hover fill |

Statuses also have readable words such as Fresh, Stale, Healthy and Underwater. No status depends on hue alone. The production export was inspected at its `/dist/` subpath, and these text pairs were measured from rendered computed colors:

| Foreground/background | Measured ratio | Normal-text threshold |
| --- | --- | --- |
| Primary text `#edf3e7` / surface `#18231a` | 14.35:1 | 4.5:1 |
| Muted text `#abbba5` / surface `#18231a` | 8.02:1 | 4.5:1 |
| Warning `#f4c87c` / surface `#18231a` | 10.35:1 | 4.5:1 |
| Primary button ink `#101811` / accent `#b5e878` | 12.73:1 | 4.5:1 |

These are identified pairs, not a claim that every state or focus adjacency was measured. Keep new uses attached to semantic roles rather than duplicating literal colors. The HTML theme-color follows `--page`.

## Typography

IBM Plex Mono is loaded from the pinned `@fontsource/ibm-plex-mono` dependency. `style.css` imports local Latin WOFF2 faces at weights 400, 500 and 600, which Vite exports as local assets. The fallback is `monospace`; `font-synthesis: none` prevents synthetic faces. Controls inherit the family. Numbers use `font-variant-numeric: tabular-nums` throughout.

| Role | Implemented treatment |
| --- | --- |
| Root/body | 14px, weight 400; paragraph line-height 1.65 and maximum measure 75ch |
| Page heading | `clamp(30px, 4.2vw, 50px)`, weight 500, line-height 1.15, tracking -0.045em |
| Section heading | 20px, weight 500, line-height 1.4, tracking -0.025em |
| Subheading | 15px, weight 500, line-height 1.5 |
| Brand | 22px, weight 600, tracking -0.06em; 19px at the narrow breakpoint |
| Feed metric | `clamp(25px, 3vw, 34px)`, line-height 1.3 |
| Position metric | 23px, reduced to 20px at the narrow breakpoint |
| Form input/select/textarea | 16px, with the main amount input enlarged to 24px |
| Small copy/labels | 12px; small-copy line-height 1.65 |
| Eyebrow | 11px, tracking 0.13em, uppercase presentation |
| Badges and secondary feed notes | 11px |

Headings use balanced wrapping and paragraphs use pretty wrapping. Long addresses, transaction status and feed values can wrap. Badges intentionally keep a short label on one line. Full checksummed addresses remain available through explorer links, accessible names, title text and copy controls. Text remains selectable. Browser inspection confirmed IBM Plex Mono's 400, 500 and 600 faces loaded in the production export.

## Layout

The `.shell` provides a centered 1192px maximum border-box width with 32px inline padding. The topbar is a wrapping flex layout. The intro separates a heading block and a short testnet notice. `.feeds` is a three-column grid; `.workspace` uses `minmax(0, 1.15fr) minmax(0, 1fr)` with a 24px gap. `.twocol` provides equal two-column groups; `.stack` supplies a 16px vertical gap. `.row` is a wrapping horizontal group with a 16px gap.

Panels use 26px padding; feed cells use 24px. Related position metrics use a two-column grid with 24px vertical and 16px horizontal gaps. Section headings have 20px separation from their following content. Inputs occupy their available width and have `min-width: 0`; grid tracks and panels likewise permit content to shrink without forcing overflow.

At `max-width: 56rem`, the main workspace and `.twocol` collapse to one column, shell padding becomes 24px and feed padding becomes 18px. The intro's supplementary badge and the header network badge hide. At `max-width: 38rem`, shell padding becomes 16px, feed metrics stack vertically, panels use 20px padding, the footer stacks, the header brand shrinks and contract rows stack. The connected header address stays visible in a wrapping 10px flex group aligned to the trailing edge. Copy buttons become 44px tall. With a default 16px browser initial font size, these media-query boundaries are 896px and 608px; rem media queries use the browser's initial font size.

Controls stay in ordinary document flow; there is no fixed bottom bar or overlay. Browser checks observed no horizontal overflow at 1440px, 820px and 320px. Evidence includes `docs/validation/live-desktop.png` and `docs/validation/live-mobile-320.png`. These observed widths do not establish native 200% zoom, every intermediate width or a physical-device test. Final validation records rechecks after source corrections.

## Elevation & depth

There are no shadows, gradients or raised overlays. A page/surface/raised three-tone hierarchy and 1px borders distinguish sections and controls. `.notice` uses a 2px inline-start warning border. `.ratio` is an inset bordered group with a 5px ratio track; the track is decorative and the numerical ratio is readable text. The skip link has `z-index: 10` when focused.

## Shapes

Panels, the feed group and native disclosure sections use 10px radii. Inputs, standard buttons and inset ratio groups use 6px radii. Badges use 4px radii. Dots are circular. The header mascot is the `Frog` component's inline SVG in `App.tsx`; `web/public/frog.svg` provides the vector favicon. Neither is a recovered incumbent drawing. The app ships no photographic or raster image assets.

## Components

| Component or pattern | Source and reuse point | Behavior |
| --- | --- | --- |
| `Frog` / brand | `App.tsx`, `.brand` | Decorative inline SVG inherits the accent; brand text supplies the accessible name. |
| `AddressLink` | `App.tsx`, `.address`, `.copy` | Explorer link with full accessible address, clipboard action and persistent copy-failure text. |
| `Gate` | `App.tsx` | Presents connection or network switching before transaction controls. |
| `Status` / `UI.run` | `App.tsx`, `.status` | Stable polite live region per action; simulation/signing/pending/confirmed/error feedback and explorer link. A global transaction lock prevents competing submissions while status belongs to each action. |
| `Feeds` | `App.tsx`, `.feeds`, `.feed` | Live price, NHI health and effective minimum ratio, with age/freshness labels and current grace period. |
| `VaultActions` | `App.tsx`, `.tabs`, `.amount-wrap` | Four ordinary `aria-pressed` buttons select an action; a labeled amount form validates input and shows available limits. Deposit approval is a separate exact-amount step. |
| `PositionPanel` | `App.tsx`, `.position-grid`, `.ratio` | Position amounts, health and ratio; marked positions show stored grace and expiry countdown. Debt-free positions use a readable label. |
| `Inspector` | `App.tsx` | Validates an owner address, loads its position and exposes eligible mark/clear/liquidate actions. Liquidation requires a review checkbox. |
| `Work` / `Operators` | `App.tsx` | Additional labeled forms; fresh-feed, account and reporter/operator eligibility control the available actions. |
| `Swap` | `Swap.tsx`, `.stack`, `.twocol`, `.ratio` | Direction, amount and slippage form; explicit quote, minimum received, expiry, sequential Permit2 steps and review before swap. |
| `.details` | `App.tsx`, `style.css` | Native details/summary disclosure with keyboard behavior supplied by the browser. |

Standard buttons have a 44px minimum height and inputs have a 48px minimum height; the narrow layout also enlarges copy controls. A 2px `:focus-visible` outline uses `--focus` with a 4px offset; forced-colors mode uses the system `Highlight` color. Form controls keep visible labels. `.primary` supplies filled emphasis; neutral and `.text` controls support secondary actions. Disabled controls retain a readable label and their reasons appear in contextual status or help text.

The `.live::after` indicator loops over 2.8 seconds with `ease-in-out`, changing opacity from 1 to 0.4 and scale from 1 to 0.75. It only animates inside `prefers-reduced-motion: no-preference`. The page's Pause motion control adds `.paused` to stop it independently. The same media query enables 150ms button transitions and a 0.96 press scale. Hover styling is limited to hover-capable devices. Browser emulation of reduced motion confirmed `animation-name: none`; keyboard inspection confirmed the visible skip-link focus state (`docs/validation/keyboard-focus.png`). Screen-reader sessions, browser-native zoom and RTL layouts were not tested. No full accessibility-conformance claim follows from these bounded checks.

## Do's and don'ts

- Reuse `.shell`, `.panel`, `.stack`, `.row` and the existing semantic colors for another contract section. Start with a heading and short purpose, followed by current state, labeled inputs, the gated action and its `Status` region.
- Use the same deployment loader, wallet gate and transaction lifecycle. A new control must retain network/verification/eligibility checks and remain pending until its receipt and state refresh finish.
- Keep amounts in exact token units, label COMP versus CPL clearly, and provide feed-derived value context without inventing a USD price.
- Keep meaningful content visible without animation; retain both the reduced-motion condition and manual pause.
- Do not claim these inferred tokens or frog match an absent original. If original design assets are later supplied, restore those within the authorized scope and update this source-derived document.

Guidance attribution: Better Interface by Jakub Krehel, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method adapted from Paul Bakaus's Impeccable, Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. License texts are retained in `docs/licenses/`.
