import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const deployment = JSON.parse(await readFile(join(root, 'dist/imd-deployment.json'), 'utf8'));
const contracts = Object.fromEntries(await Promise.all(deployment.contracts.map(async (item) => [item.name, { ...item, abi: JSON.parse(await readFile(join(root, 'dist', item.abiPath), 'utf8')) }])));
const result = { observedAt: new Date().toISOString(), sourceCommit: deployment.sourceCommit, expectedChainId: deployment.chainId, endpoints: [] };

for (const url of deployment.network.rpcUrls) {
  const endpoint = { url };
  result.endpoints.push(endpoint);
  try {
    const client = createPublicClient({ transport: http(url, { timeout: 10000, retryCount: 0 }) });
    endpoint.chainId = await client.getChainId();
    if (endpoint.chainId !== deployment.chainId) throw new Error(`Wrong RPC chain: ${endpoint.chainId}`);
    const block = await client.getBlock();
    endpoint.blockNumber = block.number;
    endpoint.blockTimestamp = block.timestamp;
    endpoint.contracts = await Promise.all(deployment.contracts.map(async ({ name, address }) => {
      const code = await client.getCode({ address, blockNumber: block.number });
      if (!code || code === '0x') throw new Error(`${name} has no deployed code`);
      return { name, address, codeBytes: (code.length - 2) / 2 };
    }));
    const read = (name, functionName, args = []) => client.readContract({ address: contracts[name].address, abi: contracts[name].abi, functionName, args, blockNumber: block.number });
    endpoint.vaultLinks = Object.fromEntries(await Promise.all(['imdToken', 'compToken', 'oracle', 'priceFeed', 'nhiFeed'].map(async (method) => [method, await read('CDPVault', method)])));
    for (const [method, name] of [['imdToken', 'MockIMD'], ['priceFeed', 'PriceFeed'], ['nhiFeed', 'NhiFeed']]) {
      if (endpoint.vaultLinks[method].toLowerCase() !== contracts[name].address.toLowerCase()) throw new Error(`Vault ${method} differs from handoff`);
    }
    endpoint.derivedContracts = await Promise.all([['CompToken', 'compToken'], ['MockWorkOracle', 'oracle']].map(async ([name, getter]) => {
      const address = endpoint.vaultLinks[getter];
      const code = await client.getCode({ address, blockNumber: block.number });
      if (!code || code === '0x') throw new Error(`${name} has no deployed code`);
      const abi = JSON.parse(await readFile(join(root, 'dist/abi', `${name}.json`), 'utf8'));
      const vault = await client.readContract({ address, abi, functionName: 'vault', blockNumber: block.number });
      if (vault.toLowerCase() !== contracts.CDPVault.address.toLowerCase()) throw new Error(`${name} is not bound to vault`);
      return { name, address, codeBytes: (code.length - 2) / 2, vault };
    }));
    endpoint.feeds = Object.fromEntries(await Promise.all(['PriceFeed', 'NhiFeed'].map(async (name) => [name, { latestValue: await read(name, 'latestValue'), isStale: await read(name, 'isStale'), maxAge: await read(name, 'maxAge') }])));
    endpoint.minCR = await read('CDPVault', 'minCR');
    endpoint.gracePeriod = await read('CDPVault', 'gracePeriod');
    endpoint.liquidationWindow = await read('CDPVault', 'liquidationWindow');
    endpoint.verified = true;
    break;
  } catch (error) {
    endpoint.verified = false;
    endpoint.error = error.shortMessage || error.message;
  }
}
result.status = result.endpoints.some((endpoint) => endpoint.verified) ? 'verified-read-only' : 'unavailable';
console.log(JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
if (result.status === 'unavailable') process.exitCode = 1;
