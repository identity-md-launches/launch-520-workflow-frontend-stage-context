import { expect, test, type Page } from '@playwright/test';
import { parseEther } from 'viem';
import { account, RpcFixture } from './rpc-fixture';

async function open(page: Page, fixture: RpcFixture, connect = true) {
  await fixture.install(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Protocol feeds' }).getByText('150%', { exact: true })).toBeVisible();
  if (connect) {
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Wallet connected', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deposit IMD', exact: true })).toBeEnabled();
  }
}
async function mode(page: Page, name: 'Deposit' | 'Mint' | 'Repay' | 'Withdraw', amount: string) {
  await page.getByRole('group', { name: 'Vault action' }).getByRole('button', { name, exact: true }).click();
  await page.getByLabel(new RegExp(`^${name} amount`)).fill(amount);
}

test('disconnected public feeds and missing wallet recovery', async ({ page }) => {
  const fixture = new RpcFixture();
  await fixture.install(page, false);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Protocol feeds' }).getByText('0.85', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your position' })).toContainText('Not connected');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText('No browser wallet found');
  expect(fixture.sent).toEqual([]);
  expect(fixture.unknown).toEqual([]);
});

test('approval, deposit, mint, repay and debt-free withdrawal round trip', async ({ page }) => {
  const fixture = new RpcFixture();
  await open(page, fixture);
  await page.getByLabel('Deposit amount · IMD').fill('100');
  await page.getByRole('button', { name: 'Approve IMD', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deposit IMD', exact: true })).toBeEnabled();
  expect(fixture.sent.map(tx => tx.functionName)).toEqual(['approve']);
  expect(fixture.sent[0].args).toEqual([expect.stringMatching(new RegExp(fixture.addresses.CDPVault, 'i')), parseEther('100')]);
  await page.getByRole('button', { name: 'Deposit IMD', exact: true }).click();
  await expect.poll(() => fixture.collateral).toBe(parseEther('100'));
  await expect(page.getByLabel('Deposit amount · IMD')).toHaveValue('');
  await mode(page, 'Mint', '25');
  await page.getByRole('button', { name: 'Mint COMP', exact: true }).click();
  await expect.poll(() => fixture.debt).toBe(parseEther('25'));
  await expect(page.getByLabel('Mint amount · COMP', { exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Your position' })).toContainText('400%');
  await mode(page, 'Repay', '25');
  await page.getByRole('button', { name: 'Repay COMP', exact: true }).click();
  await expect.poll(() => fixture.debt).toBe(0n);
  await expect(page.getByLabel('Repay amount · COMP')).toHaveValue('');
  await mode(page, 'Withdraw', '100');
  await page.getByRole('button', { name: 'Withdraw IMD', exact: true }).click();
  await expect.poll(() => fixture.collateral).toBe(0n);
  await expect(page.getByLabel('Withdraw amount · IMD')).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Your position' })).toContainText('Debt-free');
  expect(fixture.imdBalance).toBe(parseEther('1000'));
  expect(fixture.compBalance).toBe(0n);
  expect(fixture.sent.map(tx => tx.functionName)).toEqual(['approve', 'depositCollateral', 'mintCOMP', 'repayCOMP', 'withdrawCollateral']);
  expect(fixture.sent.every(tx => tx.value === 0n)).toBe(true);
  expect(fixture.unknown).toEqual([]);
});

test('unknown chain is added using manifest parameters before switching', async ({ page }) => {
  const fixture = new RpcFixture();
  fixture.walletChain = 1;
  fixture.unknownChain = true;
  await open(page, fixture, false);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Wallet connected', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deposit IMD', exact: true })).toBeEnabled();
  expect(fixture.walletMethods.filter(method => method.startsWith('wallet_'))).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  expect(fixture.addChainParams).toMatchObject({ chainId: '0xaa36a7', chainName: 'Sepolia', rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.ethpandaops.io', 'https://sepolia.rpc.sentio.xyz'] });
  expect(fixture.sent).toEqual([]);
});

test('invalid amount and wallet rejection recover without sent transactions', async ({ page }) => {
  const fixture = new RpcFixture();
  await open(page, fixture);
  await page.getByLabel('Deposit amount · IMD').fill('1e3');
  await page.getByRole('button', { name: 'Deposit IMD', exact: true }).click();
  await expect(page.getByLabel('Deposit amount · IMD')).toHaveAttribute('aria-invalid', 'true');
  expect(fixture.sent).toEqual([]);
  fixture.rejectSend = true;
  await page.getByLabel('Deposit amount · IMD').fill('1');
  await page.getByRole('button', { name: 'Approve IMD', exact: true }).click();
  await expect(page.getByText(/Request rejected in your wallet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve IMD', exact: true })).toBeEnabled();
  expect(fixture.sent).toEqual([]);
});

test('stale feeds pause borrowing but keep repayment and debt-free withdrawal available', async ({ page }) => {
  const fixture = new RpcFixture();
  fixture.collateral = parseEther('100');
  fixture.debt = parseEther('25');
  fixture.compBalance = parseEther('25');
  fixture.stale = true;
  await open(page, fixture);
  await expect(page.getByText('A feed is stale or unseeded.', { exact: false })).toBeVisible();
  await mode(page, 'Mint', '1');
  await expect(page.getByRole('button', { name: 'Mint COMP', exact: true })).toBeDisabled();
  await mode(page, 'Withdraw', '1');
  await expect(page.getByRole('button', { name: 'Withdraw IMD', exact: true })).toBeDisabled();
  await mode(page, 'Repay', '25');
  await expect(page.getByRole('button', { name: 'Repay COMP', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Repay COMP', exact: true }).click();
  await expect(page.getByLabel('Repay amount · COMP')).toHaveValue('');
  await mode(page, 'Withdraw', '100');
  await expect(page.getByRole('button', { name: 'Withdraw IMD', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Withdraw IMD', exact: true }).click();
  await expect.poll(() => fixture.collateral).toBe(0n);
  expect(fixture.sent.map(tx => tx.functionName)).toEqual(['repayCOMP', 'withdrawCollateral']);
});

test('NHI refresh changes effective minimum while a marked position keeps its grace snapshot', async ({ page }) => {
  const fixture = new RpcFixture();
  fixture.collateral = parseEther('100');
  fixture.debt = parseEther('100');
  fixture.mark = [fixture.now - 30n, 120n, true];
  await open(page, fixture);
  const position = page.getByRole('region', { name: 'Your position' });
  await expect(position).toContainText('Underwater');
  await expect(position).toContainText(/Grace remaining 00:01:/);
  await expect(position).toContainText('Stored grace: 00:02:00');
  const initialCountdown = await position.locator('.notice strong').innerText();
  await expect.poll(async () => position.locator('.notice strong').innerText(), { timeout: 4000 }).not.toBe(initialCountdown);
  fixture.nhi = parseEther('0.60');
  fixture.blockNumber += 1n;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Protocol feeds' }).getByText('200%', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Protocol feeds' })).toContainText('Current grace: 00:00:00');
  await expect(position).toContainText('Stored grace: 00:02:00');
  await page.getByText('Inspect a position & manage liquidation', { exact: true }).click();
  await page.getByLabel('Position owner').fill(account);
  await page.getByRole('button', { name: 'Inspect position', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Inspected position' })).toContainText('Underwater');
  await expect(page.getByRole('button', { name: 'Liquidate position', exact: true })).toBeDisabled();
  expect(fixture.sent).toEqual([]);
});

test('missing contract code disables signing and explains verification failure', async ({ page }) => {
  const fixture = new RpcFixture();
  fixture.missingCode = true;
  await fixture.install(page);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('No deployed code found');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Deposit IMD', exact: true })).toBeDisabled();
  expect(fixture.sent).toEqual([]);
});

test('desktop and mobile export load without overflow, with local type and reduced-motion support', async ({ page }) => {
  const fixture = new RpcFixture();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await open(page, fixture);
  await expect(page.locator('.brand svg')).toBeVisible();
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Mono');
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(16, 24, 17)');
  expect(await page.locator('.live').first().evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('live-pulse');
  await page.screenshot({ path: '../docs/validation/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/validation/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('.topbar .address')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/validation/connected-mobile320.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.live').first().evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume motion', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(fixture.unknown).toEqual([]);
});

test('relative assets and runtime configuration load from a gateway subpath', async ({ page }) => {
  const fixture = new RpcFixture();
  await fixture.install(page, false);
  await page.route('**/ipfs/fixture/**', async route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace('/ipfs/fixture/', '/');
    const response = await route.fetch({ url: url.toString() });
    await route.fulfill({ response });
  });
  await page.goto('/ipfs/fixture/');
  await expect(page.getByRole('region', { name: 'Protocol feeds' }).getByText('150%', { exact: true })).toBeVisible();
  await expect(page.locator('.brand svg')).toBeVisible();
  expect(fixture.unknown).toEqual([]);
});

test('a modified ABI asset fails hash verification before enabling controls', async ({ page }) => {
  const fixture = new RpcFixture();
  await fixture.install(page);
  await page.route('**/abi/CDPVault.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('asset hash mismatch for abi/CDPVault.json');
  await expect(page.getByRole('button', { name: 'Deposit IMD', exact: true })).toHaveCount(0);
  expect(fixture.sent).toEqual([]);
});

test('native buy quotes and swaps through configured router without approvals', async ({ page }) => {
  const fixture = new RpcFixture();
  await open(page, fixture);
  await page.getByText('Swap the launch token · CPL / ETH', { exact: true }).click();
  await page.getByLabel('Swap amount · ETH').fill('0.1');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await expect(page.getByText('10 CPL', { exact: true })).toBeVisible();
  expect(fixture.calls).toContain('Quoter.quoteExactInputSingle');
  expect(fixture.sent).toEqual([]);
  await page.getByLabel('I reviewed the amount, minimum received and slippage.').check();
  await page.getByRole('button', { name: 'Swap tokens', exact: true }).click();
  await expect(page.getByLabel('Swap amount · ETH')).toHaveValue('');
  expect(fixture.sent.map(tx => tx.functionName)).toEqual(['execute']);
  expect(fixture.sent[0].value).toBe(parseEther('0.1'));
  expect(fixture.sent[0].args[0]).toBe('0x10');
  expect(fixture.unknown).toEqual([]);
});

test('CPL sell requires explicit token and Permit2 approvals before swapping', async ({ page }) => {
  const fixture = new RpcFixture();
  await open(page, fixture);
  await page.getByText('Swap the launch token · CPL / ETH', { exact: true }).click();
  await page.getByLabel('Swap direction').selectOption('sell');
  await page.getByLabel('Swap amount · CPL').fill('1');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByRole('button', { name: 'Approve CPL to Permit2', exact: true }).click();
  await page.getByRole('button', { name: 'Approve router in Permit2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Swap tokens', exact: true })).toBeDisabled();
  await page.getByLabel('I reviewed the amount, minimum received and slippage.').check();
  await page.getByRole('button', { name: 'Swap tokens', exact: true }).click();
  await expect(page.getByLabel('Swap amount · CPL')).toHaveValue('');
  expect(fixture.sent.map(tx => `${tx.name}.${tx.functionName}`)).toEqual(['LaunchToken.approve', 'Permit2.approve', 'UniversalRouter.execute']);
  expect(fixture.sent.every(tx => tx.value === 0n)).toBe(true);
  expect(fixture.cplAllowance).toBe(parseEther('1'));
  expect(fixture.permitAllowance).toBe(parseEther('1'));
  expect(fixture.unknown).toEqual([]);
});

test('work mint spends available rights without adding collateral debt', async ({ page }) => {
  const fixture = new RpcFixture();
  await open(page, fixture);
  await page.getByText('Mint earned COMP from work rights', { exact: true }).click();
  await page.getByLabel('Work mint amount · COMP', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Mint from work', exact: true }).click();
  await expect(page.getByText('Available rights: 47 COMP', { exact: true })).toBeVisible();
  expect(fixture.rights).toBe(parseEther('47'));
  expect(fixture.compBalance).toBe(parseEther('3'));
  expect(fixture.debt).toBe(0n);
  expect(fixture.sent.map(tx => tx.functionName)).toEqual(['mintFromWork']);
});

test('mark, grace-gated liquidation and clear recovered mark controls send expected actions', async ({ page }) => {
  const fixture = new RpcFixture();
  fixture.collateral = parseEther('100');
  fixture.debt = parseEther('100');
  fixture.compBalance = parseEther('100');
  await open(page, fixture);
  await page.getByText('Inspect a position & manage liquidation', { exact: true }).click();
  await page.getByLabel('Position owner').fill(account);
  await page.getByRole('button', { name: 'Inspect position', exact: true }).click();
  await page.getByRole('button', { name: 'Mark underwater', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Inspected position' })).toContainText('Stored grace: 06:00:00');
  await expect(page.getByRole('button', { name: 'Liquidate position', exact: true })).toBeDisabled();
  fixture.now += 21600n;
  fixture.blockNumber += 1n;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Inspected position' })).toContainText('Grace ended');
  await page.getByLabel('Debt to liquidate · COMP', { exact: true }).fill('10');
  await page.getByLabel('I reviewed the position, amount and collateral payout.').check();
  await page.getByRole('button', { name: 'Liquidate position', exact: true }).click();
  await expect.poll(() => fixture.debt).toBe(parseEther('90'));
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  fixture.price = parseEther('3');
  fixture.blockNumber += 1n;
  fixture.now += 12n;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Clear recovered mark', exact: true }).click();
  await expect.poll(() => fixture.mark[2]).toBe(false);
  expect(fixture.collateral).toBe(parseEther('89'));
  expect(fixture.sent.map(tx => tx.functionName)).toEqual(['markUnderwater', 'liquidate', 'clearRecoveredMark']);
  expect(fixture.unknown).toEqual([]);
});
