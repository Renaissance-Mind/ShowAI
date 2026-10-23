import {
  SUPPORT_REPORT_URL,
  SUPPORT_URL_LIMIT,
} from "../../core/support-channels";

export type ReportKind = "problem" | "suggestion" | "docs";

/** Option labels of the `edition` dropdown in .github/ISSUE_TEMPLATE/bug_report.yml. */
export const ISSUE_EDITIONS = {
  // i18n-exempt: must equal the bilingual dropdown option in the issue template
  desktop: "Desktop app / 桌面 App",
  // i18n-exempt: must equal the bilingual dropdown option in the issue template
  browser: "Local browser workbench / 本地浏览器版",
} as const;

export interface IssueDraft {
  kind: ReportKind;
  summary: string;
  steps: string;
  /** e.g. 「来自：保存失败 · ENOSPC · 14:02」, already redacted. */
  context?: string;
  version: string;
  platform: string;
  mode?: "desktop" | "browser";
  /** Shown in the logs field, e.g. where the copied diagnostics go. */
  logs?: string;
}

const TITLE_LIMIT = 80;
const TRUNCATED = "\n…";

function title(draft: IssueDraft) {
  const line =
    draft.summary
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean) ?? "";
  const text =
    line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line;
  return draft.kind === "docs" ? `[Docs] ${text}` : text;
}

/**
 * A prefilled GitHub issue form. Field ids match the issue templates; long
 * text is shortened so the link stays under the URL limit, and the person
 * pastes the full diagnostics from the clipboard instead.
 */
export function issueUrl(draft: IssueDraft, limit = SUPPORT_URL_LIMIT): string {
  const summary = [draft.summary.trim(), draft.context?.trim()]
    .filter(Boolean)
    .join("\n\n");
  const fields: [string, string][] =
    draft.kind === "suggestion"
      ? [
          ["template", "feature_request.yml"],
          ["title", title(draft)],
          ["problem", summary],
          [
            "context",
            [draft.steps.trim(), `ShowAI ${draft.version} · ${draft.platform}`]
              .filter(Boolean)
              .join("\n\n"),
          ],
        ]
      : [
          ["template", "bug_report.yml"],
          ["title", title(draft)],
          ["summary", summary],
          ["steps", draft.steps.trim()],
          ...(draft.mode
            ? ([["edition", ISSUE_EDITIONS[draft.mode]]] as [string, string][])
            : []),
          ["version", draft.version],
          ["platform", draft.platform],
          ["logs", draft.logs?.trim() ?? ""],
        ];
  const build = () => {
    const query = new URLSearchParams(
      fields.filter(([, value]) => value) as [string, string][],
    );
    return `${SUPPORT_REPORT_URL}?${query}`;
  };
  // Shorten the longest free-text field until the link fits.
  const shortenable = new Set(["summary", "steps", "logs", "problem", "context"]);
  let url = build();
  while (url.length > limit) {
    const longest = fields
      .filter(([name]) => shortenable.has(name))
      .sort((a, b) => b[1].length - a[1].length)[0];
    if (!longest || longest[1].length <= TRUNCATED.length) break;
    const overflow = url.length - limit;
    // Encoded characters take up to 9 bytes each; trim generously.
    const keep = Math.max(
      0,
      longest[1].length - Math.ceil(overflow / 3) - TRUNCATED.length - 1,
    );
    longest[1] = `${longest[1].slice(0, keep).trimEnd()}${TRUNCATED}`;
    url = build();
  }
  return url;
}

/** The whole report as plain text, for 复制全文 and any other channel. */
export function reportText(
  draft: IssueDraft,
  labels: {
    kind: string;
    summary: string;
    steps: string;
    version: string;
    platform: string;
  },
  diagnostics?: string,
): string {
  return [
    `${labels.kind}`,
    "",
    `## ${labels.summary}`,
    draft.summary.trim(),
    ...(draft.context ? ["", draft.context] : []),
    ...(draft.steps.trim() ? ["", `## ${labels.steps}`, draft.steps.trim()] : []),
    "",
    `${labels.version}: ${draft.version}`,
    `${labels.platform}: ${draft.platform}`,
    ...(diagnostics ? ["", "```", diagnostics, "```"] : []),
  ].join("\n");
}
