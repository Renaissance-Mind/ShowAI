// Shows resource fields that link a file on this device (file: references).
// The workbench grants each file a short-lived local address; a component
// frame asks its host page for that grant; readers and exports, which have
// no device behind them, name the file only.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import {
  isLocalFileRef,
  localRefName,
  type LocalResourceKind,
} from "../portable/local-files.mjs";
import { localMediaUrl } from "./custom/local-media-link";
import { CAPACITY } from "../portable/capacity.mjs";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/media";

export type { LocalResourceKind };

/** What a resource field can show now. */
export interface ResourceView {
  /** The address to load; absent while a local file is granted or when it cannot be shown. */
  url?: string;
  /**
   * ready: load `url`. loading: a local file is being granted. missing: the
   * host cannot open the file. failed: the file opens but cannot be shown.
   * unavailable: no device is behind this view (reader, export).
   */
  status: "ready" | "loading" | "missing" | "failed" | "unavailable";
  /** Whether the value is a file: reference. */
  local: boolean;
  /** The reference as stored. */
  ref?: string;
  /** File name of a local reference. */
  name: string;
  /** The host's reason a local file cannot be opened. */
  message?: string;
  /** Asks the host again, e.g. after the file came back. */
  retry(): void;
  /** Reports that the element could not load `url`. */
  failed(): void;
}

interface Grant {
  token: string;
  name: string;
  expiresAt: number;
}
type Outcome =
  | { status: "ready"; url: string; name: string; expiresAt?: number }
  | { status: "missing" | "unavailable"; name: string; message?: string };

const errorText = (error: unknown) => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
};

/** The channel of the component frame this code runs in, if any. */
function frameChannel(): string | undefined {
  if (typeof document === "undefined" || window.parent === window) return;
  const config = document.getElementById("showai-component-data")?.textContent;
  if (!config) return;
  const channel = (JSON.parse(config) as { channel?: unknown }).channel;
  return typeof channel === "string" ? channel : undefined;
}

let requests = 0;
/** A component frame asks the page around it; the page checks the reference is in the component's props. */
function requestFromHost(
  channel: string,
  ref: string,
  kind: LocalResourceKind,
): Promise<Outcome> {
  const requestId = `resource-${++requests}`;
  return new Promise((resolve) => {
    const finish = (outcome: Outcome) => {
      window.removeEventListener("message", receive);
      clearTimeout(timer);
      resolve(outcome);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (
        event.source !== window.parent ||
        data?.channel !== channel ||
        data.type !== "showai:resource" ||
        data.requestId !== requestId
      )
        return;
      // Bytes arrive where the frame cannot reach the host's address.
      const url =
        data.bytes instanceof ArrayBuffer
          ? URL.createObjectURL(
              new Blob([data.bytes], { type: String(data.mime ?? "") }),
            )
          : data.url;
      finish(
        data.status === "ready" && typeof url === "string"
          ? {
              status: "ready",
              url,
              name: String(data.name ?? localRefName(ref)),
              expiresAt: Number(data.expiresAt) || undefined,
            }
          : {
              status: data.status === "missing" ? "missing" : "unavailable",
              name: localRefName(ref),
              ...(typeof data.message === "string"
                ? { message: data.message }
                : {}),
            },
      );
    };
    // A host page without local files never answers.
    const timer = setTimeout(
      () => finish({ status: "unavailable", name: localRefName(ref) }),
      10000,
    );
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { channel, type: "showai:resource", requestId, ref, kind },
      "*",
    );
  });
}

/**
 * Grants a local file through the workbench host. Absolute URLs, so a
 * component frame (an opaque document) can load them too.
 */
export async function grantLocalResource(
  ref: string,
  kind: LocalResourceKind,
): Promise<Outcome> {
  const name = localRefName(ref);
  const bridge = typeof window === "undefined" ? undefined : window.showai;
  if (bridge)
    return bridge.invoke<Grant>("media:resolve", { ref, kind }).then(
      (grant) => ({
        status: "ready",
        url: new URL(localMediaUrl(grant.token), location.href).href,
        name: grant.name,
        expiresAt: grant.expiresAt,
      }),
      // The host names why it cannot open the file; the field shows it.
      (error: unknown) => ({ status: "missing", name, message: errorText(error) }),
    );
  const channel = frameChannel();
  if (channel) return requestFromHost(channel, ref, kind);
  return { status: "unavailable", name };
}

/**
 * The answer to a component frame's request for a local file. Desktop frames
 * load the granted address; the browser workbench's loopback address is out
 * of reach for opaque frames, so they receive the file's bytes (up to one
 * resource budget) and make their own blob address.
 */
export async function frameResource(
  ref: string,
  kind: LocalResourceKind,
): Promise<{ answer: Record<string, unknown>; transfer: Transferable[] }> {
  const outcome = await grantLocalResource(ref, kind);
  if (outcome.status !== "ready")
    return {
      answer: {
        status: outcome.status,
        ...(outcome.message ? { message: outcome.message } : {}),
      },
      transfer: [],
    };
  if (!(window as { __SHOWAI_LOCAL__?: unknown }).__SHOWAI_LOCAL__)
    return {
      answer: {
        status: "ready",
        url: outcome.url,
        name: outcome.name,
        expiresAt: outcome.expiresAt,
      },
      transfer: [],
    };
  const response = await fetch(outcome.url);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || size > CAPACITY.resourceBytes) {
    await response.body?.cancel();
    return {
      answer: {
        status: "unavailable",
        message: response.ok
          ? `${outcome.name} is larger than a component can show in the browser workbench.`
          : `HTTP ${response.status}`,
      },
      transfer: [],
    };
  }
  const bytes = await response.arrayBuffer();
  return {
    answer: {
      status: "ready",
      bytes,
      mime: response.headers.get("content-type") ?? "",
      name: outcome.name,
    },
    transfer: [bytes],
  };
}

