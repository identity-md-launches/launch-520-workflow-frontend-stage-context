import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  formatUnits,
  getAddress,
  isAddress,
  isAddressEqual,
  type Address,
  type Hash,
} from "viem";
import { explorerUrl, loadDeployment, type Deployment } from "./config";
import {
  createProtocol,
  readSnapshot,
  readPosition,
  transact,
  parseAmount,
  maximumMint,
  maximumWithdrawal,
  markTiming,
  errorMessage,
  type Protocol,
  type Snapshot,
  type PositionState,
  type ContractAction,
} from "./protocol";
import { useWallet } from "./wallet";
import Swap from "./Swap";

export const fmt = (value?: bigint, decimals = 18, places = 4) => {
  if (value === undefined) return "—";
  const [whole, fraction] = formatUnits(value, decimals).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? "." + fraction.slice(0, places).replace(/0+$/, "") : ""}`.replace(
    /\.$/,
    "",
  );
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const duration = (value: bigint) => {
  const s = Number(value);
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
};
const updated = (timestamp?: bigint) =>
  timestamp && timestamp > 0n
    ? new Date(Number(timestamp) * 1000).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Awaiting first update";
function Frog() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M13 28c-9-20 19-28 19-10 0-18 28-10 19 10 15 27-53 27-38 0Z"
        fill="currentColor"
      />
      <circle cx="22" cy="20" r="3" fill="var(--page)" />
      <circle cx="42" cy="20" r="3" fill="var(--page)" />
      <path
        d="M23 37q9 8 18 0"
        fill="none"
        stroke="var(--page)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function AddressLink({
  address,
  deployment,
  label,
}: {
  address: Address;
  deployment: Deployment;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="address">
      <a
        href={explorerUrl(deployment, "address", address)}
        target="_blank"
        rel="noreferrer"
        title={getAddress(address)}
        aria-label={`${label ?? "Address"} ${getAddress(address)} on explorer`}
      >
        {label ?? `${address.slice(0, 6)}…${address.slice(-4)}`} ↗
      </a>
      <button
        className="copy text"
        aria-label={`Copy ${label ?? "address"}`}
        onClick={() =>
          void navigator.clipboard
            .writeText(getAddress(address))
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() =>
              setError(
                "Copy unavailable; open the explorer for the full address.",
              ),
            )
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {error && <span role="status">{error}</span>}
    </span>
  );
}
export interface ActionStatus {
  text: string;
  hash?: Hash;
  error?: boolean;
}
export interface UI {
  deployment: Deployment;
  protocol?: Protocol;
  snapshot?: Snapshot;
  wallet: ReturnType<typeof useWallet>;
  ready: boolean;
  busy: string | null;
  statuses: Record<string, ActionStatus>;
  now: bigint;
  run: (
    id: string,
    task: (report: (status: ActionStatus) => void) => Promise<unknown>,
  ) => Promise<boolean>;
  act: (id: string, action: ContractAction) => Promise<boolean>;
  refresh: () => Promise<void>;
}
export function Status({ ui, id }: { ui: UI; id: string }) {
  const s = ui.statuses[id];
  return (
    <div
      className={`status ${s?.error ? "error" : ""}`}
      role="status"
      aria-live="polite"
    >
      {s?.text}
      {s?.hash && (
        <>
          {" "}
          <a
            href={explorerUrl(ui.deployment, "tx", s.hash)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction ↗
          </a>
        </>
      )}
    </div>
  );
}
export function Gate({ ui, children }: { ui: UI; children: ReactNode }) {
  if (!ui.wallet.account)
    return (
      <button
        type="button"
        className="primary action"
        onClick={ui.wallet.connect}
        disabled={ui.wallet.pending}
      >
        {ui.wallet.pending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  if (ui.wallet.chainId !== ui.deployment.manifest.chainId)
    return (
      <button
        type="button"
        className="primary action"
        onClick={ui.wallet.switchChain}
        disabled={ui.wallet.pending}
      >
        {ui.wallet.pending
          ? "Switching…"
          : `Switch to ${ui.deployment.network.name}`}
      </button>
    );
  return <>{children}</>;
}
function App() {
  const [deployment, setDeployment] = useState<Deployment>();
  const [protocol, setProtocol] = useState<Protocol>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loadError, setLoadError] = useState("");
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ActionStatus>>({});
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const wallet = useWallet(deployment);
  const lock = useRef(false);
  const generation = useRef(0);
  const reading = useRef(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    loadDeployment()
      .then((d) => {
        if (active) setDeployment(d);
      })
      .catch((e) => {
        if (active) setLoadError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!deployment) return;
    generation.current++;
    setSnapshot(undefined);
    setReadError("");
    setProtocol(createProtocol(deployment, wallet.provider));
  }, [deployment, wallet.provider, wallet.account, wallet.chainId]);
  const refresh = useCallback(async () => {
    if (!protocol) return;
    const gen = generation.current;
    const seq = ++reading.current;
    const current = (async () => {
      try {
        const result = await readSnapshot(protocol, wallet.account);
        if (gen === generation.current && seq === reading.current) {
          setSnapshot(result);
          setReadError("");
        }
      } catch (e) {
        if (gen === generation.current && seq === reading.current)
          setReadError(errorMessage(e));
      }
    })();
    await current;
  }, [protocol, wallet.account]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const run = async (
    id: string,
    task: (report: (s: ActionStatus) => void) => Promise<unknown>,
  ) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(id);
    const report = (s: ActionStatus) =>
      setStatuses((old) => ({ ...old, [id]: s }));
    report({ text: "Checking transaction…" });
    try {
      await task(report);
      await refresh();
      setStatuses((old) => ({
        ...old,
        [id]: { ...old[id], text: "Transaction confirmed." },
      }));
      return true;
    } catch (e) {
      report({ text: errorMessage(e), error: true });
      return false;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  const act = async (id: string, action: ContractAction) =>
    run(id, async (report) => {
      if (!protocol || !wallet.provider || !wallet.account)
        throw new Error("Connect your wallet to continue.");
      if (readError || !snapshot || Date.now() - snapshot.fetchedAt > 20_000)
        throw new Error("Refresh contract state before continuing.");
      await transact(protocol, wallet.provider, wallet.account, action, (s) =>
        report({
          text: {
            simulating: "Simulating transaction…",
            signing: "Confirm in your wallet…",
            pending: "Waiting for confirmation…",
            confirmed: "Confirmed. Refreshing balances…",
          }[s.stage],
          hash: s.hash,
        }),
      );
    });
  const now = snapshot
    ? snapshot.blockTimestamp +
      BigInt(Math.max(0, Math.floor((tick - snapshot.fetchedAt) / 1000)))
    : BigInt(Math.floor(tick / 1000));
  const ready = Boolean(
    protocol?.verified &&
      snapshot &&
      !readError &&
      tick - snapshot.fetchedAt < 20_000 &&
      wallet.account &&
      wallet.chainId === deployment?.manifest.chainId,
  );
  const liveSnapshot = snapshot
    ? {
        ...snapshot,
        price: {
          ...snapshot.price,
          stale:
            snapshot.price.stale ||
            now > snapshot.price.updatedAt + snapshot.price.maxAge,
        },
        nhi: {
          ...snapshot.nhi,
          stale:
            snapshot.nhi.stale ||
            now > snapshot.nhi.updatedAt + snapshot.nhi.maxAge,
        },
        feedsFresh:
          snapshot.feedsFresh &&
          now <= snapshot.price.updatedAt + snapshot.price.maxAge &&
          now <= snapshot.nhi.updatedAt + snapshot.nhi.maxAge,
      }
    : undefined;
  const ui = deployment
    ? {
        deployment,
        protocol,
        snapshot: liveSnapshot,
        wallet,
        ready,
        busy,
        statuses,
        now,
        run,
        act,
        refresh,
      }
    : undefined;
  return (
    <div className={paused ? "paused" : ""}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="#main">
            <Frog />
            <span>
              COMP<small>Compute money</small>
            </span>
          </a>
          <div className="wallet">
            <span className="badge">
              <span className="dot" /> {deployment?.network.name ?? "Sepolia"}{" "}
              testnet
            </span>
            {wallet.account && deployment && (
              <AddressLink address={wallet.account} deployment={deployment} />
            )}
            <button
              onClick={wallet.account ? wallet.switchChain : wallet.connect}
              disabled={
                wallet.pending ||
                Boolean(
                  wallet.account &&
                    wallet.chainId === deployment?.manifest.chainId,
                )
              }
            >
              {wallet.pending
                ? "Connecting…"
                : wallet.account
                  ? wallet.chainId === deployment?.manifest.chainId
                    ? "Wallet connected"
                    : `Switch to ${deployment?.network.name ?? "Sepolia"}`
                  : "Connect wallet"}
            </button>
          </div>
        </header>
        <main id="main">
          <div className="intro">
            <div>
              <div className="eyebrow">Collateralized / compute-backed</div>
              <h1>A position in compute.</h1>
              <p>
                Deposit IMD. Mint COMP. Keep an eye on network health.
                <br />
                Manage your position on Sepolia.
              </p>
            </div>
            <span className="badge">
              Test assets · No real-world redemption
            </span>
          </div>
          {wallet.error && (
            <p className="notice" role="alert">
              {wallet.error}
            </p>
          )}
          {loadError && (
            <div className="notice" role="alert">
              <p>{loadError}</p>
              <button onClick={() => setReload((x) => x + 1)}>
                Retry configuration
              </button>
            </div>
          )}
          {loading && (
            <p className="loading" role="status">
              Loading verified deployment configuration…
            </p>
          )}
          {ui && (
            <>
              <div className="section-heading">
                <span className="eyebrow">Live protocol state</span>
                <div className="row">
                  <span className="small muted">
                    {snapshot
                      ? `Block ${snapshot.blockNumber.toLocaleString()}`
                      : "Connecting to public RPC…"}
                  </span>
                  <button
                    className="compact text small"
                    onClick={() => setPaused((x) => !x)}
                  >
                    {paused ? "Resume motion" : "Pause motion"}
                  </button>
                  <button
                    className="compact text small"
                    onClick={() => void refresh()}
                    disabled={!!busy}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {readError && (
                <p className="notice" role="alert">
                  Read unavailable: {readError} Signing is paused. Check your
                  connection and select Refresh.
                </p>
              )}
              <Feeds ui={ui} />
              {liveSnapshot && !liveSnapshot.feedsFresh && (
                <div className="notice">
                  A feed is stale or unseeded. Minting and liquidation are
                  paused. You can still deposit, repay, or withdraw from a
                  debt-free position. The configured reporter must publish fresh
                  values.
                </div>
              )}
              <div className="workspace">
                <VaultActions ui={ui} />
                <PositionPanel
                  ui={ui}
                  position={snapshot?.position ?? undefined}
                />
              </div>
              <details className="details">
                <summary>Inspect a position & manage liquidation</summary>
                <div className="details-body">
                  <Inspector ui={ui} />
                </div>
              </details>
              <details className="details">
                <summary>Mint earned COMP from work rights</summary>
                <div className="details-body">
                  <Work ui={ui} />
                </div>
              </details>
              <details className="details">
                <summary>Swap the launch token · CPL / ETH</summary>
                <div className="details-body">
                  <Swap ui={ui} />
                </div>
              </details>
              <details className="details">
                <summary>Feed reporters & test asset faucets</summary>
                <div className="details-body">
                  <Operators ui={ui} />
                </div>
              </details>
              <details className="details">
                <summary>Deployment & protocol details</summary>
                <div className="details-body">
                  <p className="small muted">
                    COMP is issued by this vault against IMD collateral or
                    earned work rights. CPL is a separate fixed-supply launch
                    token. Price is COMP per IMD; a USD price is unavailable.
                    Feed configuration and vault parameters have no admin
                    setters. No initialization transaction is needed.
                  </p>
                  <ul className="contract-list">
                    {Object.values(deployment!.contracts).map((c) => (
                      <li key={c.name}>
                        <span>{c.name}</span>
                        <AddressLink
                          address={c.address}
                          deployment={deployment!}
                        />
                      </li>
                    ))}
                    {snapshot && (
                      <>
                        <li>
                          <span>Vault-created COMP</span>
                          <AddressLink
                            address={snapshot.compAddress}
                            deployment={deployment!}
                          />
                        </li>
                        <li>
                          <span>Vault-created work oracle</span>
                          <AddressLink
                            address={snapshot.oracleAddress}
                            deployment={deployment!}
                          />
                        </li>
                      </>
                    )}
                  </ul>
                  <p className="small muted">
                    COMP supply: {fmt(snapshot?.totalSupply)} COMP · Work
                    minted: {fmt(snapshot?.totalWorkMinted)} COMP
                  </p>
                  <a className="small" href="./imd-deployment.json">
                    View deployment manifest
                  </a>
                  <p className="small muted spaced">
                    Need test ETH?{" "}
                    {deployment?.network.faucets?.map((f, i) => (
                      <span key={f}>
                        <a href={f} target="_blank" rel="noreferrer">
                          Sepolia faucet {i + 1} ↗
                        </a>{" "}
                      </span>
                    ))}
                  </p>
                </div>
              </details>
            </>
          )}
        </main>
        <footer className="footer">
          <span>COMP / Sepolia experiment</span>
          <span>Price and NHI polled every 5 seconds.</span>
        </footer>
      </div>
    </div>
  );
}
function Feeds({ ui }: { ui: UI }) {
  const s = ui.snapshot;
  const health = !s
    ? "Loading"
    : s.nhi.updatedAt === 0n
      ? "Unseeded"
      : s.nhi.stale
        ? "Stale"
        : s.nhi.value >= 850000000000000000n
          ? "Healthy"
          : s.nhi.value <= 600000000000000000n
            ? "Stressed"
            : "Caution";
  return (
    <section className="feeds" aria-label="Protocol feeds">
      <div className="feed">
        <div className="feed-head">
          <span className="eyebrow">Collateral price</span>
          <span className="small muted">
            {!s
              ? "Loading"
              : s.price.updatedAt === 0n
                ? "Unseeded"
                : s.price.stale
                  ? "Stale"
                  : "Fresh"}
          </span>
        </div>
        <div className="feed-value">
          <span className={s ? "live" : ""}>{fmt(s?.price.value)}</span>{" "}
          <small>COMP / IMD</small>
        </div>
        <p>{updated(s?.price.updatedAt)}</p>
      </div>
      <div className="feed">
        <div className="feed-head">
          <span className="eyebrow">Network health · NHI</span>
          <span
            className={`small ${health === "Healthy" ? "muted" : "warning"}`}
          >
            {health}
          </span>
        </div>
        <div className="feed-value">
          <span className={s ? "live" : ""}>{fmt(s?.nhi.value, 18, 3)}</span>
        </div>
        <p>{updated(s?.nhi.updatedAt)} · Reporter supplied</p>
      </div>
      <div className="feed">
        <div className="feed-head">
          <span className="eyebrow">Effective min. ratio</span>
          <span className="small muted">NHI derived</span>
        </div>
        <div className="feed-value">
          <span className={s ? "live" : ""}>{s?.minCR.toString() ?? "—"}%</span>
        </div>
        <p>
          Current grace: {s ? duration(s.gracePeriod) : "—"} · 150–200% range
        </p>
      </div>
    </section>
  );
}
function PositionPanel({
  ui,
  position,
  inspected = false,
}: {
  ui: UI;
  position?: PositionState;
  inspected?: boolean;
}) {
  const s = ui.snapshot;
  const timing =
    position && s
      ? markTiming(position, s.liquidationWindow, ui.now)
      : undefined;
  const ratio =
    position?.debt === 0n
      ? "Debt-free"
      : position?.ratio === null
        ? "Unavailable"
        : position?.ratio !== undefined
          ? `${position.ratio}%`
          : "—";
  return (
    <section
      className="panel"
      aria-label={inspected ? "Inspected position" : "Your position"}
    >
      <div className="section-heading">
        <h2>{inspected ? "Inspected position" : "Your position"}</h2>
        <span className="badge">
          {!position
            ? "Not connected"
            : !s?.feedsFresh
              ? "Feed stale"
              : position.healthy
                ? "Healthy"
                : "Underwater"}
        </span>
      </div>
      {!position && (
        <p className="muted small">
          Connect your wallet to see collateral, debt and available balances.
        </p>
      )}
      <dl className="position-grid">
        <div>
          <dt>Collateral deposited</dt>
          <dd>
            {fmt(position?.collateral)} <small>IMD</small>
          </dd>
        </div>
        <div>
          <dt>Outstanding debt</dt>
          <dd>
            {fmt(position?.debt)} <small>COMP</small>
          </dd>
        </div>
        {!inspected && (
          <>
            <div>
              <dt>Wallet balance</dt>
              <dd>
                {position ? fmt(s?.imdBalance) : "—"} <small>IMD</small>
              </dd>
            </div>
            <div>
              <dt>Wallet balance</dt>
              <dd>
                {position ? fmt(s?.compBalance) : "—"} <small>COMP</small>
              </dd>
            </div>
          </>
        )}
      </dl>
      <div className="ratio">
        <div className="row">
          <span className="small muted">Collateral ratio</span>
          <span className={position ? "live" : undefined}>{ratio}</span>
        </div>
        <div className="ratio-bar" aria-hidden="true">
          <span
            style={{
              width: !position
                ? "0%"
                : position.debt === 0n
                  ? "100%"
                  : `${Math.min(100, Number(position.ratio ?? 0n) / 3)}%`,
            }}
          />
        </div>
        <span className="small muted">
          Minimum {s?.minCR.toString() ?? "—"}% · Based on the latest feed
        </span>
      </div>
      {position?.mark.marked && timing && (
        <div className="notice">
          <strong>
            {timing.expired
              ? "Mark expired — mark again"
              : timing.remaining > 0n
                ? `Grace remaining ${duration(timing.remaining)}`
                : "Grace ended"}
          </strong>
          <br />
          Stored grace: {duration(position.mark.grace)}
          <br />
          {!timing.expired && `Mark expires in ${duration(timing.expiresIn)}`}
          <br />
          <span>
            Countdown estimates chain time; eligibility is checked by
            simulation.
          </span>
        </div>
      )}
    </section>
  );
}
const modes = ["Deposit", "Mint", "Repay", "Withdraw"] as const;
type Mode = (typeof modes)[number];
function VaultActions({ ui }: { ui: UI }) {
  const [mode, setMode] = useState<Mode>("Deposit");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const s = ui.snapshot;
  let parsed = 0n;
  try {
    parsed = parseAmount(amount);
  } catch {
    /* validate on submit */
  }
  const needApproval =
    mode === "Deposit" && parsed > 0n && Boolean(s && s.imdAllowance < parsed);
  const id = needApproval ? "approve" : mode.toLowerCase();
  const unit = mode === "Deposit" || mode === "Withdraw" ? "IMD" : "COMP";
  const maximum = !s
    ? 0n
    : mode === "Deposit"
      ? s.imdBalance
      : mode === "Mint"
        ? maximumMint(s)
        : mode === "Repay"
          ? min(s.compBalance, s.position?.debt ?? 0n)
          : maximumWithdrawal(s);
  const freshRequired =
    mode === "Mint" || (mode === "Withdraw" && (s?.position?.debt ?? 0n) > 0n);
  const blocked = freshRequired && !s?.feedsFresh;
  const label = needApproval ? "Approve IMD" : `${mode} ${unit}`;
  const desc = {
    Deposit: "Move IMD from your wallet into this vault as collateral.",
    Mint: "Borrow COMP against your collateral. This increases your debt.",
    Repay:
      "Burn COMP from your wallet to reduce your debt. No approval is needed.",
    Withdraw:
      "Return IMD collateral to your wallet while keeping any remaining debt covered.",
  }[mode];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const value = parseAmount(
        amount,
        unit === "IMD" ? s?.imdDecimals : s?.compDecimals,
      );
      if (value > maximum)
        throw new Error(
          `Amount exceeds the available ${mode.toLowerCase()} limit.`,
        );
      const fn = {
        Deposit: "depositCollateral",
        Mint: "mintCOMP",
        Repay: "repayCOMP",
        Withdraw: "withdrawCollateral",
      }[mode];
      const ok = await ui.act(
        id,
        needApproval
          ? {
              contract: "MockIMD",
              functionName: "approve",
              args: [ui.deployment.contracts.CDPVault.address, value],
            }
          : { contract: "CDPVault", functionName: fn, args: [value] },
      );
      if (ok && !needApproval) setAmount("");
    } catch (e) {
      setError(errorMessage(e));
      document.getElementById("vault-amount")?.focus();
    }
  };
  return (
    <section className="panel">
      <h2>Manage collateral</h2>
      <div className="tabs spaced" role="group" aria-label="Vault action">
        {modes.map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            disabled={!!ui.busy}
            onClick={() => {
              setMode(m);
              setAmount("");
              setError("");
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="small muted">{desc}</p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="amount-wrap">
          <label htmlFor="vault-amount">
            {mode} amount · {unit}
          </label>
          <input
            id="vault-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            disabled={!!ui.busy}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
            aria-invalid={!!error}
            aria-describedby="amount-help amount-error"
          />
        </div>
        <div className="row">
          <span id="amount-help" className="small muted">
            Available: {s ? fmt(maximum) : "—"} {unit}
          </span>
          <button
            type="button"
            className="compact text small"
            disabled={!ui.ready || !!ui.busy}
            onClick={() =>
              setAmount(
                formatUnits(
                  maximum,
                  unit === "IMD"
                    ? (s?.imdDecimals ?? 18)
                    : (s?.compDecimals ?? 18),
                ),
              )
            }
          >
            Use max
          </button>
        </div>
        {mode === "Deposit" && parsed > 0n && s && (
          <p className="small muted spaced">
            Feed value: {fmt((parsed * s.price.value) / 10n ** 18n)} COMP. USD
            price unavailable.
          </p>
        )}
        <p id="amount-error" className="status error" role="status">
          {error}
        </p>
        {blocked && (
          <p className="notice">
            Fresh price and NHI feeds are required for this action.
          </p>
        )}
        <Gate ui={ui}>
          <button
            type="submit"
            className="primary action"
            disabled={!ui.ready || !!ui.busy || blocked}
          >
            {ui.busy === id ? `${label} — pending…` : label}
          </button>
        </Gate>
        {needApproval && (
          <p className="small muted spaced">
            Step 1 of 2: approve exactly {amount} IMD for the vault. Deposit
            requires a separate confirmation.
          </p>
        )}
        <Status ui={ui} id={id} />
        {mode === "Deposit" && !needApproval && <Status ui={ui} id="approve" />}
      </form>
    </section>
  );
}
function Work({ ui }: { ui: UI }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        try {
          const a = parseAmount(amount);
          if (a > (ui.snapshot?.rights ?? 0n))
            throw new Error("Amount exceeds your remaining work rights.");
          void ui.act("work", {
            contract: "CDPVault",
            functionName: "mintFromWork",
            args: [a],
          });
        } catch (e) {
          setError(errorMessage(e));
        }
      }}
    >
      <p className="small muted">
        Consume earned work rights to mint COMP without collateral or debt.
        Rights are spent permanently; repayment does not restore them.
      </p>
      <p>
        Available rights: {ui.wallet.account ? fmt(ui.snapshot?.rights) : "—"}{" "}
        COMP
      </p>
      <label>
        Work mint amount · COMP
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          disabled={!!ui.busy}
        />
      </label>
      <p className="status error" role="status">
        {error}
      </p>
      <Gate ui={ui}>
        <button
          className="action"
          disabled={!ui.ready || !!ui.busy || !ui.snapshot?.feedsFresh}
        >
          {ui.busy === "work" ? "Mint from work — pending…" : "Mint from work"}
        </button>
      </Gate>
      <Status ui={ui} id="work" />
    </form>
  );
}
function Inspector({ ui }: { ui: UI }) {
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Address>();
  const [position, setPosition] = useState<PositionState>();
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const s = ui.snapshot;
  useEffect(() => {
    if (!target || !ui.protocol) return;
    let active = true;
    setLoading(true);
    readPosition(
      ui.protocol,
      target,
      s
        ? { price: s.price.value, minCR: s.minCR, blockNumber: s.blockNumber }
        : undefined,
    )
      .then((p) => {
        if (active) {
          setPosition(p);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setPosition(undefined);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [target, ui.protocol, s?.blockNumber]);
  const timing =
    position && s
      ? markTiming(position, s.liquidationWindow, ui.now)
      : undefined;
  let payout = 0n;
  try {
    if (s?.price.value)
      payout = (parseAmount(amount) * 1100000000000000000n) / s.price.value;
  } catch {}
  return (
    <div className="stack">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const a = input.trim();
          if (!isAddress(a) || /^0x0{40}$/i.test(a)) {
            setError(
              "Enter a valid nonzero Ethereum address. ENS is unavailable on this network.",
            );
            return;
          }
          setTarget(getAddress(a));
          setError("");
          setConfirmed(false);
        }}
      >
        <label>
          Position owner
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
          />
        </label>
        <button className="spaced" disabled={!ui.protocol || !!ui.busy}>
          Inspect position
        </button>
      </form>
      <p className="status error" role="status">
        {error}
      </p>
      {loading && <p role="status">Reading position…</p>}
      {target && position && !loading && (
        <>
          <AddressLink address={target} deployment={ui.deployment} />
          <PositionPanel ui={ui} position={position} inspected />
          <div className="row">
            <button
              disabled={
                !ui.ready ||
                !!ui.busy ||
                !s?.feedsFresh ||
                position.healthy !== false ||
                (position.mark.marked && !timing?.expired)
              }
              onClick={() =>
                void ui.act("mark", {
                  contract: "CDPVault",
                  functionName: "markUnderwater",
                  args: [target],
                })
              }
            >
              {ui.busy === "mark" ? "Marking…" : "Mark underwater"}
            </button>
            <button
              disabled={
                !ui.ready ||
                !!ui.busy ||
                !s?.feedsFresh ||
                !position.healthy ||
                !position.mark.marked
              }
              onClick={() =>
                void ui.act("clear", {
                  contract: "CDPVault",
                  functionName: "clearRecoveredMark",
                  args: [target],
                })
              }
            >
              {ui.busy === "clear" ? "Clearing…" : "Clear recovered mark"}
            </button>
          </div>
          <Status ui={ui} id="mark" />
          <Status ui={ui} id="clear" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              try {
                const a = parseAmount(amount);
                if (a > position.debt || a > (s?.compBalance ?? 0n))
                  throw new Error(
                    "Repayment exceeds target debt or your COMP balance.",
                  );
                if (payout > position.collateral)
                  throw new Error(
                    "The position cannot cover the collateral payout. Reduce the amount.",
                  );
                void ui.act("liquidate", {
                  contract: "CDPVault",
                  functionName: "liquidate",
                  args: [target, a],
                });
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            <label>
              Debt to liquidate · COMP
              <input
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmed(false);
                }}
                inputMode="decimal"
                placeholder="0.00"
                disabled={!!ui.busy}
              />
            </label>
            <p className="small muted spaced">
              Burn your COMP and receive approximately {fmt(payout)} IMD at the
              current feed price (10% liquidation bonus). No COMP approval is
              needed.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the position, amount and collateral payout.
            </label>
            <Gate ui={ui}>
              <button
                className="action"
                disabled={
                  !ui.ready ||
                  !!ui.busy ||
                  !s?.feedsFresh ||
                  !timing?.actionable ||
                  !confirmed
                }
              >
                {ui.busy === "liquidate"
                  ? "Liquidating…"
                  : "Liquidate position"}
              </button>
            </Gate>
            {!timing?.actionable && (
              <p className="small muted spaced">
                Liquidation needs a still-underwater position, an active mark
                and an elapsed grace period.
              </p>
            )}
            <Status ui={ui} id="liquidate" />
          </form>
        </>
      )}
    </div>
  );
}
function Operators({ ui }: { ui: UI }) {
  const s = ui.snapshot;
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [nhi, setNhi] = useState("");
  const [error, setError] = useState("");
  const isImd = !!(
    ui.wallet.account &&
    s &&
    isAddressEqual(ui.wallet.account, s.imdOperator)
  );
  const isWork = !!(
    ui.wallet.account &&
    s &&
    isAddressEqual(ui.wallet.account, s.workOperator)
  );
  const send = (
    id: string,
    contract: string,
    fn: string,
    value: string,
    withRecipient = false,
  ) => {
    setError("");
    try {
      const a = parseAmount(value);
      const to = recipient.trim();
      if (withRecipient && (!isAddress(to) || /^0x0{40}$/i.test(to)))
        throw new Error("Enter a valid nonzero recipient address.");
      void ui.act(id, {
        contract,
        functionName: fn,
        args: withRecipient ? [getAddress(to), a] : [a],
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="stack">
      <p className="small muted">
        Only the configured reporter may publish feed values. Only the faucet
        operator may grant IMD or work rights. These permissions do not allow
        changing vault parameters. NHI uses reporter updates; its attestation
        path is unused this release.
      </p>
      <div className="twocol">
        <div>
          <label>
            Price report · COMP per IMD
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="1.00"
            />
          </label>
          <button
            className="spaced full"
            disabled={!ui.ready || !!ui.busy || !s?.priceReporter}
            onClick={() => send("price-report", "PriceFeed", "report", price)}
          >
            {ui.busy === "price-report" ? "Reporting…" : "Report price"}
          </button>
          <Status ui={ui} id="price-report" />
        </div>
        <div>
          <label>
            NHI report · 18-decimal value
            <input
              value={nhi}
              onChange={(e) => setNhi(e.target.value)}
              inputMode="decimal"
              placeholder="0.85"
            />
          </label>
          <button
            className="spaced full"
            disabled={!ui.ready || !!ui.busy || !s?.nhiReporter}
            onClick={() => send("nhi-report", "NhiFeed", "report", nhi)}
          >
            {ui.busy === "nhi-report" ? "Reporting…" : "Report NHI"}
          </button>
          <Status ui={ui} id="nhi-report" />
        </div>
      </div>
      <p className="small muted">
        Reports must satisfy the feed’s deviation limit while the prior value is
        fresh. An unseeded or stale feed may re-anchor. Use reviewed source
        values.
      </p>
      <label>
        Faucet recipient
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
      </label>
      <label>
        Faucet amount · IMD or work rights
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
        />
      </label>
      <div className="row">
        <button
          disabled={!ui.ready || !!ui.busy || !isImd}
          onClick={() => send("faucet", "MockIMD", "mint", amount, true)}
        >
          {ui.busy === "faucet" ? "Minting…" : "Mint test IMD"}
        </button>
        <button
          disabled={!ui.ready || !!ui.busy || !isWork}
          onClick={() =>
            send("rights", "MockWorkOracle", "grantRights", amount, true)
          }
        >
          {ui.busy === "rights" ? "Granting…" : "Grant work rights"}
        </button>
      </div>
      <Status ui={ui} id="faucet" />
      <Status ui={ui} id="rights" />
      <p className="status error" role="status">
        {error}
      </p>
      {!isImd && !isWork && (
        <p className="small muted">
          Connect the faucet operator’s wallet to enable grants.
        </p>
      )}
    </div>
  );
}
export default App;
