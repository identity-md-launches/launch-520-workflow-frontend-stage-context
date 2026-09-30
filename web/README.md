# COMP Sepolia frontend

Vite, React and TypeScript source for the deployed COMP vault and its price/NHI feeds. The committed static export is at repository-root `dist/`. No server, wallet key, private RPC credential, WalletConnect project ID or redeployment is required to serve it.

## Install, build and preview

Use Node.js 22.12 or newer and npm. The worker used Node 22.22.1 and npm 9.2.0. Run from `web/`:

```sh
npm ci
npm run typecheck
npm run build
npm run check:export
npm run preview
```

`npm run build` runs TypeScript checking, exports Vite assets with `base: './'`, and finally generates `../dist/imd-deployment.json`. Serve the complete `dist/` directory over HTTP(S); direct `file://` use cannot provide the expected JSON fetch behavior. Relative paths and single-page/hash links support gateway subpaths without rewrite rules. Keep the manifest and every listed asset together. The publisher hosts the committed files without rebuilding.

For source development, `npm run dev` starts Vite. To test runtime deployment loading in the normal static environment, build and use `npm run preview`; Vite's development server alone does not produce the runtime manifest. Rebuild after changing source, configuration or export bytes, and never hand-edit an already inventoried export file without regenerating its manifest.

## Configuration and integrity

`dist/imd-deployment.json` is the **only runtime deployment map**. `src/config.ts` loads and validates it, fetches the ABI JSON referenced by the same manifest, checks each fetched ABI's inventoried SHA-256 and its canonical Keccak hash, and constructs chain/RPC clients from its network block. ABI arrays are not maintained in a separate deployed-address map.

The archived worker inputs in `deployment/handoff.json` and `deployment/network.json` are build provenance, not a second runtime configuration. `deployment/pool.json` contains only the handoff's pool parameters and is checked against that handoff on every build. Network Uniswap addresses are always read from the runtime manifest. Do not edit these inputs to point this attested release at another deployment; a different release requires a corresponding validated handoff and new export.

`scripts/export-deployment.mjs` reads ABI arrays directly from `docs/abi/<Contract>.json` at the handoff's exact `sourceCommit`, so the repository must retain that Git commit. It verifies all five contract ABI hashes and copies the exact launch, chain, source, attestation and contract bindings. It copies `network` and optional `walletAddChain` unchanged, includes no extra top-level fields, and inventories every exported file except the manifest itself. It rejects unsafe paths, symlinks, dependency/cache packaging, more than 128 assets, oversized files and oversized exports. The whole Git submission has a separate 8 MiB budget; source and documentation also count.

COMP and its work oracle are created by the vault. Their addresses are read through `compToken()` and `oracle()` and checked for code and reciprocal `vault()` links. Their implementation-derived ABIs are supplemental inventoried assets, not invented extra entries in the handoff contract list. `docs/HANDOFF.md` records the binding and hashing method.

Frontend dependencies and configuration stay under `web/`. The explicit allowed ignore file, `web/.gitignore`, excludes dependency/cache/test-output directories at all nested levels. Do not commit `node_modules`, registry archives or package-manager caches. Root build configuration and deployed Solidity source remain outside this frontend assignment.

## Wallets and transaction flows

The interface supports the injected EIP-1193 browser wallet at `window.ethereum`, including compatible desktop extensions and wallet browsers. It reports a missing wallet and listens for account/network changes. It switches to the configured chain; if the wallet reports an unknown chain, it offers `wallet_addEthereumChain` with the supplied exact parameters and then retries switching. There is no WalletConnect integration or project ID in this release; adding one would be separate configuration and connector work.

Public reads use the ordered public RPC list in the manifest, with a correctly connected wallet provider as a fallback. Reads poll after completion at five-second intervals. Signing remains in the visitor's wallet. Contract-code, reciprocal-binding, fresh-state and chain/account checks gate actions. Wallet actions are simulated before signing, remain locked through a successful receipt and state refresh, and expose transaction links or persistent errors.

The main loop is an exact IMD approval, deposit, COMP mint, repay and withdraw. Repayment and liquidation burn the caller's COMP directly and require no COMP approval. Work minting consumes existing rights independently of collateral. Inspection supports marking underwater positions, clearing recovered marks and liquidation after stored grace; the countdown is an estimate advanced from the last observed block, while simulation checks actual eligibility. Reporter/faucet controls use permissions read from contracts. No initialization transaction is offered because this deployment is already bound in its constructor.

Feed price means **COMP per IMD**, not dollars. Values use the token/feed decimals. NHI determines effective `minCR()` and current grace; marked positions retain their own grace snapshot. Unseeded or stale feeds stop minting, work minting, liquidation and debt-bearing withdrawals. Deposit, repay and debt-free withdrawal remain available for recovery. CPL is the separate COMP Launch asset, not the vault's COMP token.

The CPL/ETH panel quotes through the configured Uniswap v4 quoter with simulation only. It applies visitor slippage, displays minimum output and expires quotes after 60 seconds. Token sales require separate exact-amount token-to-Permit2 and Permit2-to-router approvals; the latter expires after ten minutes. ETH input needs no approval. Execution uses the configured Universal Router after simulation, with a five-minute deadline. The request encoding follows the [Uniswap v4 swap guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping); quoting follows its [quote guide](https://developers.uniswap.org/docs/sdks/v4/guides/swapping/quoting).

## Validation

After building, run:

```sh
npm run typecheck
npm run check:export
npm test
npm run check:rpc
```

The Playwright configuration serves the existing static export for the test lifetime. Install its Chromium once if your environment does not already provide one:

```sh
npx playwright install chromium
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed compatible Chromium executable. The test runner writes transient results to `test/scratch/playwright-results`, which is not delivered. It does not rebuild, so run the production build first.

`tests/protocol.spec.ts` checks exact arithmetic, amount precision, freshness/recovery boundaries, snapshotted liquidation timing and manifest validation. `tests/swap.spec.ts` reuses the RPC fixture through viem custom transports to test quotation, decoded swap payloads, both approval steps, native value, account/network changes, expiry, code and simulation failure without a browser fixture or live network. Browser interaction tests use mocked wallet/RPC responses. `npm run check:rpc` performs read-only chain/code/binding/feed checks through the public configured endpoints and returns a nonzero status if none completes; it never signs or broadcasts.

The final validation documentation records commands actually run, outcomes, browser coverage and limitations. Mocked confirmations are not live-chain transactions. This worker does not seed feeds, spend test assets, validate real wallet transaction inclusion, publish, pin to IPFS, register a site name or perform the publisher's later hosting checks.

## Design and known input limits

`docs/DESIGN.md` documents the implemented tokens, IBM Plex Mono faces, inline frog, components, motion and responsive rules. The original site assets and stated original hex palette were absent from the supplied tree and reachable history, so exact visual preservation is unverified and the implemented values are explicitly identified as fallback choices. The task's permitted write paths exclude root `DESIGN.md`; the design document is delivered under the allowed `docs/` path.

No raster runtime assets are used. Fonts ship locally. Live indicators stop for `prefers-reduced-motion`, and a manual pause is available. The final hosting domain was not supplied, so absolute-domain Open Graph image metadata is not invented. Supplied Better Interface and ETH frontend UX license notices remain in `docs/licenses/`; IBM Plex Mono is distributed by its font package under the SIL Open Font License.
