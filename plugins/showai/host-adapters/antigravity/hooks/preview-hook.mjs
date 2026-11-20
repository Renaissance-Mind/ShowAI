#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TARGET_TOOL_RE = /(?:^|[:_./-])(show_component|page_present|render_document)$/;
const PENDING_FILE = ".showai-pending-embed.json";
const MAX_PENDING_AGE_MS = 5 * 60 * 1000;
const MAX_RECENT_INLINE_AGE_MS = 20 * 1000;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function isOfflineBundledFragment(html) {
  if (typeof html !== "string" || !html.trim()) return false;
  return !/<script\b[^>]*\bsrc\s*=\s*["']https?:/i.test(html);
}

export function wrapForAntigravityEmbed(fragmentHtml, { title = "ShowAI Preview" } = {}) {
  const trimmed = String(fragmentHtml ?? "").trim();
  const themeSyncScript = `<script>
(() => {
  const parseRgb = (value) => {
    if (!value) return null;
    const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw = hex[1].length === 3
        ? hex[1].split("").map((c) => c + c).join("")
        : hex[1];
      return [
        parseInt(raw.slice(0, 2), 16),
        parseInt(raw.slice(2, 4), 16),
        parseInt(raw.slice(4, 6), 16),
      ];
    }
    const rgb = value.match(/rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  };
  const detectTheme = () => {
    const root = document.documentElement;
    if (root.classList.contains("dark")) return "dark";
    if (root.classList.contains("light")) return "light";
    const bg = getComputedStyle(root).getPropertyValue("--background");
    const rgb = parseRgb(bg);
    if (rgb) {
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      return lum < 0.5 ? "dark" : "light";
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const sync = () => {
    const theme = detectTheme();
    document.documentElement.style.colorScheme = theme;
    for (const node of document.querySelectorAll("[data-showai-inline-root]")) {
      node.dataset.theme = theme;
    }
  };
  sync();
  window.addEventListener("themechange", sync);
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sync);
  const rootObserver = new MutationObserver(() => {
    if (document.querySelector("[data-showai-inline-root]")) sync();
  });
  rootObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
</script>`;
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html\b/i.test(trimmed)) {
    if (trimmed.includes("</body>")) {
      return trimmed.replace("</body>", `${themeSyncScript}\n</body>`);
    }
    return `${trimmed}\n${themeSyncScript}`;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--foreground, inherit);
}
</style>
</head>
<body>
${trimmed}
${themeSyncScript}
</body>
</html>
`;
}

function matchShowaiTool(toolCall) {
  const name = typeof toolCall?.name === "string" ? toolCall.name : "";
  const direct = TARGET_TOOL_RE.exec(name);
  if (direct) return direct[1];
  const nested =
    typeof toolCall?.args?.tool === "string"
      ? toolCall.args.tool
      : typeof toolCall?.args?.toolName === "string"
        ? toolCall.args.toolName
        : "";
  const nestedMatch = TARGET_TOOL_RE.exec(nested);
  return nestedMatch ? nestedMatch[1] : null;
}

function previewDirectories(env = process.env) {
  const dirs = [];
  if (env.SHOWAI_PRESENTATION_DIR && isAbsolute(env.SHOWAI_PRESENTATION_DIR)) {
    dirs.push(resolve(env.SHOWAI_PRESENTATION_DIR));
  }
  const home = resolve(env.SHOWAI_HOME || join(homedir(), ".showai"));
  dirs.push(join(home, "local", "agent-previews"));
  return [...new Set(dirs)];
}

async function isInsideAny(filePath, roots) {
  let realTarget;
  try {
    realTarget = await realpath(filePath);
  } catch {
    return false;
  }
  for (const root of roots) {
    let realRoot;
    try {
      realRoot = await realpath(root);
    } catch {
      continue;
    }
    const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (realTarget === realRoot || realTarget.startsWith(prefix)) return true;
  }
  return false;
}

function extractResultMetadata(obj) {
  if (!obj || typeof obj !== "object") return null;
  const data = obj.data && typeof obj.data === "object" ? obj.data : obj;
  const delivery = data.delivery;
  if (!delivery || typeof delivery !== "object" || typeof delivery.inline !== "string") {
    return null;
  }
  const display = data.display && typeof data.display === "object" ? data.display : {};
  return {
    inlinePath: delivery.inline,
    htmlPath: typeof delivery.html === "string" ? delivery.html : undefined,
    reader: typeof display.reader === "string" ? display.reader : undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    projectId: typeof data.projectId === "string" ? data.projectId : undefined,
    pageId: typeof data.pageId === "string" ? data.pageId : undefined,
    openUrl: typeof data.openUrl === "string" ? data.openUrl : undefined,
    blockIds: Array.isArray(data.blockIds)
      ? data.blockIds.filter((id) => typeof id === "string" && id)
      : undefined,
  };
}

function parseJsonCandidates(text) {
  if (typeof text !== "string" || !text.includes("inline")) return null;
  try {
    const direct = extractResultMetadata(JSON.parse(text));
    if (direct) return direct;
  } catch {
    // Continue searching embedded JSON payloads.
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const sliced = extractResultMetadata(JSON.parse(text.slice(start, end + 1)));
      if (sliced) return sliced;
    } catch {
      // Ignore unparseable wrapper text.
    }
  }
  return null;
}

async function readTranscriptTail(transcriptPath) {
  if (!transcriptPath || !isAbsolute(transcriptPath)) return "";
  let fh;
  try {
    fh = await open(transcriptPath, "r");
    const info = await fh.stat();
    const length = Math.min(info.size, TRANSCRIPT_TAIL_BYTES);
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    await fh.read(buffer, 0, length, info.size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    await fh?.close().catch(() => {});
  }
}

async function findMetadataInTranscript(transcriptPath) {
  const tail = await readTranscriptTail(transcriptPath);
  if (!tail) return null;
  const lines = tail.split("\n").filter((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    let step;
    try {
      step = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!step || typeof step !== "object") continue;
    const direct = extractResultMetadata(step);
    if (direct) return direct;
    if (typeof step.content === "string") {
      const fromContent = parseJsonCandidates(step.content);
      if (fromContent) return fromContent;
    }
    if (Array.isArray(step.content)) {
      for (const item of step.content) {
        if (typeof item?.text === "string") {
          const fromText = parseJsonCandidates(item.text);
          if (fromText) return fromText;
        }
      }
    }
  }
  return null;
}

async function findNewestInlineFile(roots, now = Date.now()) {
  let newest = null;
  async function scan(directory, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".inline.html")) {
        try {
          const info = await stat(fullPath);
          if (
            now - info.mtimeMs <= MAX_RECENT_INLINE_AGE_MS &&
            (!newest || info.mtimeMs > newest.mtimeMs)
          ) {
            newest = { path: fullPath, mtimeMs: info.mtimeMs };
          }
        } catch {
          // Skip vanishing temp files.
        }
      }
    }
  }
  for (const root of roots) await scan(root, 0);
  return newest?.path ?? null;
}

function buildSidecarUrl({ projectId, pageId, blockIds }) {
  if (!projectId || !pageId) return undefined;
  const params = new URLSearchParams({ project: projectId, page: pageId });
  if (blockIds?.length === 1) params.set("block", blockIds[0]);
  else if (blockIds?.length > 1) params.set("blocks", blockIds.join(","));
  return `sidecar://showai/workbench/?${params.toString()}`;
}

