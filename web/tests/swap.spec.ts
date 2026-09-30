import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, custom, decodeAbiParameters, defineChain, parseAbiParameters, parseEther, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import type { Deployment } from '../src/config';
import { approveSwapPermit2, approveSwapToken, encodeSwap, executeSwap, quoteSwap, readSwapAllowances, verifySwapContracts } from '../src/swap';
import { account, RpcFixture } from './rpc-fixture';

// Reuse the browser suite's RPC model through viem transports. These tests use
// no page fixture, wallet extension, public RPC, funds or live transactions.
const dist = resolve(import.meta.dirname, '../../dist');
const manifest = JSON.parse(readFileSync(resolve(dist, 'imd-deployment.json'), 'utf8'));
const loadAbi = (path: string) => JSON.parse(readFileSync(resolve(dist, path), 'utf8')) as Abi;
const chain = defineChain({ id: manifest.chainId, name: manifest.network.name, nativeCurrency: manifest.network.nativeCurrency, rpcUrls: { default: { http: manifest.network.rpcUrls } } });
const deployment: Deployment = {
  manifest, network: manifest.network, chain,
  contracts: Object.fromEntries(manifest.contracts.map((contract: any) => [contract.name, { ...contract, abi: loadAbi(contract.abiPath) }])),
  supplemental: { CompToken: loadAbi('abi/CompToken.json'), MockWorkOracle: loadAbi('abi/MockWorkOracle.json') },
};

function harness() {
  const rpc = new RpcFixture();
  rpc.connected = true;
  const state = { rejectSimulation: false, activeAccount: account as Address };
  const transport = (wallet: boolean) => custom({ request: async ({ method, params }) => {
    if (wallet && method === 'eth_accounts') return [state.activeAccount, account];
    if (!wallet && method === 'eth_call' && state.rejectSimulation) throw new Error('Simulation rejected by test RPC');
    return rpc.handle(method, (params ?? []) as any[], wallet);
  } }, { retryCount: 0 });
  return { rpc, state, client: createPublicClient({ chain, transport: transport(false) }), wallet: createWalletClient({ chain, account, transport: transport(true) }) };
}

test('quote simulates the configured quoter and applies slippage without a wallet transaction', async () => {
  const { client, rpc } = harness();
  const quote = await quoteSwap(deployment, client, account, 'buy', parseEther('1'), 50);
  expect(quote.amountOut).toBe(parseEther('100'));
  expect(quote.minimumOut).toBe(parseEther('99.5'));
  expect(quote.expiresAt - quote.quotedAt).toBe(60_000);
  expect(rpc.calls).toContain('Quoter.quoteExactInputSingle');
  expect(rpc.sent).toHaveLength(0);
  expect(rpc.walletMethods).toHaveLength(0);
});

test('v4 encoding preserves sorted currencies, input settlement, minimum output and native ETH value', async () => {
  const { client } = harness();
  const quote = await quoteSwap(deployment, client, account, 'buy', parseEther('1'), 50);
  const encoded = encodeSwap(deployment, quote, 1_800_000_300n);
  expect(encoded.commands).toBe('0x10');
  expect(encoded.value).toBe(parseEther('1'));
  const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes, bytes[]'), encoded.inputs[0]);
  expect(actions).toBe('0x060c0f');
  expect(params).toHaveLength(3);
  const [swap] = decodeAbiParameters(parseAbiParameters('((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)'), params[0]);
  expect(swap.poolKey.currency0).toBe(zeroAddress);
  expect(swap.poolKey.currency1.toLowerCase()).toBe(deployment.contracts.LaunchToken.address.toLowerCase());
  expect(swap.poolKey).toMatchObject({ fee: 3000, tickSpacing: 60, hooks: zeroAddress });
  expect(swap).toMatchObject({ zeroForOne: true, amountIn: parseEther('1'), amountOutMinimum: parseEther('99.5'), hookData: '0x' });
  const [settleCurrency, settleAmount] = decodeAbiParameters(parseAbiParameters('address, uint256'), params[1]);
  const [takeCurrency, takeMinimum] = decodeAbiParameters(parseAbiParameters('address, uint256'), params[2]);
  expect(settleCurrency.toLowerCase()).toBe(quote.input.toLowerCase());
  expect(settleAmount).toBe(quote.amountIn);
  expect(takeCurrency.toLowerCase()).toBe(quote.output.toLowerCase());
  expect(takeMinimum).toBe(quote.minimumOut);
});

