import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { parseAmount, errorMessage } from "./protocol";
import {
  quoteSwap,
  readSwapAllowances,
  approveSwapToken,
  approveSwapPermit2,
  executeSwap,
  type SwapDirection,
  type SwapQuote,
  type SwapStep,
} from "./swap";
import { fmt, Gate, Status, type UI } from "./App";
export default function Swap({ ui }: { ui: UI }) {
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.50");
  const [quote, setQuote] = useState<SwapQuote>();
  const [step, setStep] = useState<SwapStep>();
  const [error, setError] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const generation = useRef(0);
  const s = ui.snapshot;
  useEffect(() => {
    generation.current++;
    setQuote(undefined);
    setStep(undefined);
    setReviewed(false);
    setError("");
  }, [amount, slippage, direction, ui.wallet.account, ui.wallet.chainId]);
  const requestQuote = async () => {
    if (!ui.protocol || !ui.wallet.account) return;
    setError("");
    setQuoting(true);
    const gen = generation.current;
    try {
      const decimals =
        direction === "buy"
          ? ui.deployment.network.nativeCurrency.decimals
          : (s?.cplDecimals ?? 18);
      const value = parseAmount(amount, decimals);
      if (
        value >
        (direction === "buy" ? (s?.ethBalance ?? 0n) : (s?.cplBalance ?? 0n))
      )
        throw new Error(
          "The amount exceeds your wallet balance. Leave enough ETH for gas.",
        );
      if (!/^\d+(\.\d{1,2})?$/.test(slippage))
        throw new Error(
          "Use a slippage percentage with up to two decimal places.",
        );
      const bps = Math.round(Number(slippage) * 100);
      const q = await quoteSwap(
        ui.deployment,
        ui.protocol.client,
        ui.wallet.account,
        direction,
        value,
        bps,
      );
      const a = await readSwapAllowances(
        ui.deployment,
        ui.protocol.client,
        ui.wallet.account,
        q,
      );
      if (gen === generation.current) {
        setQuote(q);
        setStep(a.nextStep);
        setReviewed(false);
      }
    } catch (e) {
      if (gen === generation.current) {
        setError(errorMessage(e));
        setQuote(undefined);
      }
    } finally {
      setQuoting(false);
    }
  };
  const execute = async () => {
    if (
      !quote ||
      !step ||
      !ui.protocol ||
      !ui.wallet.provider ||
      !ui.wallet.account
    )
      return;
    const p = ui.protocol;
    const account = ui.wallet.account;
    const wallet = createWalletClient({
      chain: ui.deployment.chain,
      account,
      transport: custom(ui.wallet.provider),
    });
    const id = `swap-${step}`;
    await ui.run(id, async (report) => {
      report({
        text:
          step === "swap"
            ? "Simulating swap. Review the wallet request…"
            : "Simulating approval. Review the wallet request…",
      });
      const fn =
        step === "approve-token"
          ? approveSwapToken
          : step === "approve-permit2"
            ? approveSwapPermit2
            : executeSwap;
      const hash = await fn(
        ui.deployment,
        p.client,
        wallet,
        account,
        quote,
        (h) => report({ text: "Waiting for confirmation…", hash: h }),
      );
      report({
        text: "Confirmed. Refreshing balances…",
        hash: hash ?? undefined,
      });
      if (step === "swap") {
        setQuote(undefined);
        setAmount("");
        setStep(undefined);
      } else {
        const allowances = await readSwapAllowances(
          ui.deployment,
          p.client,
          account,
          quote,
        );
        setStep(allowances.nextStep);
        setReviewed(false);
      }
    });
  };
  const expired = !!quote && Date.now() >= quote.expiresAt;
  const id = `swap-${step}`;
  const label =
    step === "approve-token"
      ? "Approve CPL to Permit2"
      : step === "approve-permit2"
        ? "Approve router in Permit2"
        : "Swap tokens";
  return (
    <div className="stack">
      <p className="small muted">
        CPL is COMP Launch, a separate token from vault-issued COMP. This pool
        trades CPL against Sepolia ETH through Uniswap v4. USD context is
        unavailable.
      </p>
      <div className="twocol">
        <label>
          Swap direction
          <select
            value={direction}
            disabled={!!ui.busy || quoting}
            onChange={(e) => setDirection(e.target.value as SwapDirection)}
          >
            <option value="buy">ETH → CPL</option>
            <option value="sell">CPL → ETH</option>
          </select>
        </label>
        <label>
          Slippage tolerance · %
          <input
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            inputMode="decimal"
            disabled={!!ui.busy || quoting}
          />
        </label>
      </div>
      <label>
        Swap amount · {direction === "buy" ? "ETH" : "CPL"}
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          disabled={!!ui.busy || quoting}
        />
      </label>
      <span className="small muted">
        Balance:{" "}
        {ui.wallet.account
          ? fmt(direction === "buy" ? s?.ethBalance : s?.cplBalance)
          : "—"}{" "}
        {direction === "buy" ? "ETH" : "CPL"} · Keep ETH for gas
      </span>
      <p className="status error" role="status">
        {error}
      </p>
      <Gate ui={ui}>
        <button
          disabled={!ui.ready || !!ui.busy || quoting}
          onClick={() => void requestQuote()}
        >
          {quoting ? "Quoting…" : quote ? "Refresh quote" : "Get quote"}
        </button>
      </Gate>
      {quote && (
        <>
          <div className="ratio stack">
            <div className="row">
              <span className="muted small">Estimated receive</span>
              <span>
                {fmt(quote.amountOut)} {quote.outputSymbol}
              </span>
            </div>
            <div className="row">
              <span className="muted small">Minimum received</span>
              <span>
                {fmt(quote.minimumOut)} {quote.outputSymbol}
              </span>
            </div>
            <div className="row">
              <span className="muted small">Slippage / quote</span>
              <span className="small">
                {quote.slippageBps / 100}% /{" "}
                {expired
                  ? "Expired"
                  : `${Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000))}s remaining`}
              </span>
            </div>
          </div>
          {direction === "sell" && (
            <p className="small muted">
              Each approval is a separate step: CPL → Permit2, then Permit2 →
              router. Both are capped at {fmt(quote.amountIn)} CPL; router
              permission expires in 10 minutes.
            </p>
          )}
          {expired && (
            <p className="notice">
              Quote expired. Refresh the quote before continuing.
            </p>
          )}
          {step === "swap" && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the amount, minimum received and slippage.
            </label>
          )}
          <button
            disabled={
              !ui.ready ||
              !!ui.busy ||
              quoting ||
              expired ||
              (step === "swap" && !reviewed)
            }
            onClick={() => void execute()}
          >
            {ui.busy === id ? `${label} — pending…` : label}
          </button>
        </>
      )}
      <Status ui={ui} id="swap-approve-token" />
      <Status ui={ui} id="swap-approve-permit2" />
      <Status ui={ui} id="swap-swap" />
    </div>
  );
}
