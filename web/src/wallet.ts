import { useCallback, useEffect, useState } from "react";
import { getAddress, toHex, type Address, type EIP1193Provider } from "viem";
import type { Deployment } from "./config";
export type BrowserProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
};
declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}
export function useWallet(deployment?: Deployment) {
  const [provider, setProvider] = useState<BrowserProvider>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const p = window.ethereum;
    setProvider(p);
    if (!p) return;
    const accounts = (a: string[]) =>
      setAccount(a[0] ? getAddress(a[0]) : undefined);
    const chains = (c: string) => setChainId(Number(c));
    void Promise.all([
      p.request({ method: "eth_accounts" }),
      p.request({ method: "eth_chainId" }),
    ])
      .then(([a, c]) => {
        accounts(a);
        chains(c);
      })
      .catch(() => {});
    p.on?.("accountsChanged", accounts);
    p.on?.("chainChanged", chains);
    return () => {
      p.removeListener?.("accountsChanged", accounts);
      p.removeListener?.("chainChanged", chains);
    };
  }, []);
  const connect = useCallback(async () => {
    const p = provider ?? window.ethereum;
    if (!p) {
      setError(
        "No browser wallet found. Open this page in an Ethereum wallet browser or install a browser wallet, then reload.",
      );
      return;
    }
    setPending(true);
    setError("");
    setProvider(p);
    try {
      const a = await p.request({ method: "eth_requestAccounts" });
      setAccount(a[0] ? getAddress(a[0]) : undefined);
      setChainId(Number(await p.request({ method: "eth_chainId" })));
    } catch (e) {
      setError(walletError(e));
    } finally {
      setPending(false);
    }
  }, [provider]);
  const switchChain = useCallback(async () => {
    if (!provider || !deployment) return;
    setPending(true);
    setError("");
    try {
      const chainId = toHex(deployment.manifest.chainId);
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }],
        });
      } catch (e) {
        const unknown = e as {
          code?: number;
          message?: string;
          data?: { originalError?: { code?: number } };
        };
        if (
          unknown.code !== 4902 &&
          unknown.data?.originalError?.code !== 4902 &&
          !/unknown chain|unrecognized chain|chain.*not.*add/i.test(
            unknown.message ?? "",
          )
        )
          throw e;
        if (!deployment.manifest.walletAddChain)
          throw new Error(
            "This deployment does not include settings to add the network.",
          );
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [deployment.manifest.walletAddChain as any],
        });
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }],
        });
      }
      setChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (e) {
      setError(walletError(e));
    } finally {
      setPending(false);
    }
  }, [provider, deployment]);
  return { provider, account, chainId, pending, error, connect, switchChain };
}
function walletError(e: unknown) {
  const err = e as { code?: number; message?: string };
  return err.code === 4001
    ? "Wallet request declined. You can try again when ready."
    : err.message || "Wallet unavailable. Check your wallet and try again.";
}