test('native buy simulates and confirms router execute without any approval', async () => {
  const { client, wallet, rpc } = harness();
  const quote = await quoteSwap(deployment, client, account, 'buy', parseEther('1'), 50);
  expect((await readSwapAllowances(deployment, client, account, quote)).nextStep).toBe('swap');
  const hashes: Hex[] = [];
  await executeSwap(deployment, client, wallet, account, quote, hash => hashes.push(hash));
  expect(rpc.sent).toHaveLength(1);
  expect(rpc.sent[0]).toMatchObject({ name: 'UniversalRouter', functionName: 'execute', value: parseEther('1') });
  expect(rpc.sent[0].to.toLowerCase()).toBe(deployment.network.uniswapV4.universalRouter.toLowerCase());
  expect(rpc.calls).toContain('UniversalRouter.execute');
  expect(hashes).toHaveLength(1);
});

test('CPL sell uses two separate exact approvals before zero-value router execution', async () => {
  const { client, wallet, rpc } = harness();
  const quote = await quoteSwap(deployment, client, account, 'sell', parseEther('1'), 50);
  expect(quote.zeroForOne).toBe(false);
  expect((await readSwapAllowances(deployment, client, account, quote)).nextStep).toBe('approve-token');
  await expect(executeSwap(deployment, client, wallet, account, quote)).rejects.toThrow(/approval is required/);
  await expect(approveSwapPermit2(deployment, client, wallet, account, quote)).rejects.toThrow(/Approve the token/);
  expect(rpc.sent).toHaveLength(0);
  await approveSwapToken(deployment, client, wallet, account, quote);
  expect(rpc.sent[0].name).toBe('LaunchToken');
  expect((rpc.sent[0].args[0] as string).toLowerCase()).toBe(deployment.network.uniswapV4.permit2.toLowerCase());
  expect(rpc.sent[0].args[1]).toBe(quote.amountIn);
  expect((await readSwapAllowances(deployment, client, account, quote)).nextStep).toBe('approve-permit2');
  await approveSwapPermit2(deployment, client, wallet, account, quote);
  expect(rpc.sent[1].name).toBe('Permit2');
  expect((rpc.sent[1].args[1] as string).toLowerCase()).toBe(deployment.network.uniswapV4.universalRouter.toLowerCase());
  expect(rpc.sent[1].args[2]).toBe(quote.amountIn);
  expect(rpc.sent[1].args[3]).toBe(Number(rpc.now + 600n));
  expect((await readSwapAllowances(deployment, client, account, quote)).nextStep).toBe('swap');
  expect(await approveSwapToken(deployment, client, wallet, account, quote)).toBeNull();
  expect(await approveSwapPermit2(deployment, client, wallet, account, quote)).toBeNull();
  expect(rpc.sent).toHaveLength(2);
  await executeSwap(deployment, client, wallet, account, quote);
  expect(rpc.sent[2]).toMatchObject({ name: 'UniversalRouter', functionName: 'execute', value: 0n });
});

test('expired quotes, wrong chain and changed active account block signing', async () => {
  const { client, wallet, rpc, state } = harness();
  const quote = await quoteSwap(deployment, client, account, 'buy', parseEther('1'), 50);
  await expect(executeSwap(deployment, client, wallet, account, { ...quote, expiresAt: Date.now() - 1 })).rejects.toThrow(/quote expired/);
  rpc.walletChain = 1;
  await expect(executeSwap(deployment, client, wallet, account, quote)).rejects.toThrow(/Switch your wallet/);
  rpc.walletChain = manifest.chainId;
  state.activeAccount = '0x2222222222222222222222222222222222222222';
  await expect(executeSwap(deployment, client, wallet, account, quote)).rejects.toThrow(/account changed/);
  expect(rpc.sent).toHaveLength(0);
});

test('simulation failure and missing contract code prevent a wallet request', async () => {
  const { client, wallet, rpc, state } = harness();
  const quote = await quoteSwap(deployment, client, account, 'buy', parseEther('1'), 50);
  state.rejectSimulation = true;
  await expect(executeSwap(deployment, client, wallet, account, quote)).rejects.toThrow(/Simulation rejected/);
  expect(rpc.sent).toHaveLength(0);
  state.rejectSimulation = false;
  rpc.missingCode = true;
  await expect(verifySwapContracts(deployment, client)).rejects.toThrow(/No .* contract code/);
  expect(rpc.sent).toHaveLength(0);
});

test('amount and slippage bounds prevent unusable quotes', async () => {
  const { client, rpc } = harness();
  await expect(quoteSwap(deployment, client, account, 'buy', 1n << 128n, 50)).rejects.toThrow(/swap limit/);
  await expect(quoteSwap(deployment, client, account, 'buy', 0n, 50)).rejects.toThrow(/positive amount/);
  await expect(quoteSwap(deployment, client, account, 'buy', 1n, 501)).rejects.toThrow(/slippage/);
  await expect(quoteSwap(deployment, client, account, 'buy', 1n, -1)).rejects.toThrow(/slippage/);
  expect(rpc.calls).toHaveLength(0);
  expect(rpc.sent).toHaveLength(0);
});