const cache = new Map<string, Promise<Outcome>>();
const listeners = new Map<string, Set<() => void>>();
const cacheKey = (ref: string, kind: LocalResourceKind) => `${kind}\n${ref}`;

function resolveCached(ref: string, kind: LocalResourceKind) {
  const key = cacheKey(ref, kind);
  let pending = cache.get(key);
  if (!pending) {
    const request = grantLocalResource(ref, kind);
    pending = request;
    cache.set(key, request);
    // Only grants are kept: a file that is missing now may be back for the next view.
    void request.then((outcome) => {
      if (outcome.status !== "ready" && cache.get(key) === request)
        cache.delete(key);
    });
  }
  return pending;
}

/** Forget a grant, so every view of the file asks the host again. */
function invalidate(ref: string, kind: LocalResourceKind) {
  const key = cacheKey(ref, kind);
  cache.delete(key);
  for (const listener of listeners.get(key) ?? []) listener();
}

const RENEW_BEFORE = 60 * 1000;
const noop = () => {};

/**
 * What a resource field shows for its value: web addresses and embedded
 * data as they are, local file references through a granted address.
 */
export function useResource(
  value: unknown,
  kind: LocalResourceKind,
): ResourceView {
  const ref = isLocalFileRef(value) ? value : undefined;
  const [state, setState] = useState<{ ref?: string; outcome?: Outcome }>({});
  // An element that cannot load the file asks the host once more, then fails.
  const [failure, setFailure] = useState<{
    ref?: string;
    step: "retrying" | "failed";
  }>();
  useEffect(() => {
    if (!ref) return;
    let active = true;
    const load = () =>
      void resolveCached(ref, kind).then(
        (outcome) => active && setState({ ref, outcome }),
      );
    const key = cacheKey(ref, kind);
    const own = listeners.get(key) ?? new Set();
    listeners.set(key, own);
    own.add(load);
    load();
    return () => {
      active = false;
      own.delete(load);
    };
  }, [ref, kind]);
  const outcome = state.ref === ref ? state.outcome : undefined;
  const expiresAt =
    outcome?.status === "ready" ? outcome.expiresAt : undefined;
  useEffect(() => {
    if (!ref || !expiresAt) return;
    // Grants expire; ask for a fresh one shortly before.
    const timer = setTimeout(
      () => invalidate(ref, kind),
      Math.max(1000, expiresAt - Date.now() - RENEW_BEFORE),
    );
    return () => clearTimeout(timer);
  }, [ref, kind, expiresAt]);
  const retry = useCallback(() => {
    setFailure(undefined);
    if (ref) invalidate(ref, kind);
  }, [ref, kind]);
  const url = outcome?.status === "ready" ? outcome.url : undefined;
  const step = failure?.ref === ref ? failure?.step : undefined;
  const failed = useCallback(() => {
    if (!ref || !url || step === "failed") return;
    if (step === "retrying") {
      setFailure({ ref, step: "failed" });
      return;
    }
    // The file may have moved since it was granted; ask again before failing.
    setFailure({ ref, step: "retrying" });
    invalidate(ref, kind);
  }, [ref, kind, url, step]);
  if (!ref)
    return {
      url: typeof value === "string" && value ? value : undefined,
      status: "ready",
      local: false,
      name: "",
      retry: noop,
      failed: noop,
    };
  const name = outcome?.name ?? localRefName(ref);
  if (!outcome)
    return { status: "loading", local: true, ref, name, retry, failed };
  if (outcome.status !== "ready")
    return {
      status: outcome.status,
      local: true,
      ref,
      name,
      ...(outcome.message ? { message: outcome.message } : {}),
      retry,
      failed,
    };
  return step === "failed"
    ? { status: "failed", local: true, ref, name, retry, failed }
    : { url, status: "ready", local: true, ref, name, retry, failed };
}

/** What the workbench shows for a local file it cannot show: its warning surface. */
export interface LocalResourceIssueProps {
  view: ResourceView;
  kind: LocalResourceKind;
  /** Stores another file reference in the field; absent when it is read-only. */
  onReplace?: (ref: string) => void;
}
export const LocalResourceUi = createContext<{
  Issue: ComponentType<LocalResourceIssueProps>;
} | null>(null);

/**
 * A local file a field cannot show: the workbench warning with its actions,
 * or in readers and exports a notice naming the file.
 */
export function LocalResourceNotice(props: LocalResourceIssueProps) {
  const ui = useContext(LocalResourceUi);
  const t = useTranslator(messages);
  if (props.view.status === "loading")
    return (
      <div className="sb-resource-loading" role="status">
        {t("localLoading", { name: props.view.name })}
      </div>
    );
  if (ui && props.view.status !== "unavailable") return <ui.Issue {...props} />;
  return (
    <p className="sb-resource-notice" role="status">
      {t("localUnavailable", { name: props.view.name })}
    </p>
  );
}

/**
 * Links an original file to a resource field: the workbench host opens its
 * file chooser. Undefined where no host can link files (readers, frames).
 */
export function useLocalFileChooser():
  | ((
      kind: LocalResourceKind,
      multiple?: boolean,
    ) => Promise<{ ref: string; name: string }[]>)
  | undefined {
  const bridge = typeof window === "undefined" ? undefined : window.showai;
  return bridge
    ? async (kind, multiple = false) => {
        const result = await bridge.invoke<{
          files: { ref: string; name: string }[];
        } | null>("media:chooseFile", { kind, multiple });
        return result?.files ?? [];
      }
    : undefined;
}
