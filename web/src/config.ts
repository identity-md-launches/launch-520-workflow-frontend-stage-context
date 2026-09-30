import {
  defineChain,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Chain,
} from "viem";

export interface NetworkConfig {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets?: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}
export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: NetworkConfig;
  walletAddChain?: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: NetworkConfig["nativeCurrency"];
    blockExplorerUrls?: string[];
  };
}
export interface ContractConfig {
  name: string;
  address: Address;
  abi: Abi;
  abiHash: string;
}
export interface Deployment {
  manifest: DeploymentManifest;
  network: NetworkConfig;
  chain: Chain;
  contracts: Record<string, ContractConfig>;
  supplemental: { CompToken: Abi; MockWorkOracle: Abi };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function canonicalAbiHash(abi: Abi): string {
  return keccak256(stringToHex(canonicalJson(abi))).slice(2);
}
export function safeRelativePath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.includes("?") &&
    !path.includes("#") &&
    !path.includes("%") &&
    path
      .split("/")
      .every((part) => part !== ".." && part !== "." && part !== "")
  );
}
function insist(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Deployment verification failed: ${reason}`);
}
function httpsUrl(value: unknown): boolean {
  try {
    return (
      typeof value === "string" &&
      new URL(value).protocol === "https:" &&
      !new URL(value).username &&
      !new URL(value).password
    );
  } catch {
    return false;
  }
}
export function validateManifest(input: unknown): DeploymentManifest {
  insist(input && typeof input === "object", "invalid configuration");
  const manifest = input as DeploymentManifest;
  const allowed = [
    "version",
    "launchId",
    "chainId",
    "sourceCommit",
    "attestationHash",
    "contracts",
    "assets",
    "network",
    "walletAddChain",
  ];
  insist(
    Object.keys(manifest).every((key) => allowed.includes(key)),
    "unsupported top-level configuration key",
  );
  insist(
    manifest.version === 1 &&
      Number.isSafeInteger(manifest.chainId) &&
      manifest.chainId > 0,
    "invalid version or chain",
  );
  insist(
    typeof manifest.launchId === "string" && manifest.launchId.length > 0,
    "missing launch identifier",
  );
  insist(
    /^[0-9a-f]{40}$/.test(manifest.sourceCommit) &&
      /^[0-9a-f]{64}$/.test(manifest.attestationHash),
    "invalid source or attestation hash",
  );
  insist(
    Array.isArray(manifest.contracts) && manifest.contracts.length > 0,
    "missing contracts",
  );
  insist(
    new Set(manifest.contracts.map((item) => item.name)).size ===
      manifest.contracts.length,
    "duplicate contract names",
  );
  insist(
    new Set(manifest.contracts.map((item) => item.address.toLowerCase()))
      .size === manifest.contracts.length,
    "duplicate contract addresses",
  );
  for (const contract of manifest.contracts)
    insist(
      typeof contract.name === "string" &&
        isAddress(contract.address) &&
        /^[0-9a-f]{64}$/.test(contract.abiHash) &&
        safeRelativePath(contract.abiPath),
      "invalid contract binding",
    );
  for (const name of [
    "LaunchToken",
    "MockIMD",
    "PriceFeed",
    "NhiFeed",
    "CDPVault",
  ])
    insist(
      manifest.contracts.some((contract) => contract.name === name),
      `missing ${name}`,
    );
  insist(
    Array.isArray(manifest.assets) &&
      manifest.assets.length > 0 &&
      manifest.assets.length <= 128,
    "invalid asset inventory",
  );
  insist(
    new Set(manifest.assets.map((item) => item.path)).size ===
      manifest.assets.length,
    "duplicate assets",
  );
  for (const asset of manifest.assets)
    insist(
      safeRelativePath(asset.path) &&
        asset.path !== "imd-deployment.json" &&
        /^[0-9a-f]{64}$/.test(asset.sha256),
      "invalid asset hash or path",
    );
  insist(
    manifest.assets.some((item) => item.path === "index.html"),
    "missing entrypoint",
  );
  const network = manifest.network;
  insist(
    network &&
      network.chainId === manifest.chainId &&
      typeof network.name === "string",
    "network mismatch",
  );
  insist(
    Array.isArray(network.rpcUrls) &&
      network.rpcUrls.length > 0 &&
      network.rpcUrls.every(httpsUrl),
    "invalid public RPC configuration",
  );
  insist(httpsUrl(network.explorer), "invalid explorer");
  insist(
    network.nativeCurrency &&
      Number.isInteger(network.nativeCurrency.decimals) &&
      network.nativeCurrency.decimals >= 0 &&
      network.nativeCurrency.decimals <= 255,
    "invalid native currency",
  );
  insist(
    network.uniswapV4 &&
      [
        "poolManager",
        "universalRouter",
        "quoter",
        "stateView",
        "positionManager",
        "permit2",
      ].every((key) =>
        isAddress(network.uniswapV4[key as keyof NetworkConfig["uniswapV4"]]),
      ),
    "invalid Uniswap network configuration",
  );
  if (manifest.walletAddChain) {
    insist(
      manifest.walletAddChain.chainId.toLowerCase() ===
        `0x${manifest.chainId.toString(16)}`,
      "wallet chain mismatch",
    );
    insist(
      canonicalJson(manifest.walletAddChain.rpcUrls) ===
        canonicalJson(network.rpcUrls),
      "wallet RPC mismatch",
    );
    insist(
      canonicalJson(manifest.walletAddChain.nativeCurrency) ===
        canonicalJson(network.nativeCurrency),
      "wallet currency mismatch",
    );
  }
  return manifest;
}
async function fetchJson(
  path: string,
  expectedSha256?: string,
): Promise<unknown> {
  const response = await fetch(
    new URL(path, new URL(".", window.location.href)),
    { cache: "no-cache" },
  );
  if (!response.ok)
    throw new Error(`Could not load ${path} (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw new Error(`Exported file is too large: ${path}`);
  if (expectedSha256) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    insist(actual === expectedSha256, `asset hash mismatch for ${path}`);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** The published manifest is the only runtime chain, address, RPC and deployed ABI map. */
export async function loadDeployment(): Promise<Deployment> {
  const manifest = validateManifest(await fetchJson("imd-deployment.json"));
  const loadAbi = async (path: string): Promise<Abi> => {
    const asset = manifest.assets.find((item) => item.path === path);
    insist(asset, `ABI absent from inventory: ${path}`);
    const abi = await fetchJson(path, asset.sha256);
    insist(Array.isArray(abi), `ABI must be a raw array: ${path}`);
    return abi as Abi;
  };
  const contracts = Object.fromEntries(
    await Promise.all(
      manifest.contracts.map(async (contract) => {
        const abi = await loadAbi(contract.abiPath);
        insist(
          canonicalAbiHash(abi) === contract.abiHash,
          `canonical ABI hash mismatch for ${contract.name}`,
        );
        return [
          contract.name,
          { ...contract, address: getAddress(contract.address), abi },
        ];
      }),
    ),
  );
  const [CompToken, MockWorkOracle] = await Promise.all(
    ["CompToken", "MockWorkOracle"].map((name) => loadAbi(`abi/${name}.json`)),
  );
  const network = manifest.network;
  const chain = defineChain({
    id: manifest.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    testnet: network.testnet,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: network.name, url: network.explorer } },
  });
  return {
    manifest,
    network,
    chain,
    contracts,
    supplemental: { CompToken, MockWorkOracle },
  };
}
export function explorerUrl(
  deployment: Deployment,
  kind: "address" | "tx",
  value: string,
): string {
  return `${deployment.network.explorer.replace(/\/$/, "")}/${kind}/${value}`;
}
