import { expect, test } from '@playwright/test';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, maxUint256, parseAbi } from 'viem';
import { canonicalJson, safeRelativePath, validateManifest } from '../src/config';
import { collateralRatio, effectiveMinCR, errorMessage, markTiming, maximumMint, maximumWithdrawal, parseAmount, type PositionState, type Snapshot } from '../src/protocol';
import { readFileSync } from 'node:fs';
const handoff = JSON.parse(readFileSync(new URL('../deployment/handoff.json', import.meta.url), 'utf8'));
const network = JSON.parse(readFileSync(new URL('../deployment/network.json', import.meta.url), 'utf8'));

const unit = 10n ** 18n;
const owner = '0x0000000000000000000000000000000000000001';
function position(collateral = 300n * unit, debt = 100n * unit): PositionState {
  return { owner, collateral, debt, ratio: 300n, healthy: true, mark: { markedAt: 0n, grace: 0n, marked: false } };
}
function snapshot(collateral = 300n * unit, debt = 100n * unit, price = unit, minCR = 150n): Snapshot {
  return { position: position(collateral, debt), feedsFresh: true, price: { value: price }, minCR } as Snapshot;
}
function manifest() {
  return { version: 1, launchId: handoff.launchId, chainId: handoff.chainId, sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map(item => ({ name: item.name, address: item.address, abiHash: item.abiHash, abiPath: `abi/${item.name}.json` })),
    assets: [{ path: 'index.html', sha256: '0'.repeat(64) }], ...network };
}

test('token inputs preserve every wei and reject silent rounding or unsafe notation', () => {
  expect(parseAmount('0.000000000000000001')).toBe(1n);
  expect(parseAmount('9007199254740993.000000000000000001')).toBe(9007199254740993000000000000000001n);
  for (const input of ['0', '-1', '1e18', 'NaN', 'Infinity', '0.0000000000000000001', '1.0000000000000000001', '1,000']) expect(() => parseAmount(input)).toThrow();
  expect(() => parseAmount((maxUint256 + 1n).toString(), 0)).toThrow();
});

test('NHI thresholds and ceiling preserve minimum collateral requirements', () => {
  expect(effectiveMinCR(0n)).toBe(200n);
  expect(effectiveMinCR(600_000_000_000_000_000n)).toBe(200n);
  expect(effectiveMinCR(725_000_000_000_000_000n)).toBe(175n);
  expect(effectiveMinCR(849_999_999_999_999_999n)).toBe(151n);
  expect(effectiveMinCR(850_000_000_000_000_000n)).toBe(150n);
  expect(effectiveMinCR(unit)).toBe(150n);
});

test('borrowing and withdrawal ceilings remain safe at a one-wei boundary', () => {
  const sample = snapshot();
  expect(maximumMint(sample)).toBe(100n * unit);
  expect(maximumWithdrawal(sample)).toBe(150n * unit);
  expect(collateralRatio(300n * unit, 200n * unit + 1n, unit)).toBe(149n);
  expect(collateralRatio(150n * unit - 1n, 100n * unit, unit)).toBe(149n);
  const fractional = snapshot(10n, 1n, unit, 150n);
  expect(maximumWithdrawal(fractional)).toBe(8n);
  expect(collateralRatio(2n, 1n, unit)).toBe(200n);
  expect(collateralRatio(1n, 1n, unit)).toBe(100n);
  expect(collateralRatio(1n, 0n, 0n)).toBe(maxUint256);
  expect(collateralRatio(maxUint256, 1n, maxUint256)).toBe(maxUint256);
});

test('stale feeds stop risk-increasing amounts while debt-free exits remain available', () => {
  const stale = { ...snapshot(), feedsFresh: false };
  expect(maximumMint(stale)).toBe(0n);
  expect(maximumWithdrawal(stale)).toBe(0n);
  expect(maximumWithdrawal({ ...stale, position: position(33n, 0n) })).toBe(33n);
  expect(maximumMint(snapshot(100n, 100n))).toBe(0n);
});

test('liquidation snapshot grace is actionable at its end and expires strictly after the window', () => {
  const marked = { ...position(), healthy: false, mark: { marked: true, markedAt: 1_000n, grace: 600n } };
  expect(markTiming(marked, 100n, 1_599n)).toMatchObject({ remaining: 1n, actionable: false, expired: false });
  expect(markTiming(marked, 100n, 1_600n)).toMatchObject({ remaining: 0n, actionable: true, expired: false });
  expect(markTiming(marked, 100n, 1_700n)).toMatchObject({ actionable: true, expired: false });
  expect(markTiming(marked, 100n, 1_701n)).toMatchObject({ actionable: false, expired: true });
  expect(markTiming({ ...marked, healthy: true }, 100n, 1_600n).actionable).toBe(false);
});

test('runtime configuration rejects chain, address and asset path divergence', () => {
  expect(validateManifest(manifest()).chainId).toBe(handoff.chainId);
  expect(() => validateManifest({ ...manifest(), chainId: 1 })).toThrow(/network mismatch/);
  expect(() => validateManifest({ ...manifest(), router: owner })).toThrow(/unsupported top-level/);
  expect(() => validateManifest({ ...manifest(), assets: [{ path: '../escape.json', sha256: '0'.repeat(64) }] })).toThrow(/invalid asset/);
  const duplicate = manifest();
  duplicate.contracts.push(duplicate.contracts[0]);
  expect(() => validateManifest(duplicate)).toThrow(/duplicate contract/);
  for (const path of ['../index.html', '/index.html', 'https://host/abi.json', 'abi/%2e%2e/file.json', 'abi\\file.json', 'abi/file.json?x']) expect(safeRelativePath(path)).toBe(false);
  expect(safeRelativePath('abi/CompToken.json')).toBe(true);
});

test('canonical ABI JSON sorts nested object keys while preserving array order', () => {
  expect(canonicalJson([{ z: 3, inputs: [{ type: 'address', name: 'owner' }], a: 1 }])).toBe('[{"a":1,"inputs":[{"name":"owner","type":"address"}],"z":3}]');
});


test('simulation failures explain recoverable contract errors and wallet rejection', () => {
  const abi = parseAbi(['error StaleFeed()', 'error GracePeriodNotElapsed()']);
  const stale = new ContractFunctionRevertedError({ abi, data: encodeErrorResult({ abi, errorName: 'StaleFeed' }), functionName: 'mintCOMP' });
  expect(errorMessage(new BaseError('Simulation failed', { cause: stale }))).toContain('stale or unseeded');
  const grace = new ContractFunctionRevertedError({ abi, data: encodeErrorResult({ abi, errorName: 'GracePeriodNotElapsed' }), functionName: 'liquidate' });
  expect(errorMessage(grace)).toContain('grace period has not ended');
  expect(errorMessage({ code: 4001 })).toContain('No transaction was sent');
});
