import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, maxUint256, parseEther, toHex, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { permit2Abi, quoterAbi, universalRouterAbi } from '../src/swap';

const root = resolve(import.meta.dirname, '../..');
const deployment = JSON.parse(readFileSync(resolve(root, 'dist/imd-deployment.json'), 'utf8'));
const abi = (name: string) => JSON.parse(readFileSync(resolve(root, 'dist/abi', `${name}.json`), 'utf8')) as Abi;
export const account = '0x1111111111111111111111111111111111111111' as Address;
const operator = '0x2222222222222222222222222222222222222222' as Address;
const comp = '0x3333333333333333333333333333333333333333' as Address;
const oracle = '0x4444444444444444444444444444444444444444' as Address;
const zeroHash = `0x${'0'.repeat(64)}` as Hex;
const blockHash = `0x${'a'.repeat(64)}` as Hex;

export class RpcFixture {
  addresses = Object.fromEntries(deployment.contracts.map((contract: any) => [contract.name, contract.address as Address]));
  contracts = new Map<string, { name: string; abi: Abi }>([
    ...deployment.contracts.map((contract: any) => [contract.address.toLowerCase(), { name: contract.name, abi: abi(contract.name) }] as [string, {name:string;abi:Abi}]),
    [comp.toLowerCase(), { name: 'CompToken', abi: abi('CompToken') }],
    [oracle.toLowerCase(), { name: 'MockWorkOracle', abi: abi('MockWorkOracle') }],
    [deployment.network.uniswapV4.quoter.toLowerCase(), { name: 'Quoter', abi: quoterAbi }],
    [deployment.network.uniswapV4.permit2.toLowerCase(), { name: 'Permit2', abi: permit2Abi }],
    [deployment.network.uniswapV4.universalRouter.toLowerCase(), { name: 'UniversalRouter', abi: universalRouterAbi }],
  ]);
  walletMethods: string[] = [];
  sent: { name: string; functionName: string; args: readonly unknown[]; to: Address; value: bigint }[] = [];
  calls: string[] = [];
  unknown: string[] = [];
  connected = false;
  walletChain = deployment.chainId;
  unknownChain = false;
  rejectSend = false;
  rejectConnect = false;
  missingCode = false;
  stale = false;
  price = parseEther('1');
  nhi = parseEther('0.85');
  collateral = 0n;
  debt = 0n;
  imdBalance = parseEther('1000');
  compBalance = 0n;
  allowance = 0n;
  cplAllowance = 0n;
  permitAllowance = 0n;
  permitExpiration = 0;
  rights = parseEther('50');
  totalWorkMinted = 0n;
  mark: readonly [bigint, bigint, boolean] = [0n, 0n, false];
  now = BigInt(Math.floor(Date.now() / 1000));
  blockNumber = 11818000n;
  addChainParams: unknown;

  get minCR() {
    if (this.nhi <= parseEther('0.6')) return 200n;
    if (this.nhi >= parseEther('0.85')) return 150n;
    return 150n + ((parseEther('0.85') - this.nhi) * 50n + parseEther('0.25') - 1n) / parseEther('0.25');
  }
  get grace() {
    if (this.nhi <= parseEther('0.6')) return 0n;
    if (this.nhi >= parseEther('0.85')) return 21600n;
    return (this.nhi - parseEther('0.6')) * 21600n / parseEther('0.25');
  }
  get ratio() { return this.debt === 0n ? maxUint256 : this.collateral * this.price * 100n / this.debt / parseEther('1'); }

  async install(page: Page, wallet = true) {
    await page.route('**/__wallet_rpc', async (route) => {
      const payload = route.request().postDataJSON();
      let response;
      try { response = { jsonrpc: '2.0', id: payload.id, result: await this.handle(payload.method, payload.params ?? [], true) }; }
      catch (error) { response = { jsonrpc: '2.0', id: payload.id, error: { code: (error as any).code ?? -32000, message: (error as Error).message } }; }
      await route.fulfill({ json: response });
    });
    for (const rpc of deployment.network.rpcUrls) await page.route(`${rpc.replace(/\/$/, '')}/**`, async route => this.fulfillRpc(route));
    for (const rpc of deployment.network.rpcUrls) await page.route(rpc, async route => this.fulfillRpc(route));
    if (wallet) await page.addInitScript(() => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      (window as any).ethereum = {
        isMetaMask: true,
        on(event: string, callback: (...args: unknown[]) => void) { const set = listeners.get(event) ?? new Set(); set.add(callback); listeners.set(event, set); },
        removeListener(event: string, callback: (...args: unknown[]) => void) { listeners.get(event)?.delete(callback); },
        async request(payload: { method: string; params?: unknown[] }) {
          const response = await fetch('/__wallet_rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, id: 1, jsonrpc: '2.0' }) });
          const body = await response.json();
          if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
          return body.result;
        },
      };
      (window as any).__emitWallet = (event: string, value: unknown) => listeners.get(event)?.forEach(callback => callback(value));
    });
  }

