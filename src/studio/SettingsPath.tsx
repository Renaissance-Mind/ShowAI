import { useEffect, useState } from "react";
import { Check, Copy, Folder } from "../ui/icons";

export function SettingsPath({
  value,
  copyLabel,
  copiedLabel,
  disabled = false,
  onCopy,
}: {
  value: string;
  copyLabel: string;
  copiedLabel?: string;
  disabled?: boolean;
  onCopy: () => Promise<unknown> | boolean | void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="settings-path">
      <Folder size={15} aria-hidden="true" />
      <code>{value}</code>
      <button
        type="button"
        className="settings-icon-button settings-path-copy"
        data-copied={copied ? "true" : undefined}
        aria-label={copied && copiedLabel ? copiedLabel : copyLabel}
        title={copied && copiedLabel ? copiedLabel : copyLabel}
        disabled={disabled}
        onClick={() => {
          void Promise.resolve(onCopy()).then(
            (result) => {
              if (result !== false) setCopied(true);
            },
            () => {},
          );
        }}
      >
        {copied ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
