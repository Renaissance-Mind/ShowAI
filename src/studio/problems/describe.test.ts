import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorResult } from "../../agent/service";
import { CoreError } from "../../core/model";
import { CapacityError } from "../../portable/capacity.mjs";
import { setLocale } from "../../i18n";
import {
  actionLabel,
  configureProblemPlatform,
  describeError,
  problemCode,
  problemFacts,
} from "./describe";
import { arrangeProblemActions } from "./ProblemNotice";

describe("describeError", () => {
  beforeEach(() => setLocale("zh-CN"));
  afterEach(() => setLocale("zh-CN"));

  it("titles the failed operation and keeps the original text in details only", () => {
    const error = errorResult(
      new CoreError("LOCKED", "Another library operation is still running."),
    );
    const problem = describeError(error, { action: "导出网站" });
    expect(problem.title).toBe("导出网站失败");
    expect(problem.cause).toBe("内容库正在进行另一项操作，完成后再试。");
    expect(problem.actions).toEqual(["retry"]);
    expect(problem.code).toBe("LOCKED");
    expect(problem.title + problem.cause).not.toContain("Another library");
    expect(problem.details).toContain(
      "原文: Another library operation is still running.",
    );
    expect(problem.details).toContain("操作: 导出网站");
  });

  it("names the object when given", () => {
    const problem = describeError(new CoreError("NOT_FOUND", "File not found"), {
      action: "打开",
      object: "周报",
    });
    expect(problem.title).toBe("「周报」打开失败");
    setLocale("en");
    expect(
      describeError(new CoreError("NOT_FOUND", "x"), {
        action: "Open",
        object: "Weekly",
      }).title,
    ).toBe("Open failed: “Weekly”");
  });

  it("explains real file-system errors that crossed IPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "showai-describe-"));
    try {
      const locked = join(directory, "locked");
      await writeFile(locked, "x");
      await chmod(directory, 0o500);
      const failure = await writeFile(join(directory, "new.json"), "{}").then(
        () => undefined,
        (error: unknown) => error,
      );
      await chmod(directory, 0o700);
      // Root can write anywhere; the errno mapping is still covered below.
      if (failure) {
        const wire = JSON.parse(JSON.stringify(errorResult(failure)));
        expect(wire).toMatchObject({ code: "ERROR", errno: "EACCES" });
        expect(wire.path).toBe(join(directory, "new.json"));
        const problem = describeError(wire, { action: "导出网站" });
        expect(problem.code).toBe("EACCES");
        expect(problem.cause).toBe("ShowAI 没有读写这个位置的权限。");
        expect(problem.actions).toEqual(["reveal", "chooseLocation"]);
        expect(problem.details).toContain(`路径: ${join(directory, "new.json")}`);
      }
      const missing = await writeFile(
        join(directory, "absent", "x.json"),
        "{}",
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      const wire = JSON.parse(JSON.stringify(errorResult(missing)));
      expect(wire.errno).toBe("ENOENT");
      expect(describeError(wire, { action: "移动" }).cause).toBe(
        "要处理的文件、页面或项目已不存在，可能已被移动或删除。",
      );
    } finally {
      await chmod(directory, 0o700);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps disk-full and read-only errors without a path", () => {
    const full = describeError(
      { code: "ERROR", errno: "ENOSPC", message: "ENOSPC: no space left on device" },
      { action: "导出页面", safety: "windowOnly" },
    );
    expect(full.cause).toBe("磁盘空间不足。释放空间后再试。");
    expect(full.actions).toEqual(["librarySpace", "retry"]);
    expect(full.safety).toBe("windowOnly");
    const readOnly = describeError({ code: "EROFS", message: "EROFS" }, {
      action: "导出页面",
    });
    expect(readOnly.code).toBe("EROFS");
    expect(readOnly.actions).toEqual(["chooseLocation"]);
  });

  it("reports capacity limits in readable sizes", () => {
    const problem = describeError(
      errorResult(new CapacityError("Exported HTML", 3 * 1024 * 1024, 2 * 1024 * 1024)),
      { action: "导出页面" },
    );
    expect(problem.code).toBe("CAPACITY_EXCEEDED");
    expect(problem.cause).toBe("内容超过了大小上限（3.0 MB，上限 2.0 MB）。");
    expect(problem.details).toContain("Exported HTML");
  });

  it("recognises a lost local service and HTTP statuses", () => {
    const network = describeError(new TypeError("Failed to fetch"), {
      action: "导出网站",
    });
    expect(network.code).toBe("NETWORK");
    expect(network.cause).toContain("无法连接本机 ShowAI 服务");
    const unauthorized = describeError(
      Object.assign(new Error("请求失败（401）"), { code: "HTTP_ERROR", status: 401 }),
      { action: "导出网站" },
    );
    expect(unauthorized.code).toBe("HTTP_401");
    expect(unauthorized.actions).toEqual(["reload"]);
    const server = describeError({ code: "ERROR", message: "boom", status: 500 }, {
      action: "导出网站",
    });
    expect(server.cause).toBe("ShowAI 服务内部出错（500）。");
  });

  it("uses the cause as the title when no operation is known", () => {
    expect(
      describeError({ code: "ERROR", errno: "ENOSPC", message: "x" }).title,
    ).toBe("磁盘空间不足。释放空间后再试。");
    const unknown = describeError(new Error("Invalid project metadata"));
    expect(unknown.title).toBe("操作没有完成");
    expect(unknown.cause).toBeUndefined();
    expect(unknown.code).toBe("ERROR");
  });

  it("reads plain strings and wrapped causes", () => {
    expect(problemFacts("oops").message).toBe("oops");
    const wrapped = new Error("Could not save", {
      cause: Object.assign(new Error("EACCES"), { code: "EACCES", path: "/x" }),
    });
    expect(problemFacts(wrapped)).toMatchObject({ errno: "EACCES", path: "/x" });
    expect(errorResult(wrapped)).toMatchObject({ errno: "EACCES", path: "/x" });
    expect(problemCode({ message: "", code: "HTTP_ERROR", status: 404 })).toBe(
      "HTTP_404",
    );
  });
});

describe("arrangeProblemActions", () => {
  const noop = () => {};
  it("keeps one primary, two secondary and the destructive action last", () => {
    const arranged = arrangeProblemActions([
      { label: "discard", onSelect: noop, destructive: true },
      { label: "a", onSelect: noop },
      { label: "b", onSelect: noop, primary: true },
      { label: "c", onSelect: noop },
    ]);
    expect(arranged.map((item) => item.label)).toEqual(["b", "a", "discard"]);
    expect(arranged.map((item) => !!item.primary)).toEqual([true, false, false]);
  });
});

describe("reveal label", () => {
  afterEach(() => {
    configureProblemPlatform(undefined);
    setLocale("zh-CN");
  });

  it("names the file manager of the platform holding the files", () => {
    setLocale("zh-CN");
    expect(actionLabel("reveal")).toBe("显示所在位置");
    configureProblemPlatform("darwin");
    expect(actionLabel("reveal")).toBe("在访达中显示");
    configureProblemPlatform("win32");
    expect(actionLabel("reveal")).toBe("在资源管理器中显示");
    configureProblemPlatform("linux");
    expect(actionLabel("reveal")).toBe("在文件管理器中显示");
    setLocale("en");
    expect(actionLabel("reveal")).toBe("Show in file manager");
    expect(actionLabel("retry")).toBe("Try again");
  });
});
