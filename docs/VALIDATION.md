# Frontend validation

Scope: source under `web/`, production export under `dist/`, and documentation/evidence under `docs/`. The deployed Solidity source and root build configuration were not changed. This is worker-reported evidence, not independent certification or publication verification.

## Input constraints and completion limits

The functional frontend has been implemented and locally exercised. **The assignment's exact visual-preservation requirement remains incomplete:** the supplied tree and all 37 reachable commits contain no existing website, stylesheet, palette hex specification, motion implementation or original frog mark. `docs/DESIGN-RESEARCH.md` records the searches. IBM Plex Mono, an inline vector frog, locally hosted font assets and reduced-motion support are implemented; palette/spacing/frog details are disclosed fallback choices, not claimed recovered originals. A clarification was requested; none was available during implementation.

The requested root `DESIGN.md` conflicts with the higher-priority explicit path budget. Its complete source-derived contents are delivered at `docs/DESIGN.md`; no root file was created. `web/.gitignore` is the sole ignore file added, using the assignment's explicit path allowance. Patterns exclude nested dependency and cache directories.

The worker repository’s `.git` is mounted read-only. `git add web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`; the source/export could not be staged or committed here. All deliverable files remain on disk for the source-delivery mechanism. This is an environment limitation, not a successful commit. An attempted complete-history bundle check also required absent promisor objects and failed because Git could not write its temporary pack into read-only `.git`. The file inventory is about 2.91 MB uncompressed, but an actual final Git bundle size cannot be certified here; see `docs/validation/submission-check.json`.

No live transaction, feed report, allowance, swap, deployment, site publication or IPFS pin was performed. The feeds currently need authorized seeding before live feed-dependent operations can succeed. Published URLs/CIDs and later control-plane checks are intentionally outside this worker task.

## Build and integrity

Commands are run from the repository root unless shown otherwise:

```sh
npm install --prefix web --cache web/.npm --no-audit --no-fund
npm run typecheck --prefix web
npm run build --prefix web
npm run check:export --prefix web
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/imd-worker/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome npm test --prefix web
npm run check:rpc --prefix web
```

The build uses Node 22.22.1/npm 9.2.0, Vite, React and TypeScript. The export uses `base: './'`, one page and fragment links. Final command outcomes and export counts are in `docs/validation/final-checks.txt`; the browser/test log is `docs/validation/tests.txt`. Tests use the installed Chromium executable explicitly rather than downloading a second browser. Test/server output and caches are not delivery assets.

The post-build exporter reads raw ABI arrays using `git show` at `c622a1dd8c1c9d94a16272080c765d00e9aba7ab`, validates the five attested canonical Keccak hashes, and writes exact handoff identifiers/contracts and unchanged network/wallet-add-chain blocks. Every other file, including index, font assets, notices and seven ABI files, has a SHA-256 entry. Runtime configuration and deployed ABIs are fetched from that same manifest. Supplemental COMP/oracle addresses are discovered through the vault, and nonempty code and reciprocal links are checked before actions. See `docs/HANDOFF.md`.

## Interaction coverage

`web/tests/browser.spec.ts` exercises production HTML/assets using a mocked injected wallet and ABI-encoded JSON-RPC responses:

- Public feed reads, disconnected state and missing-wallet recovery.
- Unknown-chain error followed by exact `wallet_addEthereumChain` settings and a second switch.
- Exact IMD approval, deposit, collateral-backed COMP mint, direct repayment and debt-free withdrawal; checks receipt-driven balances/debt and transaction order. Repay requires no COMP approval.
- Invalid amount and wallet rejection recovery; signing blocked when contract code or an ABI hash is invalid.
- Stale-feed mint/debt-bearing-withdraw gates while repayment and debt-free withdrawal remain available.
- NHI changes updating minCR, countdown progression, and marks retaining their original grace snapshot.
- Work rights minting without debt, marking underwater positions, liquidation after grace, and clearing recovered marks.
- Native ETH/CPL quote and swap; CPL sale with explicit token-to-Permit2 and Permit2-to-router approvals before execution.
- Gateway-style subpath asset/config loading; local fonts, SVG presence, reduced motion, mobile address visibility and overflow/resource/console checks.

`web/tests/protocol.spec.ts` tests decimal precision rejection, uint256 limits, exact minCR interpolation, wei-level borrow/withdraw limits, stale recovery exceptions, grace/strict-expiry boundaries, manifest/path validation, canonical ABI hashing and decoded error messages. `web/tests/swap.spec.ts` independently decodes the nested router payload and verifies pool currency order, commands/actions, settlement/take minimums, native value, approval limits, account/network/expiry gates, absent code and simulation failure. These tests use mocks; they establish frontend intent and handling, not real transaction inclusion or executable live liquidity.

## Read-only live chain observation