  async fulfillRpc(route: any) {
    const request = route.request().postDataJSON();
    const reply = async (payload: any) => {
      try { return { jsonrpc: '2.0', id: payload.id, result: await this.handle(payload.method, payload.params ?? []) }; }
      catch (error) { return { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: (error as Error).message } }; }
    };
    await route.fulfill({ json: Array.isArray(request) ? await Promise.all(request.map(reply)) : await reply(request) });
  }

  async handle(method: string, params: any[], wallet = false): Promise<any> {
    if (wallet) this.walletMethods.push(method);
    switch (method) {
      case 'eth_accounts': return this.connected ? [account] : [];
      case 'eth_requestAccounts':
        if (this.rejectConnect) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
        this.connected = true; return [account];
      case 'eth_chainId': return toHex(wallet ? this.walletChain : deployment.chainId);
      case 'wallet_switchEthereumChain':
        if (this.unknownChain) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
        this.walletChain = Number(params[0].chainId); return null;
      case 'wallet_addEthereumChain': this.addChainParams = params[0]; this.unknownChain = false; return null;
      case 'eth_getCode': return this.missingCode ? '0x' : '0x60006000';
      case 'eth_blockNumber': return toHex(this.blockNumber);
      case 'eth_getBalance': return toHex(parseEther('10'));
      case 'eth_gasPrice': return toHex(1_000_000_000n);
      case 'eth_maxPriorityFeePerGas': return toHex(1_000_000_000n);
      case 'eth_estimateGas': return toHex(100_000n);
      case 'eth_getTransactionCount': return toHex(this.sent.length);
      case 'eth_getLogs': return [];
      case 'eth_getBlockByNumber':
      case 'eth_getBlockByHash': return this.block();
      case 'eth_getTransactionReceipt': return this.receipt(params[0]);
      case 'eth_getTransactionByHash': return this.transaction(params[0]);
      case 'eth_call': return this.call(params[0]);
      case 'eth_sendTransaction': {
        if (this.rejectSend) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
        const tx = params[0];
        const entry = this.contracts.get(tx.to.toLowerCase());
        if (!entry) throw new Error(`Unknown transaction target ${tx.to}`);
        const decoded = decodeFunctionData({ abi: entry.abi, data: tx.data });
        this.sent.push({ name: entry.name, functionName: decoded.functionName, args: decoded.args ?? [], to: tx.to, value: BigInt(tx.value ?? '0x0') });
        this.apply(entry.name, decoded.functionName, decoded.args ?? []);
        this.blockNumber += 1n;
        return toHex(BigInt(this.sent.length), { size: 32 });
      }
      default: this.unknown.push(method); throw new Error(`Unexpected mock RPC: ${method}`);
    }
  }

  call(tx: { to: string; data: Hex }) {
    const entry = this.contracts.get(tx.to.toLowerCase());
    if (!entry) { this.unknown.push(`target:${tx.to}`); throw new Error(`Unknown eth_call target ${tx.to}`); }
    const decoded = decodeFunctionData({ abi: entry.abi, data: tx.data });
    const fn = decoded.functionName;
    this.calls.push(`${entry.name}.${fn}`);
    if (fn === 'quoteExactInputSingle') {
      const params = decoded.args![0] as any;
      return encodeFunctionResult({ abi: entry.abi, functionName: fn, result: [params.zeroForOne ? params.exactAmount * 100n : params.exactAmount / 100n, 100000n] });
    }
    const values: Record<string, any> = {
      imdToken: this.addresses.MockIMD, compToken: comp, oracle, priceFeed: this.addresses.PriceFeed, nhiFeed: this.addresses.NhiFeed,
      vault: this.addresses.CDPVault, deployer: operator, decimals: 18, allowance: entry.name === 'Permit2' ? [this.permitAllowance, this.permitExpiration, 0] : entry.name === 'LaunchToken' ? this.cplAllowance : this.allowance,
      name: entry.name === 'CompToken' ? 'Compute Money' : entry.name === 'MockIMD' ? 'Identity MD' : 'COMP Launch',
      symbol: entry.name === 'CompToken' ? 'COMP' : entry.name === 'MockIMD' ? 'IMD' : 'CPL',
      balanceOf: entry.name === 'CompToken' ? this.compBalance : entry.name === 'MockIMD' ? this.imdBalance : parseEther('100'),
      totalSupply: parseEther('1000000'), mintingRights: this.rights, totalWorkMinted: this.totalWorkMinted,
      positions: [this.collateral, this.debt], liquidationMarks: this.mark, collateralRatio: this.ratio,
      minCR: this.minCR, gracePeriod: this.grace, liquidationWindow: 86400n, LIQUIDATION_BONUS_PERCENT: 10n,
      latestValue: [entry.name === 'NhiFeed' ? this.nhi : this.price, this.stale ? this.now - 90000n : this.now],
      isStale: this.stale, maxAge: 86400n, maxDeviationBps: 2000n, quorum: 1, reportCount: 0, round: 1n,
      isReporter: false, relayer: operator, attester: operator, reporter0: operator, reporter1: zeroAddress, reporter2: zeroAddress,
      attestationChainId: 1n, attestationAnswerType: 1, usedRequests: false, lastReportedRound: 0n,
      ATTESTATION_TYPEHASH: zeroHash, DOMAIN_SEPARATOR: zeroHash,
    };
    const item: any = entry.abi.find((item: any) => item.type === 'function' && item.name === fn);
    if (item.stateMutability !== 'view' && item.stateMutability !== 'pure') return encodeFunctionResult({ abi: entry.abi, functionName: fn, result: item.outputs.length ? true : undefined });
    if (!(fn in values)) { this.unknown.push(`${entry.name}.${fn}`); throw new Error(`Unexpected view: ${entry.name}.${fn}`); }
    return encodeFunctionResult({ abi: entry.abi, functionName: fn, result: values[fn] });
  }

  apply(name: string, fn: string, args: readonly unknown[]) {
    const amount = args[0] as bigint;
    switch (fn) {
      case 'approve':
        if (name === 'Permit2') { this.permitAllowance = args[2] as bigint; this.permitExpiration = Number(args[3]); }
        else if (name === 'LaunchToken') this.cplAllowance = args[1] as bigint;
        else this.allowance = args[1] as bigint;
        break;
      case 'depositCollateral': this.imdBalance -= amount; this.collateral += amount; this.allowance -= amount; break;
      case 'mintCOMP': this.debt += amount; this.compBalance += amount; break;
      case 'repayCOMP': this.debt -= amount; this.compBalance -= amount; break;
      case 'withdrawCollateral': this.collateral -= amount; this.imdBalance += amount; break;
      case 'mintFromWork': this.rights -= amount; this.compBalance += amount; this.totalWorkMinted += amount; break;
      case 'markUnderwater': this.mark = [this.now, this.grace, true]; break;
      case 'clearRecoveredMark': this.mark = [0n, 0n, false]; break;
      case 'liquidate': {
        const repaid = args[1] as bigint;
        const seized = repaid * 1100000000000000000n / this.price;
        this.debt -= repaid; this.compBalance -= repaid; this.collateral -= seized; this.imdBalance += seized;
        break;
      }
      case 'report': if (name === 'NhiFeed') this.nhi = amount; else this.price = amount; break;
    }
  }

  block() {
    return { hash: blockHash, parentHash: zeroHash, number: toHex(this.blockNumber), timestamp: toHex(this.now), nonce: '0x0000000000000000', sha3Uncles: zeroHash, logsBloom: `0x${'0'.repeat(512)}`, transactionsRoot: zeroHash, stateRoot: zeroHash, receiptsRoot: zeroHash, miner: zeroAddress, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', baseFeePerGas: '0x3b9aca00', transactions: [], uncles: [], mixHash: zeroHash };
  }
  receipt(hash: Hex) {
    const tx = this.sent[Number(BigInt(hash)) - 1];
    if (!tx) return null;
    return { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: toHex(this.blockNumber), from: account, to: tx.to, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' };
  }
  transaction(hash: Hex) {
    return { hash, nonce: '0x0', blockHash, blockNumber: toHex(this.blockNumber), transactionIndex: '0x0', from: account, to: this.sent[Number(BigInt(hash)) - 1]?.to, value: '0x0', gas: '0x186a0', gasPrice: '0x3b9aca00', input: '0x', v: '0x0', r: zeroHash, s: zeroHash, type: '0x2', chainId: toHex(deployment.chainId) };
  }
}
