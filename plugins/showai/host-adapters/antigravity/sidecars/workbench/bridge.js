(function () {
  "use strict";

  const initialParams = new URLSearchParams(window.location.search);
  const sidecarToken = initialParams.get("token") || "";

  function parseColor(value) {
    if (!value || typeof value !== "string") return null;
    const s = value.trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw =
        hex[1].length === 3
          ? hex[1]
              .split("")
              .map((c) => c + c)
              .join("")
          : hex[1];
      return [
        parseInt(raw.slice(0, 2), 16),
        parseInt(raw.slice(2, 4), 16),
        parseInt(raw.slice(4, 6), 16),
      ];
    }
    const srgb = s.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (srgb) {
      return [
        Number(srgb[1]) * 255,
        Number(srgb[2]) * 255,
        Number(srgb[3]) * 255,
      ];
    }
    const rgb = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  }

  function resolveComputedBackgroundRgb() {
    if (!document.documentElement) return null;
    try {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;pointer-events:none;color:var(--background, var(--content, #f7f8f5))";
      document.documentElement.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return parseColor(computed);
    } catch {
      return null;
    }
  }

  function applyResolvedTheme(rgb) {
    if (!rgb) return;
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    const mode = luminance < 0.5 ? "dark" : "light";
    if (document.documentElement.dataset.theme !== mode) {
      document.documentElement.dataset.theme = mode;
    }
    document.documentElement.style.colorScheme = mode;
    if (document.body) {
      document.body.style.background = "var(--paper)";
      document.body.style.color = "var(--text)";
    }
  }

  function applyThemeFromVars(vars) {
    const direct =
      vars && typeof vars === "object"
        ? parseColor(vars["--background"] || vars["--content"])
        : null;
    applyResolvedTheme(direct || resolveComputedBackgroundRgb());
  }

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "theme-change") {
      applyThemeFromVars(event.data.payload && event.data.payload.cssVariables);
    }
  });

  if (typeof MutationObserver === "function" && document.documentElement) {
    new MutationObserver(() => {
      applyResolvedTheme(resolveComputedBackgroundRgb());
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  const syncBodyColors = () => {
    if (document.body) {
      document.body.style.background = "var(--paper)";
      document.body.style.color = "var(--text)";
    }
    applyResolvedTheme(resolveComputedBackgroundRgb());
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncBodyColors, { once: true });
  } else {
    syncBodyColors();
  }

  function isSameOriginUrl(rawUrl) {
    try {
      const resolved = new URL(String(rawUrl), window.location.href);
      return resolved.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  if (sidecarToken && typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url =
        typeof input === "string"
          ? input
          : typeof URL !== "undefined" && input instanceof URL
            ? input.href
            : input && typeof input.url === "string"
              ? input.url
              : "";
      if (url && isSameOriginUrl(url)) {
        const headers = new Headers(
          (init && init.headers) ||
            (typeof Request !== "undefined" && input instanceof Request
              ? input.headers
              : undefined),
        );
        if (!headers.has("X-Sidecar-Token")) {
          headers.set("X-Sidecar-Token", sidecarToken);
        }
        return nativeFetch(input, Object.assign({}, init, { headers }));
      }
      return nativeFetch(input, init);
    };
  }

  if (sidecarToken && typeof window.EventSource === "function") {
    const NativeEventSource = window.EventSource;
    const PatchedEventSource = function (url, eventSourceInitDict) {
      let targetUrl = url;
      try {
        const resolved = new URL(String(url), window.location.href);
        if (
          resolved.origin === window.location.origin &&
          resolved.pathname === "/api/events" &&
          resolved.searchParams.has("token") &&
          !resolved.searchParams.has("showai_token")
        ) {
          resolved.searchParams.set(
            "showai_token",
            resolved.searchParams.get("token") || "",
          );
          resolved.searchParams.set("token", sidecarToken);
          targetUrl = resolved.pathname + resolved.search;
        }
      } catch {
        // Keep original URL if parsing fails.
      }
      return new NativeEventSource(targetUrl, eventSourceInitDict);
    };
    PatchedEventSource.prototype = NativeEventSource.prototype;
    PatchedEventSource.CONNECTING = NativeEventSource.CONNECTING;
    PatchedEventSource.OPEN = NativeEventSource.OPEN;
    PatchedEventSource.CLOSED = NativeEventSource.CLOSED;
    window.EventSource = PatchedEventSource;
  }

  function buildShowaiUri(reference) {
    const projectId =
      reference && reference.projectId ? encodeURIComponent(reference.projectId) : "";
    const pageId =
      reference && reference.pageId ? encodeURIComponent(reference.pageId) : "";
    let uri =
      projectId && pageId
        ? "showai://project/" + projectId + "/page/" + pageId
        : window.location.href;
    const blockIds =
      reference && Array.isArray(reference.blockIds)
        ? reference.blockIds.filter(Boolean)
        : [];
    if (blockIds.length) {
      uri += "#block=" + encodeURIComponent(blockIds[0]);
    }
    return uri;
  }

  function buildSelectionSummary(reference, components) {
    const parts = [];
    if (reference && typeof reference.excerpt === "string" && reference.excerpt.trim()) {
      parts.push(reference.excerpt.trim());
    }
    if (Array.isArray(components) && components.length) {
      const names = components
        .map((c) => (c && (c.title || c.name || c.kind)) || "")
        .filter(Boolean);
      if (names.length) parts.push("Components: " + names.join(", "));
    }
    return parts.join("\n").slice(0, 1200) || (reference && reference.pageTitle) || "ShowAI";
  }

  window.__SHOWAI_ANTIGRAVITY_HOST__ = {
    canReference() {
      return Boolean(
        (window.sidecar && window.sidecar.ui && window.sidecar.ui.addArtifactComment) ||
          (window.sidecar && window.sidecar.agent && window.sidecar.agent.sendMessage),
      );
    },
    async attachReference(reference, text, components) {
      const uri = buildShowaiUri(reference);
      const pageTitle = (reference && reference.pageTitle) || document.title || "ShowAI";
      const selection = buildSelectionSummary(reference, components);
      const comment = typeof text === "string" && text.trim() ? text : selection;
      if (window.sidecar && window.sidecar.ui && window.sidecar.ui.addArtifactComment) {
        window.sidecar.ui.addArtifactComment({
          uri,
          comment,
          selection,
          pageTitle,
        });
        return { ok: true, mode: "artifact-comment" };
      }
      if (window.sidecar && window.sidecar.agent && window.sidecar.agent.sendMessage) {
        return window.sidecar.agent.sendMessage(comment);
      }
      throw new Error("Antigravity sidecar bridge unavailable.");
    },
    async openLink(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };

  function fileUriToPath(uri) {
    if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
    try {
      let pathname = decodeURIComponent(new URL(uri).pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return pathname.replace(/\/+$/, "") || "/";
    } catch {
      return null;
    }
  }

  function normalizePath(p) {
    if (typeof p !== "string" || !p.trim()) return null;
    return p.trim().replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  }

  function bestMatchingProject(projects, workspacePaths) {
    let best = null;
    let bestScore = -1;
    for (const project of projects) {
      const src = normalizePath(project && project.sourceDirectory);
      if (!src) continue;
      for (const ws of workspacePaths) {
        if (ws === src) {
          const score = 100000 + src.length;
          if (score > bestScore) {
            bestScore = score;
            best = project;
          }
        } else if (ws.startsWith(src + "/") || src.startsWith(ws + "/")) {
          const score = Math.min(src.length, ws.length);
          if (score > bestScore) {
            bestScore = score;
            best = project;
          }
        }
      }
    }
    return best;
  }

  async function syncWorkspaceProject(uris) {
    if (document.readyState === "loading") {
      await new Promise((resolve) =>
        document.addEventListener("DOMContentLoaded", resolve, { once: true }),
      );
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has("project") || params.has("page")) return;
    const token = window.__SHOWAI_LOCAL__ && window.__SHOWAI_LOCAL__.token;
    if (!token || !Array.isArray(uris) || !uris.length) return;
    const paths = uris.map(fileUriToPath).filter(Boolean);
    if (!paths.length) return;
    const workspaceKey = paths.join("|");
    try {
      if (sessionStorage.getItem("showai:ag:workspace") === workspaceKey) return;
    } catch {
      // Ignore restricted sessionStorage.
    }
    try {
      const res = await window.fetch("/api/invoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "X-ShowAI-Client": "antigravity-sidecar-bridge",
        },
        body: JSON.stringify({ action: "projects:list", args: {} }),
      });
      if (!res.ok) return;
      const body = await res.json();
      const projects = Array.isArray(body && body.data) ? body.data : [];
      const match = bestMatchingProject(projects, paths);
      if (!match || !match.id) return;
      try {
        sessionStorage.setItem("showai:ag:workspace", workspaceKey);
      } catch {
        // Ignore restricted sessionStorage.
      }
      params.set("project", match.id);
      window.location.replace("/?" + params.toString());
    } catch {
      // Non-fatal: user can still pick any project manually.
    }
  }

  if (window.sidecar && typeof window.sidecar.onWorkspaceChange === "function") {
    window.sidecar.onWorkspaceChange((uris) => {
      void syncWorkspaceProject(uris);
    });
  }
})();