At 2026-09-30 18:59:35 UTC, the configured PublicNode endpoint returned Sepolia chain ID 11155111 and block 11816612. All five handoff addresses had nonempty code. Both vault-created dependencies had code and their `vault()` links matched CDPVault. PriceFeed and NhiFeed both returned `(0, 0)`, `isStale=true`, `maxAge=86400`; minCR was 200%, grace 0 seconds and liquidation window 86400 seconds. The report is `docs/validation/rpc-check.txt`. Only the first successful configured endpoint was needed; the other two endpoints were not independently measured.

The production browser also loaded actual public RPC reads and displayed the unseeded feed state. This observation does not establish future availability or seed values. USD context is unavailable; the UI correctly labels price as COMP per IMD. Live wallet signing, real approvals/swaps, slippage outcomes, inclusion delays/replacements, authorized reporting and funded vault operations remain untested.

## Better Interface consolidated review

Applied the pinned guide during implementation, then reviewed all six domains against the runnable export. References and licenses remain in `docs/licenses/`. Domain coverage below does not imply screen-reader or full WCAG conformance.

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility | Checked native buttons/labels/details, heading/main/skip structure, semantic status, disabled prerequisites, reduced motion and keyboard focus. Keyboard activated skip, pause and action selection; focused skip ring visually inspected. | No screen-reader session, physical touch device or complete keyboard-only wallet-extension round trip. |
| Layout | Checked real export at 1440×1100, 820×1000 and 320×800; test export at 1440×1000, 390×844 and connected 320×844. No horizontal overflow; connected address/copy remain visible. | No RTL/localization variant; no browser-native zoom test. Root-font enlargement to 28px at 820px retained horizontal reflow, which is not native zoom. |
| Writing | Checked action labels against ABI calls, CPL/COMP distinction, COMP-per-IMD units, allowance sequencing, unseeded/stale explanations, and recoverable errors. | Attestation submission remains an external relayer integration path; the ordinary reporter path has controls. |
| Typography | Confirmed rendered IBM Plex Mono 400/500/600 faces were loaded locally, stable numbers, long address access and amount field labels. | Only Latin faces bundled; non-Latin fallback and alternative browsers not measured. |
| Colors | Measured rendered primary/surface 14.35:1, muted/surface 8.02:1, warning/surface 10.35:1 and primary-button ink/fill 12.73:1. Text accompanies status colors. | Original palette absent; not every possible focus/disabled/error pair measured. Dark-only interface has no theme toggle. |
| UI details | Checked neutral/primary/disabled/pending/error states, explicit quote review, sequential approvals, native disclosures, inline frog, motion pause and emulated reduced motion (`animation-name:none`). | No slow-motion devtools replay, native wallet overlay inspection or other browser-engine run. |

### Findings, corrections and rechecks

| Severity/domain | Source location | Finding and fix | Recheck |
| --- | --- | --- | --- |
| Medium / UI correctness | `web/src/App.tsx:241` | Concurrent manual/poll reads could let a late older response overwrite current state. Added generation and request sequence acceptance. | Source reviewed; connected refresh, feed update and transaction flows pass. |
| Medium / Accessibility & UI | `web/src/App.tsx:173` | Wallet gates inside forms inherited submit behavior. Explicit `type="button"` now isolates connect/switch actions. | Disconnected, wrong-chain and amount interaction tests pass. |
| Medium / UI correctness | `web/src/App.tsx:332` | Feed freshness could remain displayed beyond maxAge until the next poll. Derive conservative display/gates from observed chain time plus elapsed time; simulation remains authoritative. | Boundary arithmetic and stale-feed recovery tests pass. |
| Medium / Layout & accessibility | `web/src/style.css:596` | Mobile CSS hid the connected address. Retained a wrapping address/copy group. | 320px connected screenshot inspected; visibility and no-overflow assertions pass. |
| Medium / Writing | `web/src/protocol.ts:512` | Generic revert summaries lacked actionable explanations. Added named contract-error translation including stale feeds, unsafe ratios, grace/expiry and role errors. | Decoded custom-error and rejection tests pass. |
| Low / UI correctness | `web/src/App.tsx:987` | Re-inspecting the same target cleared its card without triggering a new effect. Retain current position until the next read. | Position inspection and liquidation flow tested. |

Screenshots: `docs/validation/live-desktop.png` and `live-mobile-320.png` show actual unseeded public feed reads; `desktop.png`, `mobile.png` and `connected-mobile320.png` show clearly identified mocked connected state; `keyboard-focus.png` shows the inspected focus ring. Screenshots are documentation evidence, not raster runtime assets. The live browser reported zero console warnings/errors and all requested static/config/ABI/font resources returned HTTP 200. Tests separately capture browser exceptions, failed requests and console errors.

The final delivery includes working source/export and reproducible local validation. Exact incumbent-design preservation and root design-document placement could not be satisfied with the supplied inputs and authorized paths; they are not represented as passes.
