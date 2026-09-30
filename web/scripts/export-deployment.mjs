import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'dist');
const checkOnly = process.argv.includes('--check');
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
export const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
  return value;
}
const abiHash = (abi) => keccak256(stringToHex(canonical(abi))).slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => canonical(a) === canonical(b);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const safePath = (path) => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!(await lstat(path)).isSymbolicLink(), `Export contains a symlink: ${path}`);
    if (entry.isDirectory()) result.push(...await files(path));
    else {
      assert(entry.isFile(), `Export contains a non-file: ${path}`);
      result.push(relative(output, path).split('\\').join('/'));
    }
  }
  return result.sort();
}

const handoff = await json(join(root, 'web/deployment/handoff.json'));
const network = await json(join(root, 'web/deployment/network.json'));
const pool = await json(join(root, 'web/deployment/pool.json'));
assert(equal(pool, handoff.manifest.pool), 'Pool input differs from the deployment handoff');
assert(handoff.version === 1, 'Unsupported deployment handoff version');
assert(Number.isSafeInteger(handoff.chainId) && handoff.chainId > 0, 'Invalid chain ID');
assert(/^[0-9a-f]{40}$/.test(handoff.sourceCommit), 'Invalid pinned source commit');
assert(/^[0-9a-f]{64}$/.test(handoff.attestationHash), 'Invalid attestation hash');
assert(typeof handoff.launchId === 'string' && handoff.launchId.length > 0, 'Missing launch ID');
assert(Array.isArray(handoff.contracts) && handoff.contracts.length > 0, 'Missing contracts');
assert(network.network.chainId === handoff.chainId, 'Network chain differs from deployment');
if (network.walletAddChain) assert(BigInt(network.walletAddChain.chainId) === BigInt(handoff.chainId), 'Wallet add-chain differs from deployment');
execFileSync('git', ['cat-file', '-e', `${handoff.sourceCommit}^{commit}`], { cwd: root });

// The handoff input is an archived build input, not a runtime configuration.
// When worker inputs remain available, verify that this archive is unchanged.
for (const [source, archived] of [['deployment.json', handoff], ['network.json', network]]) {
  try { assert(equal(await json(join(root, '.imd/reads', source)), archived), `Archived ${source} differs from pinned worker input`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const expectedContracts = [];
const seenNames = new Set();
for (const contract of handoff.contracts) {
  assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(contract.name), 'Unsafe contract name');
  assert(!seenNames.has(contract.name), `Duplicate contract name: ${contract.name}`);
  seenNames.add(contract.name);
  assert(/^0x[0-9a-fA-F]{40}$/.test(contract.address), `Invalid address: ${contract.name}`);
  assert(/^[0-9a-f]{64}$/.test(contract.abiHash), `Invalid ABI hash: ${contract.name}`);
  expectedContracts.push({ name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath: `abi/${contract.name}.json` });
}

const hashes = {};
await mkdir(join(output, 'abi'), { recursive: true });
// These two contracts are created by CDPVault. Their addresses are read from
// the vault at runtime, so they must not extend the handoff's contract set.
for (const name of [...seenNames, 'CompToken', 'MockWorkOracle']) {
  const bytes = execFileSync('git', ['show', `${handoff.sourceCommit}:docs/abi/${name}.json`], { cwd: root, maxBuffer: MAX_FILE_BYTES });
  const abi = JSON.parse(bytes.toString('utf8'));
  assert(Array.isArray(abi), `${name} export is not a raw ABI array`);
  const digest = abiHash(abi);
  hashes[name] = digest;
  const attested = expectedContracts.find((contract) => contract.name === name);
  if (attested) assert(digest === attested.abiHash, `${name} ABI does not match attestation: ${digest}`);
  const destination = join(output, 'abi', `${name}.json`);
  if (checkOnly) assert(bytes.equals(await readFile(destination)), `${name} exported ABI differs from pinned source bytes`);
  else await writeFile(destination, bytes);
}

const paths = (await files(output)).filter((path) => path !== 'imd-deployment.json');
assert(paths.includes('index.html'), 'dist/index.html is missing; run Vite first');
assert(paths.length <= 128, `Too many exported assets: ${paths.length}`);
let totalBytes = 0;
const assets = [];
for (const path of paths) {
  assert(safePath(path), `Unsafe asset path: ${path}`);
  assert(!/(^|\/)(node_modules|\.cache|\.npm|vendor)(\/|$)/.test(path), `Dependency/cache packaging found in export: ${path}`);
  const bytes = await readFile(join(output, path));
  assert(bytes.byteLength <= MAX_FILE_BYTES, `Asset exceeds 8 MiB: ${path}`);
  totalBytes += bytes.byteLength;
  assets.push({ path, sha256: sha256(bytes) });
}
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: expectedContracts,
  assets,
  network: network.network,
  ...(network.walletAddChain ? { walletAddChain: network.walletAddChain } : {}),
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
totalBytes += manifestBytes.byteLength;
assert(totalBytes < MAX_EXPORT_BYTES, `Export exceeds the assignment's 8 MiB submission budget: ${totalBytes} bytes`);
if (checkOnly) {
  const actual = await json(join(output, 'imd-deployment.json'));
  assert(equal(actual, manifest), 'Runtime manifest differs from pinned handoff, network or final asset inventory');
  assert((await readFile(join(output, 'imd-deployment.json'))).byteLength <= MAX_FILE_BYTES, 'Runtime manifest exceeds file budget');
} else await writeFile(join(output, 'imd-deployment.json'), manifestBytes);
console.log(JSON.stringify({ status: checkOnly ? 'verified' : 'exported', sourceCommit: handoff.sourceCommit, contractCount: expectedContracts.length, assetCount: assets.length, exportBytes: totalBytes, abiHashes: hashes }, null, 2));
