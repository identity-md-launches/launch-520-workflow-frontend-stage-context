# Deployment and export binding

The supplied deployment handoff pins source commit `c622a1dd8c1c9d94a16272080c765d00e9aba7ab`, which was the repository HEAD before frontend work. The source was preserved. The build archives the supplied handoff and network inputs under `web/deployment/`; they are build inputs only. The app loads `dist/imd-deployment.json` and its referenced ABI assets as its runtime deployment configuration.

`web/scripts/export-deployment.mjs` reads every ABI directly with `git show <sourceCommit>:docs/abi/<Contract>.json`. Each file is a raw implementation-derived ABI array already exported at that commit. Canonical hashing recursively sorts object keys, preserves array order, serializes compact JSON, and hashes its UTF-8 bytes with Keccak-256. All five calculated hashes match the handoff:

| Contract | Canonical Keccak-256 |
| --- | --- |
| LaunchToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| MockIMD | `785554a073881eadc16cf50ec69aefac00a95db003ed535556ed6a0f054c0e17` |
| PriceFeed | `333fe01834bbc0b6131916860dafdde3d386c7b491f68d29d91dec03a61603bf` |
| NhiFeed | `333fe01834bbc0b6131916860dafdde3d386c7b491f68d29d91dec03a61603bf` |
| CDPVault | `a0dda71535f2de3d99e94ef64e866491366dc66cf0d7b8563ddff9550177b8c6` |

The supplemental `CompToken.json` and `MockWorkOracle.json` are copied from the same pinned commit and inventoried as assets. Their addresses are discovered through the vault's immutable getters and checked for deployed code and reciprocal `vault()` bindings. They do not extend the five-contract attested manifest set. CPL (LaunchToken) is the Uniswap launch asset; it is distinct from the vault-created COMP debt token.

After Vite completes, the export script writes the exact launch ID, chain ID, source commit, attestation hash and five name/address/ABI-hash bindings from the handoff. The supplied `network` and `walletAddChain` objects are copied unchanged. There are no extra top-level keys. Pool parameters in `web/deployment/pool.json` are the exact handoff pool object and are checked against it during every build; runtime Uniswap addresses come from the manifest's network object.

Every exported file except `imd-deployment.json` receives a lowercase SHA-256 digest in the manifest. Validation rejects mismatched inventories, extra manifest keys, unsafe paths, symlinks, non-files, dependency/cache packaging, more than 128 assets, files over 8 MiB, and exports of 8 MiB or more. The complete Git submission has a separate 8 MiB budget; export validation alone does not measure Git/source packaging. Re-run `npm run build` after any source or export modification; `npm run check:export` verifies without replacing the manifest.

`npm run check:rpc` performs read-only verification against the supplied public RPC list. It checks chain ID, code for all five handoff contracts, vault dependencies, code and reciprocal binding of the two created contracts, and reads both feeds plus minimum collateral ratio and grace/window settings at one block. It prints dated JSON evidence and exits nonzero if no endpoint can complete verification. It does not seed feeds, sign transactions, change allowances or redeploy anything. See the final validation record for the observed RPC outcome, browser tests and any untested live-chain behavior.

The publisher's later immutable-CID, named-hosting and RPC checks are outside this worker assignment and are not represented as completed here. No publication URL or CID is required to rebuild and review these delivered files.
