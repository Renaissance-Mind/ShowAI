import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { supportChannels } from "../../core/support-channels";
import type { DesktopInfo } from "../../desktop/bridge";
import {
  clearProblemLog,
  recentProblems,
  recordProblem,
} from "../problems/problem-log";
import { formatDiagnostics, platformLine, versionLine } from "./diagnostics";
import { ISSUE_EDITIONS, issueUrl, reportText } from "./issue-url";

const info: DesktopInfo = {
  home: "/Users/ada/.showai",
  version: "0.10.0",
  platform: "darwin",
  packaged: true,
  mode: "desktop",
  libraryVersion: 2,
  sourceCommit: "6d8d3b9c0ffee1234567890abcdef1234567890",
  arch: "arm64",
  osVersion: "26.4",
  versions: { node: "22.1.0", electron: "38.0.0", chrome: "140.0" },
  cli: { command: "/Applications/ShowAI.app", args: [], env: {} },
};

const templates = resolve(import.meta.dirname, "../../../.github/ISSUE_TEMPLATE");

afterEach(() => clearProblemLog());

describe("issue links", () => {
  const template = readFileSync(resolve(templates, "bug_report.yml"), "utf8");

  it("prefill the bug report template's own field ids", () => {
    const url = new URL(
      issueUrl({
        kind: "problem",
        summary: "Saving fails\nwith ENOSPC",
        steps: "1. Save",
        context: "From: Saving · ENOSPC · 14:02",
        version: versionLine(info),
        platform: platformLine(info),
        mode: "desktop",
        logs: "paste here",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://github.com/Renaissance-Mind/ShowAI/issues/new",
    );
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("title")).toBe("Saving fails");
    expect(url.searchParams.get("version")).toBe("0.10.0 (6d8d3b9)");
    expect(url.searchParams.get("platform")).toBe("macOS 26.4 arm64");
    for (const [field] of url.searchParams)
      if (field !== "template" && field !== "title")
        expect(template).toContain(`id: ${field}\n`);
    for (const option of Object.values(ISSUE_EDITIONS))
      expect(template).toContain(`- ${option}\n`);
    expect(url.searchParams.get("edition")).toBe(ISSUE_EDITIONS.desktop);
    expect(url.searchParams.get("summary")).toContain("ENOSPC · 14:02");
  });

  it("stay under the URL limit by shortening the longest text", () => {
    const url = issueUrl({
      kind: "problem",
      summary: "测试".repeat(4000),
      steps: "x".repeat(3000),
      version: "0.10.0",
      platform: "Linux",
    });
    expect(url.length).toBeLessThanOrEqual(6000);
    expect(new URL(url).searchParams.get("summary")).toMatch(/…$/);
  });

  it("send suggestions to the feature template", () => {
    const url = new URL(
      issueUrl({
        kind: "suggestion",
        summary: "Add a timeline",
        steps: "",
        version: "0.10.0",
        platform: "Linux",
      }),
    );
    expect(url.searchParams.get("template")).toBe("feature_request.yml");
    expect(url.searchParams.get("problem")).toBe("Add a timeline");
    const feature = readFileSync(resolve(templates, "feature_request.yml"), "utf8");
    expect(feature).toContain("id: problem\n");
    expect(feature).toContain("id: context\n");
  });

  it("copy the whole report as text", () => {
    const text = reportText(
      {
        kind: "docs",
        summary: "Typo",
        steps: "",
        version: "0.10.0",
        platform: "Linux",
      },
      {
        kind: "Type: Documentation",
        summary: "What happened",
        steps: "Steps",
        version: "Version",
        platform: "Platform",
      },
      "ShowAI diagnostics",
    );
    expect(text).toContain("## What happened\nTypo");
    expect(text).not.toContain("## Steps");
    expect(text).toContain("```\nShowAI diagnostics\n```");
  });
});

describe("diagnostics", () => {
  it("keeps the latest 20 problems, redacted", () => {
    for (let index = 0; index < 25; index++)
      recordProblem({
        at: `2026-10-23T10:00:${String(index).padStart(2, "0")}Z`,
        source: "save",
        code: "ENOSPC",
        message:
          "open /Users/ada/notes token=supersecret1 page 8f2c1d3e-1111-4222-8333-944445555666",
      });
    const problems = recentProblems();
    expect(problems).toHaveLength(20);
    expect(problems[0].at).toBe("2026-10-23T10:00:05Z");
    expect(problems[19].message).toBe(
      "open ~/notes token=[redacted] page 8f2c1d3e",
    );
  });

  it("describes the environment without paths, accounts or tokens", () => {
    const text = formatDiagnostics({
      generatedAt: "2026-10-23T12:00:00Z",
      info,
      locale: "zh-CN",
      systemLanguage: "zh-CN",
      plugins: {
        ok: true,
        value: [
          {
            host: "codex",
            executable: "/opt/homebrew/bin/codex",
            installed: true,
            enabled: true,
            version: "0.21.2",
            current: true,
            otherSources: [],
            boundHome: "/Users/ada/.showai",
          },
          {
            host: "claude",
            executable: null,
            installed: false,
            enabled: false,
            otherSources: [],
          },
        ],
      },
      connections: {
        ok: true,
        value: [
          {
            client: "codex-mcp-client",
            firstConnectedAt: "2026-10-22T09:00:00Z",
            lastConnectedAt: "2026-10-22T09:00:00Z",
            lastFailure: {
              code: "RUNTIME_MISSING",
              message: "x",
              pluginVersion: "0.21.2",
              at: "2026-10-23T09:00:00Z",
            },
          },
        ],
      },
      runtime: { ok: false, error: "EACCES" },
      sync: {
        ok: true,
        value: {
          version: 1,
          deviceId: "d",
          defaultConnectionId: "c1",
          connections: [
            {
              id: "c1",
              serverId: "s",
              name: "Ada's server",
              url: "https://sync.example.com/cloud",
              user: { id: "u", name: "Ada", email: "ada@example.com" } as never,
            },
          ],
          projects: [
            {
              projectId: "p",
              connectionId: "c1",
              remoteProjectId: "r",
              role: "admin",
              remoteHead: null,
              localRevision: null,
              status: "synced",
            },
          ],
        },
      },
      problems: [
        {
          at: "2026-10-23T11:00:00Z",
          source: "save",
          code: "ENOSPC",
          message: "write <library>/projects/a.json",
        },
      ],
      log: {
        ok: true,
        value: "2026 [error] [main] open /Users/ada/.showai/x Bearer abcdefghijkl",
      },
    });
    expect(text).toContain("Version: 0.10.0 (6d8d3b9)");
    expect(text).toContain("Platform: macOS 26.4 arm64");
    expect(text).toContain(
      "Runtime: Electron 38.0.0 · Chrome 140.0 · Node 22.1.0",
    );
    expect(text).toContain("Library format: v2");
    expect(text).toContain(
      "Codex: plugin 0.21.2, enabled, current; last connection failed RUNTIME_MISSING",
    );
    expect(text).toContain("Claude Code: host not found");
    expect(text).toContain("Runtime registration:\n  unavailable (EACCES)");
    expect(text).toContain("sync.example.com: signed in (default)");
    expect(text).toContain("Projects: 1 synced");
    expect(text).toContain("2026-10-23T11:00:00Z  save  ENOSPC");
    expect(text).toContain("open <library>/x Bearer [redacted]");
    expect(text).not.toMatch(/\/Users\/ada|ada@example|Ada's|abcdefghijkl/);
    expect(text).not.toContain("Library path");
    expect(
      formatDiagnostics({
        generatedAt: "x",
        info,
        locale: "en",
        problems: [],
        includeLibraryPath: true,
      }),
    ).toContain("Library path: ~/.showai");
  });
});

describe("support channels", () => {
  it("show nothing until configured", () => {
    expect(supportChannels({})).toEqual({});
    expect(
      supportChannels({
        VITE_SHOWAI_SUPPORT_EMAIL: "help@example.com",
        VITE_SHOWAI_COMMUNITY_URL: "https://example.com/group",
      }),
    ).toEqual({
      email: "help@example.com",
      community: {
        label: "https://example.com/group",
        url: "https://example.com/group",
      },
    });
    expect(
      supportChannels({ VITE_SHOWAI_COMMUNITY_URL: "javascript:x" }),
    ).toEqual({});
  });
});
