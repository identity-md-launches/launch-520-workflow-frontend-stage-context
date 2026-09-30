import {
  encodeAbiParameters,
  getAddress,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import pool from "../deployment/pool.json" with { type: "json" };
import type { Deployment } from "./config";

// Pool parameters are extracted from the pinned handoff. Runtime contract and
// Uniswap addresses come exclusively from the fetched deployment manifest.
// Encoding: https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping
const poolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;
export const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: poolKeyComponents },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;
export const universalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex,bytes message)",
  "error TransactionDeadlinePassed()",
  "error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)",
  "error V4TooMuchRequested(uint256 maxAmountInRequested,uint256 amountRequested)",
]);
export const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
]);

const MAX_UINT128 = (1n << 128n) - 1n;
export const QUOTE_LIFETIME_MS = 60_000;
export type SwapDirection = "buy" | "sell";
export type SwapStep = "approve-token" | "approve-permit2" | "swap";
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}
export interface SwapAssets {
  input: Address;
  output: Address;
  inputSymbol: string;
  outputSymbol: string;
  poolKey: PoolKey;
  zeroForOne: boolean;
}
export interface SwapQuote extends SwapAssets {
  direction: SwapDirection;
  account: Address;
  chainId: number;
  amountIn: bigint;
  amountOut: bigint;
  minimumOut: bigint;
  gasEstimate: bigint;
  slippageBps: number;
  quotedAt: number;
  expiresAt: number;
}
export interface SwapAllowances {
  tokenAllowance: bigint;
  permitAllowance: bigint;
  permitExpiration: number;
  nextStep: SwapStep;
}
export type HashCallback = (hash: Hex) => void;

export function swapAssets(
  deployment: Deployment,
  direction: SwapDirection,
): SwapAssets {
  const token = deployment.contracts.LaunchToken.address;
  const paired = getAddress(pool.pairedCurrency);
  if (paired.toLowerCase() === token.toLowerCase())
    throw new Error("The launch pool currencies must differ.");
  const [currency0, currency1] =
    BigInt(paired) < BigInt(token) ? [paired, token] : [token, paired];
  const input = direction === "buy" ? paired : token;
  const output = direction === "buy" ? token : paired;
  const pairedSymbol =
    paired === zeroAddress
      ? deployment.network.nativeCurrency.symbol
      : "Paired token";
  return {
    input,
    output,
    inputSymbol: direction === "buy" ? pairedSymbol : "CPL",
    outputSymbol: direction === "buy" ? "CPL" : pairedSymbol,
    poolKey: {
      currency0,
      currency1,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: zeroAddress,
    },
    zeroForOne: input.toLowerCase() === currency0.toLowerCase(),
  };
}

export async function verifySwapContracts(
  deployment: Deployment,
  client: PublicClient,
): Promise<void> {
  if ((await client.getChainId()) !== deployment.manifest.chainId)
    throw new Error("The RPC is on another network. Swaps are disabled.");
  const addresses = deployment.network.uniswapV4;
  if (!addresses)
    throw new Error(
      "This network has no verified Uniswap configuration. Swaps are disabled.",
    );
  await Promise.all(
    (["universalRouter", "quoter", "permit2", "poolManager"] as const).map(
      async (name) => {
        const code = await client.getCode({ address: addresses[name] });
        if (!code || code === "0x")
          throw new Error(
            `No ${name} contract code was found on this network. Swaps are disabled.`,
          );
      },
    ),
  );
}

function validateAmount(amount: bigint): void {
  if (amount <= 0n || amount > MAX_UINT128)
    throw new Error("Enter a positive amount within the swap limit.");
}
function validateSlippage(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500)
    throw new Error("Choose slippage between 0% and 5%.");
}
function validateQuote(
  deployment: Deployment,
  account: Address,
  quote: SwapQuote,
): void {
  validateAmount(quote.amountIn);
  validateSlippage(quote.slippageBps);
  if (
    quote.chainId !== deployment.manifest.chainId ||
    quote.account.toLowerCase() !== account.toLowerCase()
  )
    throw new Error("The wallet or network changed. Get a new quote.");
  const expected = swapAssets(deployment, quote.direction);
  if (
    quote.input.toLowerCase() !== expected.input.toLowerCase() ||
    quote.output.toLowerCase() !== expected.output.toLowerCase()
  )
    throw new Error("The selected currencies changed. Get a new quote.");
  if (
    quote.minimumOut <= 0n ||
    quote.minimumOut > MAX_UINT128 ||
    quote.minimumOut !==
      (quote.amountOut * BigInt(10_000 - quote.slippageBps)) / 10_000n
  )
    throw new Error("The quote minimum is invalid. Get a new quote.");
}
async function verifyWallet(
  deployment: Deployment,
  wallet: WalletClient,
  account: Address,
): Promise<void> {
  const [chainId, accounts] = await Promise.all([
    wallet.getChainId(),
    wallet.getAddresses(),
  ]);
  if (chainId !== deployment.manifest.chainId)
    throw new Error(
      `Switch your wallet to ${deployment.network.name} before continuing.`,
    );
  if (!accounts[0] || accounts[0].toLowerCase() !== account.toLowerCase())
    throw new Error(
      "Your wallet account changed. Reconnect and get a new quote.",
    );
}

