import { useEffect, useState, type SelectHTMLAttributes } from "react";
import { Check, Copy, Network } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/remoteConnections";
import type { RemoteMcpProvider } from "../remote-mcp/types";
import cloudflareLogo from "./assets/connection-brands/cloudflare.svg";
import tailscaleLight from "./assets/connection-brands/tailscale-light.svg";
import tailscaleDark from "./assets/connection-brands/tailscale-dark.svg";

export const remoteProviderKeys = {
  lan: "lan",
  "tailscale-private": "tailnet",
  tailscale: "funnel",
  "cloudflare-quick": "quick",
  cloudflare: "domain",
} as const;
export function RemoteBrand({ provider }: { provider: RemoteMcpProvider }) {
  return (
    <span className="rm-brand">
      {provider === "lan" ? (
        <Network size={25} />
      ) : provider.startsWith("tailscale") ? (
        <>
          <img className="remote-logo-light" src={tailscaleLight} alt="" />
          <img className="remote-logo-dark" src={tailscaleDark} alt="" />
        </>
      ) : (
        <img src={cloudflareLogo} alt="" />
      )}
    </span>
  );
}
export function RemoteSelect({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="rm-select">
      <select {...props} className={`showai-select ${className}`} />
    </span>
  );
}
export function RemoteCopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy(value: string): Promise<void>;
}) {
  const t = useTranslator(messages);
  const [receipt, setReceipt] = useState<{ value: string; error?: string }>();
  const [pending, setPending] = useState(false);
  const copied = receipt?.value === value && !receipt.error;
  const error = receipt?.value === value ? receipt.error : undefined;
  useEffect(() => {
    if (!copied) return;
    const reset = setTimeout(() => setReceipt(undefined), 1800);
    return () => clearTimeout(reset);
  }, [copied, receipt]);
  return (
    <div className="rm-field" data-copy-field={label}>
      <span className="rm-copy-label">{label}</span>
      <div className="rm-copy-field">
        <code>{value}</code>
        <button
          type="button"
          className="rm-button"
          aria-disabled={pending}
          aria-busy={pending}
          aria-label={t("copy", { name: label })}
          onClick={() => {
            if (pending) return;
            setPending(true);
            setReceipt(undefined);
            void onCopy(value)
              .then(
                () => setReceipt({ value }),
                (reason) =>
                  setReceipt({
                    value,
                    error:
                      reason instanceof Error ? reason.message : String(reason),
                  }),
              )
              .finally(() => setPending(false));
          }}
        >
          {copied ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
          <span>
            {t(pending ? "copyingValue" : copied ? "copied" : "copyValue")}
          </span>
        </button>
      </div>
      <span className="settings-sr-only" role="status">
        {copied ? t("copied") : ""}
      </span>
      {error && (
        <span className="rm-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