async function atomicWrite(targetPath, content) {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
}

async function handlePostToolUse(payload, env) {
  if (payload.error) return {};
  const tool = matchShowaiTool(payload.toolCall);
  if (!tool) return {};
  const artifactDir = payload.artifactDirectoryPath;
  if (typeof artifactDir !== "string" || !isAbsolute(artifactDir)) return {};

  const roots = previewDirectories(env);
  let meta = await findMetadataInTranscript(payload.transcriptPath);
  if (!meta) {
    const recentPath = await findNewestInlineFile(roots);
    if (recentPath) meta = { inlinePath: recentPath };
  }
  if (!meta?.inlinePath || !isAbsolute(meta.inlinePath)) return {};
  if (meta.reader && meta.reader !== "bundled") return {};
  if (!(await isInsideAny(meta.inlinePath, roots))) return {};

  let fragment;
  try {
    fragment = await readFile(meta.inlinePath, "utf8");
  } catch {
    return {};
  }
  if (!isOfflineBundledFragment(fragment)) return {};

  const wrapped = wrapForAntigravityEmbed(fragment, {
    title: meta.title || "ShowAI Preview",
  });
  const digest = createHash("sha256").update(wrapped).digest("hex").slice(0, 10);
  const filePath = join(artifactDir, `showai-preview-${digest}.html`);
  await atomicWrite(filePath, wrapped);

  const args = payload.toolCall?.args && typeof payload.toolCall.args === "object"
    ? payload.toolCall.args
    : {};
  const projectId = meta.projectId || (typeof args.projectId === "string" ? args.projectId : undefined);
  const pageId = meta.pageId || (typeof args.pageId === "string" ? args.pageId : undefined);
  const blockIds = meta.blockIds || (Array.isArray(args.blockIds) ? args.blockIds.filter((x) => typeof x === "string") : undefined);
  const sidecarUrl = buildSidecarUrl({ projectId, pageId, blockIds });

  await atomicWrite(
    join(artifactDir, PENDING_FILE),
    JSON.stringify(
      {
        filePath,
        fileUrl: pathToFileURL(filePath).href,
        tool,
        title: meta.title,
        projectId,
        pageId,
        openUrl: meta.openUrl,
        htmlPath: meta.htmlPath,
        sidecarUrl,
        stagedAt: Date.now(),
      },
      null,
      2,
    ) + "\n",
  );
  return {};
}