/** Quotes are eth_call simulations; the quoter never receives a transaction. */
export async function quoteSwap(
  deployment: Deployment,
  client: PublicClient,
  account: Address,
  direction: SwapDirection,
  amountIn: bigint,
  slippageBps: number,
): Promise<SwapQuote> {
  validateAmount(amountIn);
  validateSlippage(slippageBps);
  await verifySwapContracts(deployment, client);
  const assets = swapAssets(deployment, direction);
  const response = await client.simulateContract({
    address: deployment.network.uniswapV4.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    account,
    args: [
      {
        poolKey: { ...assets.poolKey },
        zeroForOne: assets.zeroForOne,
        exactAmount: amountIn,
        hookData: "0x",
      },
    ],
  });
  const [amountOut, gasEstimate] = response.result;
  const minimumOut = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minimumOut <= 0n || minimumOut > MAX_UINT128)
    throw new Error(
      "No usable output was quoted. Try another amount or check pool liquidity.",
    );
  const quotedAt = Date.now();
  return {
    ...assets,
    direction,
    account,
    chainId: deployment.manifest.chainId,
    amountIn,
    amountOut,
    minimumOut,
    gasEstimate,
    slippageBps,
    quotedAt,
    expiresAt: quotedAt + QUOTE_LIFETIME_MS,
  };
}

export async function readSwapAllowances(
  deployment: Deployment,
  client: PublicClient,
  account: Address,
  quote: SwapQuote,
): Promise<SwapAllowances> {
  validateQuote(deployment, account, quote);
  if (quote.input === zeroAddress)
    return {
      tokenAllowance: quote.amountIn,
      permitAllowance: quote.amountIn,
      permitExpiration: 0,
      nextStep: "swap",
    };
  const { permit2, universalRouter } = deployment.network.uniswapV4;
  const [tokenAllowance, permit, block] = await Promise.all([
    client.readContract({
      address: quote.input,
      abi: deployment.contracts.LaunchToken.abi,
      functionName: "allowance",
      args: [account, permit2],
    }) as Promise<bigint>,
    client.readContract({
      address: permit2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [account, quote.input, universalRouter],
    }),
    client.getBlock(),
  ]);
  const [permitAllowance, permitExpiration] = permit;
  // Leave enough time for wallet review and inclusion, not merely the read block.
  const nextStep =
    tokenAllowance < quote.amountIn
      ? "approve-token"
      : permitAllowance < quote.amountIn ||
          BigInt(permitExpiration) <= block.timestamp + 60n
        ? "approve-permit2"
        : "swap";
  return { tokenAllowance, permitAllowance, permitExpiration, nextStep };
}

