import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  getAddress,
  http,
  isAddressEqual,
  maxUint256,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash,
  type PublicClient,
  type Transport,
  type Chain,
} from "viem";
import type { ContractConfig, Deployment } from "./config";

export type WalletProvider = EIP1193Provider;
export interface Protocol {
  deployment: Deployment;
  client: PublicClient<Transport, Chain>;
  verified: boolean;
  bindings?: { comp: ContractConfig; oracle: ContractConfig };
}
export interface FeedState {
  value: bigint;
  updatedAt: bigint;
  maxAge: bigint;
  stale: boolean;
}
export interface PositionState {
  owner: Address;
  collateral: bigint;
  debt: bigint;
  ratio: bigint | null;
  healthy: boolean | null;
  mark: { markedAt: bigint; grace: bigint; marked: boolean };
}
export interface Snapshot {
  blockNumber: bigint;
  blockTimestamp: bigint;
  fetchedAt: number;
  price: FeedState;
  nhi: FeedState;
  minCR: bigint;
  gracePeriod: bigint;
  liquidationWindow: bigint;
  feedsFresh: boolean;
  compAddress: Address;
  oracleAddress: Address;
  imdDecimals: number;
  compDecimals: number;
  cplDecimals: number;
  totalSupply: bigint;
  totalWorkMinted: bigint;
  ethBalance: bigint;
  imdBalance: bigint;
  compBalance: bigint;
  cplBalance: bigint;
  imdAllowance: bigint;
  rights: bigint;
  position: PositionState | null;
  priceReporter: boolean;
  nhiReporter: boolean;
  imdOperator: Address;
  workOperator: Address;
}
export interface ContractAction {
  contract: string;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}
export type TransactionStage = {
  stage: "simulating" | "signing" | "pending" | "confirmed";
  hash?: Hash;
};

