import { useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { Check, ChevronDown, Copy, Network } from "../ui/icons";
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
export function RemoteIconButton({
  label,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  children: ReactNode;
  onClick(): void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rm-icon-button${danger ? " danger" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function RemoteSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="rm-select">
      <select {...props} />
      <ChevronDown size={15} aria-hidden="true" />
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
  const t = useTranslator(messages),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="rm-field" data-copy-field={label}>
      <label>{label}</label>
      <div className="rm-copy-field">
        <code>{value}</code>
        <RemoteIconButton
          label={copied ? t("copied") : t("copy", { name: label })}
          onClick={() =>
            void onCopy(value).then(
              () => {
                setError("");
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              },
              (error) =>
                setError(
                  error instanceof Error ? error.message : String(error),
                ),
            )
          }
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </RemoteIconButton>
      </div>
      {error && (
        <span className="rm-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
