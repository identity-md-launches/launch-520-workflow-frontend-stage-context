# Frontend design input review

This records the supplied evidence available before frontend implementation. It is not a rendered review; final implementation details and checks belong in `DESIGN.md` and the frontend validation report under `docs/`.

## Existing-site provenance limitation

The supplied checkout is pinned to deployed source commit `c622a1dd8c1c9d94a16272080c765d00e9aba7ab`. Its tracked tree contains Solidity, contract tests, ABI arrays and contract documentation, but no existing frontend, stylesheet, font asset, inline frog markup or design document.

The repository is not shallow. Searching all 37 reachable commits with `git log --all --name-only --format=` found no HTML, CSS, JavaScript, TypeScript, SVG, WOFF/WOFF2 or frontend package files. Searches of the supplied workflow, README and documentation found no original palette hex values, IBM Plex Mono declarations or frog SVG. No original site URL was supplied.

Consequently the request to reuse the site's stylesheet, palette, type, motion and inline SVG verbatim cannot be verified from this checkout. IBM Plex Mono, an inline frog and reduced-motion support are explicit requested constraints; any otherwise necessary visual values implemented in this assignment are fallback choices, not recovered or approved incumbent tokens. Supplying the omitted original assets remains necessary to establish verbatim preservation.

The task's hard write budget permits only `web/**`, `dist/**`, `docs/**` and explicitly `web/.gitignore`. Although an acceptance bullet asks for repository-root `DESIGN.md`, that path is outside the write budget. The implementation design document is therefore delivered at `docs/DESIGN.md`, without changing a protected root path.

## Applied pinned references

The provided Better Interface reference was read by its contents and workflow section, followed by the core principles of all six domains and `document-web-design`. Its source is Jakub Krehel's Better Interface, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`, MIT. Its documentation method is adapted from Paul Bakaus's Impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`, Apache-2.0. The ETH frontend UX adapter and supporting reference were also read; source is Austin Griffith's ethskills, commit `06ea4efa08076ff04f6ca4945ef4a2ca881115b0`, MIT. Supplied license texts are retained under `docs/licenses/`.

| Domain | Applicable construction/review criteria |
| --- | --- |
| Accessibility | Native controls, persistent labels, one main landmark and one h1, visible keyboard focus, meaningful button names, error/status announcements, text alongside status colors, reduced-motion handling and reachable controls. |
| Layout | Order feed health and position information before consequential actions; group controls with their labels and errors; allow long addresses and narrow viewports to wrap; inspect 320px, intermediate and desktop widths. |
| Writing | Name exact token/action pairs, distinguish borrowed COMP from CPL, explain approvals and wallet requests, disclose stale/unseeded feeds, make errors actionable and avoid unsupported USD conversions. |
| Typography | Load IBM Plex Mono locally, keep input type at 16px on mobile, use tabular numbers for live values/countdowns, preserve selectable addresses, and document actual supplied weights. |
| Colors | Use semantic roles consistently, identify actual foreground/background pairs, calculate contrast rather than estimate it, and retain the missing-original-palette limitation. |
| UI | Explicit disconnected, switching, approval, simulation, signing, confirmation and failure states; retain pending controls through receipt/refetch; small looping live-value animation with reduced-motion opt-out; inline vector mascot without raster assets. |

The final design documentation is extracted from actual CSS tokens, components, local font dependencies and observed behavior. Reading a guide is not evidence that its browser checks passed. Screen-reader sessions, physical-device checks, native zoom and live-chain transactions must be listed as unperformed unless they actually run.

## Contract-derived behavior relevant to UI

- `CDPVault` exposes deposit, withdraw, `mintCOMP`, `mintFromWork`, repay, mark-underwater, clear-recovered-mark and liquidation actions. Separate reporter/faucet controls must enforce the roles read from the contracts.
- MockIMD, COMP, feed values and work rights use 18 decimal places. Price is **COMP per IMD**, not a USD quote. CPL is the independently deployed launch token, not borrowed COMP.
- The vault creates COMP and its work oracle internally. Read their addresses through `compToken()` and `oracle()` and verify reciprocal vault links. They do not belong in a invented second deployment map.
- Deposit requires IMD allowance to the vault. Repayment and liquidation burn the caller's COMP directly and need no COMP approval.
- Feed-dependent methods require fresh, seeded feeds. Deposit, repayment and debt-free withdrawals remain possible with stale feeds; requiring a healthy feed for these recovery actions would unnecessarily obstruct recovery.
- Read effective `minCR()` from the vault. It is a whole percentage: 200 at NHI <= 0.60, 150 at NHI >= 0.85, and ceiling interpolation between them. Debt-free positions return uint256.max; present them as debt free.
- A mark stores its own `markedAt` and `grace`. Count down from that stored snapshot, not the current `gracePeriod()` after NHI changes. The mark expires only after `markedAt + grace + liquidationWindow()`; it is valid at the exact boundary.
- Read and refresh balances, position, rights, allowance and both feeds after confirmed actions. Disable writes while deployment/code/network checks fail and refresh before signing; mocks establish interaction behavior, not live-chain transaction execution.