async function handlePreInvocation(payload) {
  const artifactDir = payload.artifactDirectoryPath;
  if (typeof artifactDir !== "string" || !isAbsolute(artifactDir)) return {};
  const pendingPath = join(artifactDir, PENDING_FILE);
  let raw;
  try {
    raw = await readFile(pendingPath, "utf8");
  } catch {
    return {};
  }
  await rm(pendingPath, { force: true }).catch(() => {});
  let staged;
  try {
    staged = JSON.parse(raw);
  } catch {
    return {};
  }
  if (
    !staged?.fileUrl ||
    typeof staged.stagedAt !== "number" ||
    Date.now() - staged.stagedAt > MAX_PENDING_AGE_MS
  ) {
    return {};
  }

  const lines = [
    `ShowAI preview from \`${staged.tool}\` has been automatically wrapped with Antigravity theme sync and staged in the Artifact directory at \`${staged.filePath}\`. Do NOT run \`cp\` or \`write_file\`.`,
    `- Embed inline (best for compact visuals <= 450px tall) on its own line:\n<agent-embed src="${staged.fileUrl}"></agent-embed>`,
  ];
  if (staged.sidecarUrl) {
    const label = staged.title
      ? `在 ShowAI 工作台打开《${staged.title}》`
      : "在 ShowAI 工作台打开此页";
    lines.push(
      `- Open or edit the full page live in the side pane:\n[${label}](${staged.sidecarUrl})`,
    );
  }
  if (staged.openUrl) lines.push(`- ShowAI App link: ${staged.openUrl}`);
  if (staged.htmlPath) lines.push(`- Standalone offline HTML: \`${staged.htmlPath}\``);

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: lines.join("\n"),
        },
      },
    ],
  };
}

export async function handleHookEvent(payload, env = process.env) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.hookEventName === "PostToolUse") {
    return handlePostToolUse(payload, env);
  }
  if (payload.hookEventName === "PreInvocation") {
    return handlePreInvocation(payload);
  }
  return {};
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const raw = await readStdin();
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const output = await handleHookEvent(payload, process.env);
    process.stdout.write(JSON.stringify(output) + "\n");
  } catch {
    process.stdout.write("{}\n");
  }
}