/** Public RPCs are authoritative; a correctly connected wallet can serve as a read fallback. */
export function createProtocol(
  deployment: Deployment,
  provider?: WalletProvider,
): Protocol {
  const transports: Transport[] = deployment.network.rpcUrls.map((url) =>
    http(url, { timeout: 12_000, retryCount: 1 }),
  );
  if (provider)
    transports.push(
      custom(
        {
          request: async ({ method, params }) => {
            const current = await provider.request({ method: "eth_chainId" });
            if (Number(current) !== deployment.manifest.chainId)
              throw new Error("Wallet read fallback is on the wrong network.");
            return provider.request({ method, params } as Parameters<
              WalletProvider["request"]
            >[0]);
          },
        },
        { retryCount: 0 },
      ),
    );
  return {
    deployment,
    client: createPublicClient({
      chain: deployment.chain,
      transport: fallback(transports, { rank: false }),
      batch: { multicall: false },
    }),
    verified: false,
  };
}
export function contractFor(protocol: Protocol, name: string): ContractConfig {
  const contract =
    name === "CompToken"
      ? protocol.bindings?.comp
      : name === "MockWorkOracle"
        ? protocol.bindings?.oracle
        : protocol.deployment.contracts[name];
  if (!contract) throw new Error(`Contract ${name} is not verified.`);
  return contract;
}
export async function readContract<T = unknown>(
  protocol: Protocol,
  contractName: string,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<T> {
  const contract = contractFor(protocol, contractName);
  return protocol.client.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
    ...(blockNumber === undefined ? {} : { blockNumber }),
  }) as Promise<T>;
}
async function requireCode(
  protocol: Protocol,
  address: Address,
  name: string,
): Promise<void> {
  const code = await protocol.client.getCode({ address });
  if (!code || code === "0x")
    throw new Error(
      `No deployed code found for ${name}. Transactions remain disabled.`,
    );
}
/** Validate code plus immutable reciprocal dependencies before any signing is enabled. */
export async function verifyDeployment(protocol: Protocol): Promise<void> {
  protocol.verified = false;
  if (
    (await protocol.client.getChainId()) !==
    protocol.deployment.manifest.chainId
  )
    throw new Error(
      "The RPC returned the wrong chain. Transactions remain disabled.",
    );
  await Promise.all(
    Object.values(protocol.deployment.contracts).map((contract) =>
      requireCode(protocol, contract.address, contract.name),
    ),
  );
  const [imd, price, nhi, comp, oracle] = await Promise.all(
    ["imdToken", "priceFeed", "nhiFeed", "compToken", "oracle"].map((fn) =>
      readContract<Address>(protocol, "CDPVault", fn),
    ),
  );
  for (const [actual, expectedName] of [
    [imd, "MockIMD"],
    [price, "PriceFeed"],
    [nhi, "NhiFeed"],
  ] as const) {
    if (!isAddressEqual(actual, contractFor(protocol, expectedName).address))
      throw new Error(
        `Vault ${expectedName} binding disagrees with the deployment.`,
      );
  }
  if (isAddressEqual(comp, imd) || isAddressEqual(comp, oracle))
    throw new Error("Vault dependency addresses are invalid.");
  await Promise.all([
    requireCode(protocol, comp, "vault-created COMP"),
    requireCode(protocol, oracle, "vault-created work oracle"),
  ]);
  protocol.bindings = {
    comp: {
      name: "CompToken",
      address: getAddress(comp),
      abi: protocol.deployment.supplemental.CompToken,
      abiHash: "",
    },
    oracle: {
      name: "MockWorkOracle",
      address: getAddress(oracle),
      abi: protocol.deployment.supplemental.MockWorkOracle,
      abiHash: "",
    },
  };
  const [compVault, oracleVault] = await Promise.all([
    readContract<Address>(protocol, "CompToken", "vault"),
    readContract<Address>(protocol, "MockWorkOracle", "vault"),
  ]);
  const vault = contractFor(protocol, "CDPVault").address;
  if (!isAddressEqual(compVault, vault) || !isAddressEqual(oracleVault, vault))
    throw new Error(
      "COMP or work oracle is not permanently bound to this vault.",
    );
  protocol.verified = true;
}
export function collateralRatio(
  collateral: bigint,
  debt: bigint,
  price: bigint,
): bigint {
  if (debt === 0n) return maxUint256;
  const ratio = (collateral * price) / (debt * 10n ** 16n);
  return ratio > maxUint256 ? maxUint256 : ratio;
}
export function effectiveMinCR(nhi: bigint): bigint {
  if (nhi >= 850_000_000_000_000_000n) return 150n;
  if (nhi <= 600_000_000_000_000_000n) return 200n;
  const denominator = 250_000_000_000_000_000n;
  return (
    150n +
    ((850_000_000_000_000_000n - nhi) * 50n + denominator - 1n) / denominator
  );
}
export async function readPosition(
  protocol: Protocol,
  owner: Address,
  context?: { price: bigint; minCR: bigint; blockNumber?: bigint },
): Promise<PositionState> {
  const blockNumber =
    context?.blockNumber ?? (await protocol.client.getBlockNumber());
  const [[collateral, debt], [markedAt, grace, marked], feed, minCR] =
    await Promise.all([
      readContract<readonly [bigint, bigint]>(
        protocol,
        "CDPVault",
        "positions",
        [owner],
        blockNumber,
      ),
      readContract<readonly [bigint, bigint, boolean]>(
        protocol,
        "CDPVault",
        "liquidationMarks",
        [owner],
        blockNumber,
      ),
      context
        ? Promise.resolve([context.price, 0n] as const)
        : readContract<readonly [bigint, bigint]>(
            protocol,
            "PriceFeed",
            "latestValue",
            [],
            blockNumber,
          ),
      context
        ? Promise.resolve(context.minCR)
        : readContract<bigint>(protocol, "CDPVault", "minCR", [], blockNumber),
    ]);
  const ratio =
    debt === 0n
      ? maxUint256
      : feed[0] === 0n
        ? null
        : collateralRatio(collateral, debt, feed[0]);
  return {
    owner,
    collateral,
    debt,
    ratio,
    healthy: ratio === null ? null : ratio >= minCR,
    mark: { markedAt, grace, marked },
  };
}
async function readFeed(
  protocol: Protocol,
  name: string,
  blockNumber: bigint,
): Promise<FeedState> {
  const [[value, updatedAt], stale, maxAge] = await Promise.all([
    readContract<readonly [bigint, bigint]>(
      protocol,
      name,
      "latestValue",
      [],
      blockNumber,
    ),
    readContract<boolean>(protocol, name, "isStale", [], blockNumber),
    readContract<bigint>(protocol, name, "maxAge", [], blockNumber),
  ]);
  return { value, updatedAt, stale, maxAge };
}
export async function readSnapshot(
  protocol: Protocol,
  account?: Address,
): Promise<Snapshot> {
  if (!protocol.verified || !protocol.bindings)
    await verifyDeployment(protocol);
  const block = await protocol.client.getBlock();
  const blockNumber = block.number!;
  const read = <T>(name: string, fn: string, args: readonly unknown[] = []) =>
    readContract<T>(protocol, name, fn, args, blockNumber);
  const [
    price,
    nhi,
    minCR,
    gracePeriod,
    liquidationWindow,
    imdDecimals,
    compDecimals,
    cplDecimals,
    totalSupply,
    totalWorkMinted,
    imdOperator,
    workOperator,
  ] = await Promise.all([
    readFeed(protocol, "PriceFeed", blockNumber),
    readFeed(protocol, "NhiFeed", blockNumber),
    read<bigint>("CDPVault", "minCR"),
    read<bigint>("CDPVault", "gracePeriod"),
    read<bigint>("CDPVault", "liquidationWindow"),
    read<number>("MockIMD", "decimals"),
    read<number>("CompToken", "decimals"),
    read<number>("LaunchToken", "decimals"),
    read<bigint>("CompToken", "totalSupply"),
    read<bigint>("CDPVault", "totalWorkMinted"),
    read<Address>("MockIMD", "deployer"),
    read<Address>("MockWorkOracle", "deployer"),
  ]);
  if (minCR !== effectiveMinCR(nhi.value))
    throw new Error(
      "Effective minCR does not match the verified NHI calculation.",
    );
  if (imdDecimals !== 18 || compDecimals !== 18)
    throw new Error(
      "Vault token decimals disagree with the deployed implementation.",
    );
  const [
    ethBalance,
    imdBalance,
    compBalance,
    cplBalance,
    imdAllowance,
    rights,
    priceReporter,
    nhiReporter,
    position,
  ] = account
    ? await Promise.all([
        protocol.client.getBalance({ address: account, blockNumber }),
        read<bigint>("MockIMD", "balanceOf", [account]),
        read<bigint>("CompToken", "balanceOf", [account]),
        read<bigint>("LaunchToken", "balanceOf", [account]),
        read<bigint>("MockIMD", "allowance", [
          account,
          contractFor(protocol, "CDPVault").address,
        ]),
        read<bigint>("MockWorkOracle", "mintingRights", [account]),
        read<boolean>("PriceFeed", "isReporter", [account]),
        read<boolean>("NhiFeed", "isReporter", [account]),
        readPosition(protocol, account, {
          price: price.value,
          minCR,
          blockNumber,
        }),
      ])
    : ([0n, 0n, 0n, 0n, 0n, 0n, false, false, null] as const);
  return {
    blockNumber,
    blockTimestamp: block.timestamp,
    fetchedAt: Date.now(),
    price,
    nhi,
    minCR,
    gracePeriod,
    liquidationWindow,
    feedsFresh:
      !price.stale && !nhi.stale && price.value > 0n && nhi.value > 0n,
    compAddress: protocol.bindings!.comp.address,
    oracleAddress: protocol.bindings!.oracle.address,
    imdDecimals,
    compDecimals,
    cplDecimals,
    totalSupply,
    totalWorkMinted,
    imdOperator,
    workOperator,
    ethBalance,
    imdBalance,
    compBalance,
    cplBalance,
    imdAllowance,
    rights,
    priceReporter,
    nhiReporter,
    position,
  };
}
/** Reject precision loss: parseUnits alone rounds over-precision inputs. */
export function parseAmount(value: string, decimals = 18): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized))
    throw new Error("Enter a positive decimal amount.");
  if ((normalized.split(".")[1]?.length ?? 0) > decimals)
    throw new Error(`Use no more than ${decimals} decimal places.`);
  const amount = parseUnits(normalized, decimals);
  if (amount <= 0n || amount > maxUint256)
    throw new Error(
      "Enter an amount greater than zero within the token limit.",
    );
  return amount;
}
export function maximumMint(snapshot: Snapshot): bigint {
  const position = snapshot.position;
  if (!position || !snapshot.feedsFresh) return 0n;
  const ceiling =
    (position.collateral * snapshot.price.value) /
    (snapshot.minCR * 10n ** 16n);
  return ceiling > position.debt ? ceiling - position.debt : 0n;
}
export function maximumWithdrawal(snapshot: Snapshot): bigint {
  const position = snapshot.position;
  if (!position) return 0n;
  if (position.debt === 0n) return position.collateral;
  if (!snapshot.feedsFresh || snapshot.price.value <= 0n) return 0n;
  const required =
    (position.debt * snapshot.minCR * 10n ** 16n + snapshot.price.value - 1n) /
    snapshot.price.value;
  return position.collateral > required ? position.collateral - required : 0n;
}
export function markTiming(
  position: PositionState,
  window: bigint,
  timestamp: bigint,
): {
  remaining: bigint;
  expiresIn: bigint;
  expired: boolean;
  actionable: boolean;
} {
  const end = position.mark.markedAt + position.mark.grace;
  const expires = end + window;
  return {
    remaining: end > timestamp ? end - timestamp : 0n,
    expiresIn: expires > timestamp ? expires - timestamp : 0n,
    expired: position.mark.marked && timestamp > expires,
    actionable:
      position.mark.marked &&
      position.healthy === false &&
      timestamp >= end &&
      timestamp <= expires,
  };
}
const contractErrorMessages: Record<string, string> = {
  StaleFeed:
    "A price or NHI feed is stale or unseeded. Fresh reports are required for this action. Deposits and repayments remain available.",
  InvalidPrice:
    "The price feed has no valid price yet. Wait for an accepted reporter update.",
  UnsafeCollateralRatio:
    "This amount would put your collateral ratio below the current minimum. Deposit more IMD or reduce the amount.",
  InsufficientCollateral:
    "The position does not have enough IMD collateral for this amount.",
  InsufficientRights:
    "You do not have enough work rights. Refresh to check your available rights.",
  ExcessRepayment:
    "The repayment exceeds the position’s remaining debt. Refresh and reduce the amount.",
  ZeroAmount: "Enter an amount greater than zero.",
  HealthyPosition:
    "This position is healthy and cannot be marked or liquidated.",
  UnderwaterPosition:
    "The position is still underwater. Its recovery mark cannot be cleared yet.",
  PositionNotMarked:
    "Mark this underwater position before attempting liquidation.",
  GracePeriodNotElapsed:
    "The marked position’s grace period has not ended. Wait for the countdown to finish.",
  MarkExpired:
    "This liquidation mark has expired. Mark the position again to start a new grace period.",
  Unauthorized:
    "The connected wallet does not have permission for this action.",
  UnauthorizedReporter:
    "Only an authorized reporter can update this feed. Connect the reporter’s wallet.",
  UnauthorizedRelayer:
    "Only the configured relayer can submit this attestation.",
  ExcessDeviation:
    "This report changes the fresh feed value by more than its allowed deviation.",
  AlreadyReported:
    "This reporter has already submitted a value for the current round.",
  ZeroValue: "Feed reports must be greater than zero.",
  NotInitialized:
    "The vault’s token binding is not initialized. Transactions cannot continue.",
  AlreadyInitialized: "This contract’s initialization is permanently closed.",
  ERC20InsufficientAllowance:
    "Approve enough IMD for the vault before depositing.",
  ERC20InsufficientBalance:
    "The wallet has insufficient tokens. Refresh your balance and reduce the amount.",
  UnexpectedCollateralReceived:
    "The vault did not receive the expected IMD amount. The deposit was reverted.",
  ExpiredAttestation:
    "This attestation has expired and cannot update the feed.",
  StaleAttestation: "This attestation is older than the accepted feed window.",
  ReplayedAttestation: "This attestation has already been used.",
};
export function errorMessage(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001)
    return "Request rejected in your wallet. No transaction was sent.";
  if (error instanceof BaseError) {
    const cause = error.walk();
    if ((cause as { code?: number }).code === 4001)
      return "Request rejected in your wallet. No transaction was sent.";
    const reverted = error.walk(
      (item) => item instanceof ContractFunctionRevertedError,
    );
    if (
      reverted instanceof ContractFunctionRevertedError &&
      reverted.data?.errorName
    ) {
      const name = reverted.data.errorName;
      return (
        contractErrorMessages[name] ??
        `The contract rejected this action (${name}). Refresh the current state and check the amount.`
      );
    }
    return error.shortMessage || error.message;
  }
  return error instanceof Error
    ? error.message
    : "The request failed. Check your wallet and retry.";
}
/** An explicit user action is simulated, signed by the active account, then confirmed. */
export async function transact(
  protocol: Protocol,
  provider: WalletProvider,
  account: Address,
  action: ContractAction,
  onStatus: (status: TransactionStage) => void = () => {},
): Promise<Hash> {
  if (!protocol.verified)
    throw new Error(
      "Deployment verification must complete before transactions.",
    );
  if (
    Number(await provider.request({ method: "eth_chainId" })) !==
    protocol.deployment.manifest.chainId
  )
    throw new Error(
      `Switch to ${protocol.deployment.network.name} before continuing.`,
    );
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts[0] || !isAddressEqual(accounts[0], account))
    throw new Error(
      "The active wallet account changed. Reconnect before continuing.",
    );
  const contract = contractFor(protocol, action.contract);
  onStatus({ stage: "simulating" });
  const { request } = await protocol.client.simulateContract({
    address: contract.address,
    abi: contract.abi,
    functionName: action.functionName,
    args: action.args ?? [],
    account,
    ...(action.value === undefined ? {} : { value: action.value }),
  });
  // A network/account change during simulation must never reuse the old intent.
  if (
    Number(await provider.request({ method: "eth_chainId" })) !==
    protocol.deployment.manifest.chainId
  )
    throw new Error(
      "The wallet network changed during simulation. Please retry.",
    );
  const currentAccounts = await provider.request({ method: "eth_accounts" });
  if (!currentAccounts[0] || !isAddressEqual(currentAccounts[0], account))
    throw new Error(
      "The wallet account changed during simulation. Please retry.",
    );
  onStatus({ stage: "signing" });
  const wallet = createWalletClient({
    chain: protocol.deployment.chain,
    transport: custom(provider),
    account,
  });
  const hash = await wallet.writeContract(request);
  onStatus({ stage: "pending", hash });
  const receipt = await protocol.client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success")
    throw new Error(`Transaction reverted on chain: ${hash}`);
  onStatus({ stage: "confirmed", hash });
  return hash;
}