async function confirm(
  client: PublicClient,
  hash: Hex,
  onHash?: HashCallback,
): Promise<Hex> {
  onHash?.(hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success")
    throw new Error(
      "The transaction reverted. Refresh balances and try again.",
    );
  return hash;
}

/** Each approval is a separate visitor-initiated control, with an exact amount. */
export async function approveSwapToken(
  deployment: Deployment,
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  quote: SwapQuote,
  onHash?: HashCallback,
): Promise<Hex | null> {
  validateQuote(deployment, account, quote);
  await verifyWallet(deployment, wallet, account);
  await verifySwapContracts(deployment, client);
  const allowances = await readSwapAllowances(
    deployment,
    client,
    account,
    quote,
  );
  if (
    quote.input === zeroAddress ||
    allowances.tokenAllowance >= quote.amountIn
  )
    return null;
  const simulation = await client.simulateContract({
    address: quote.input,
    abi: deployment.contracts.LaunchToken.abi,
    functionName: "approve",
    account,
    args: [deployment.network.uniswapV4.permit2, quote.amountIn],
  });
  await verifyWallet(deployment, wallet, account);
  const hash = await wallet.writeContract({
    ...simulation.request,
    account,
    chain: deployment.chain,
  });
  await confirm(client, hash, onHash);
  const updated = await readSwapAllowances(deployment, client, account, quote);
  if (updated.tokenAllowance < quote.amountIn)
    throw new Error(
      "The token approval confirmed but its allowance has not refreshed. Refresh before continuing.",
    );
  return hash;
}

export async function approveSwapPermit2(
  deployment: Deployment,
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  quote: SwapQuote,
  onHash?: HashCallback,
): Promise<Hex | null> {
  validateQuote(deployment, account, quote);
  await verifyWallet(deployment, wallet, account);
  await verifySwapContracts(deployment, client);
  const allowances = await readSwapAllowances(
    deployment,
    client,
    account,
    quote,
  );
  if (allowances.nextStep === "approve-token")
    throw new Error(
      "Approve the token to Permit2 before approving the router.",
    );
  if (quote.input === zeroAddress || allowances.nextStep === "swap")
    return null;
  const block = await client.getBlock();
  const simulation = await client.simulateContract({
    address: deployment.network.uniswapV4.permit2,
    abi: permit2Abi,
    functionName: "approve",
    account,
    args: [
      quote.input,
      deployment.network.uniswapV4.universalRouter,
      quote.amountIn,
      Number(block.timestamp + 600n),
    ],
  });
  await verifyWallet(deployment, wallet, account);
  const hash = await wallet.writeContract({
    ...simulation.request,
    account,
    chain: deployment.chain,
  });
  await confirm(client, hash, onHash);
  const updated = await readSwapAllowances(deployment, client, account, quote);
  if (updated.nextStep !== "swap")
    throw new Error(
      "The router approval confirmed but its allowance has not refreshed. Refresh before continuing.",
    );
  return hash;
}

export function encodeSwap(
  deployment: Deployment,
  quote: SwapQuote,
  deadline: bigint,
): { commands: Hex; inputs: readonly Hex[]; deadline: bigint; value: bigint } {
  const assets = swapAssets(deployment, quote.direction);
  const params: Hex[] = [
    encodeAbiParameters(
      parseAbiParameters(
        "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
      ),
      [
        {
          poolKey: assets.poolKey,
          zeroForOne: assets.zeroForOne,
          amountIn: quote.amountIn,
          amountOutMinimum: quote.minimumOut,
          hookData: "0x",
        },
      ],
    ),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      assets.input,
      quote.amountIn,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      assets.output,
      quote.minimumOut,
    ]),
  ];
  const input = encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
    "0x060c0f",
    params,
  ]);
  return {
    commands: "0x10",
    inputs: [input],
    deadline,
    value: assets.input === zeroAddress ? quote.amountIn : 0n,
  };
}

export async function executeSwap(
  deployment: Deployment,
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  quote: SwapQuote,
  onHash?: HashCallback,
): Promise<Hex> {
  validateQuote(deployment, account, quote);
  const ensureFresh = () => {
    if (Date.now() >= quote.expiresAt)
      throw new Error("This quote expired. Get a new quote before swapping.");
  };
  ensureFresh();
  await verifyWallet(deployment, wallet, account);
  await verifySwapContracts(deployment, client);
  const allowances = await readSwapAllowances(
    deployment,
    client,
    account,
    quote,
  );
  if (allowances.nextStep !== "swap")
    throw new Error(
      "An approval is required. Refresh the quote and complete the displayed approval step.",
    );
  const block = await client.getBlock();
  const encoded = encodeSwap(deployment, quote, block.timestamp + 300n);
  const simulation = await client.simulateContract({
    address: deployment.network.uniswapV4.universalRouter,
    abi: universalRouterAbi,
    functionName: "execute",
    args: [encoded.commands, encoded.inputs, encoded.deadline],
    account,
    value: encoded.value,
  });
  ensureFresh();
  await verifyWallet(deployment, wallet, account);
  const hash = await wallet.writeContract({
    ...simulation.request,
    account,
    chain: deployment.chain,
  });
  return confirm(client, hash, onHash);
}
