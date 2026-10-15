import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { dirname, resolve, join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { offlineDiagramFonts } from "./diagram-authoring-fonts.js";

function safeRelative(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    isAbsolute(path) ||
    path.split("/").some((part) => ["", ".", ".."].includes(part))
  )
    throw new Error(`Invalid authoring file path: ${path}`);
  return path;
}
async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
async function execute(command, args, input, cwd) {
  const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.stdin.end(input);
  const code = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  if (code !== 0)
    throw new Error(
      `Original renderer exited with ${code}.\n${stdout}\n${stderr}`,
    );
  return { stdout, stderr };
}
export async function generateDiagram(options) {
  const kit = JSON.parse(await readFile(options.kit, "utf8"));
  if (
    kit.format !== "showai-diagram-authoring" ||
    kit.version !== 1 ||
    !["archify", "diagram-design", "fireworks-tech-graph"].includes(kit.family)
  )
    throw new Error("Unsupported diagram authoring kit.");
  const work = resolve(options.workDir),
    input = await realpath(options.input),
    out = resolve(options.out);
  if (input === out)
    throw new Error("Input and output must use different files.");
  if (!options.overwrite && !(await absent(out)))
    throw new Error(`Output already exists: ${out}`);
  if (!(await absent(work)))
    throw new Error(
      "Choose a new authoring work directory; existing files are preserved.",
    );
  safeRelative(kit.root);
  for (const [name, file] of Object.entries(kit.files)) {
    const path = join(work, safeRelative(name));
    if (relative(work, path).startsWith(".."))
      throw new Error("Authoring file escapes its work directory.");
    if (
      typeof file.text !== "string" ||
      createHash("sha256").update(file.text).digest("hex") !== file.sha256
    )
      throw new Error(`Authoring file hash does not match: ${name}`);
  }
  await mkdir(work, { recursive: true });
  for (const [name, file] of Object.entries(kit.files)) {
    const path = join(work, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.text, { flag: "wx" });
  }
  await mkdir(dirname(out), { recursive: true });
  const original = await readFile(input, "utf8");
  const root = join(work, safeRelative(kit.root));
  let execution = { stdout: "", stderr: "" };
  if (kit.family === "archify") {
    if (
      ![
        "architecture",
        "workflow",
        "sequence",
        "dataflow",
        "lifecycle",
        "erd",
        "class",
        "tree",
        "timeline",
        "waterfall",
      ].includes(options.type)
    )
      throw new Error("Choose an Archify diagram type.");
    execution = await execute(
      process.execPath,
      [
        join(root, "renderers", options.type, `render-${options.type}.mjs`),
        input,
        out,
      ],
      "",
      options.cwd ?? process.cwd(),
    );
  } else if (
    kit.family === "fireworks-tech-graph" &&
    options.type !== "authored"
  ) {
    if (!/^[a-z][a-z-]{0,40}$/.test(options.type))
      throw new Error("Choose a supported Fireworks mode.");
    execution = await execute(
      options.python ?? process.env.SHOWAI_DIAGRAM_PYTHON ?? "python3",
      [
        join(root, "scripts/generate-from-template.py"),
        options.type,
        out,
        "--layout-report",
        `${out}.layout.json`,
      ],
      original,
      options.cwd ?? process.cwd(),
    );
  } else {
    if (!/<svg\b/i.test(original))
      throw new Error(
        "Diagram Design and Fireworks style 8 require authored SVG or HTML following their original guides.",
      );
    await writeFile(out, original, { flag: options.overwrite ? "w" : "wx" });
  }
  const rawSource = await readFile(out, "utf8");
  if (!/<svg\b/i.test(rawSource))
    throw new Error("The original renderer did not produce SVG.");
  let source = rawSource,
    fonts = [];
  if (options.embedFonts) {
    const manifestPath =
      options.fontLicenses ??
      join(dirname(resolve(options.kit)), "font-licenses.json");
    const offline = await offlineDiagramFonts(
      source,
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    source = offline.source;
    fonts = offline.fonts;
    if (source !== rawSource) await writeFile(out, source);
  }
  if (Buffer.byteLength(source) > 8 * 1024 * 1024)
    throw new Error(
      "Generated source exceeds the component's 8 MiB input budget; preserve the output and reduce embedded resources.",
    );
  return {
    format: "showai-diagram-result",
    version: 1,
    family: kit.family,
    repository: kit.repository,
    commit: kit.commit,
    type: options.type,
    path: out,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    originalSourceSha256: createHash("sha256").update(rawSource).digest("hex"),
    fonts,
    data: {
      template: "custom",
      source,
      height: 560,
      presentation: {
        title: "outside",
        description: "outside",
        notes: "hidden",
        legend: true,
        controls: true,
      },
    },
    input:
      kit.family === "archify" ||
      (kit.family === "fireworks-tech-graph" && options.type !== "authored")
        ? JSON.parse(original)
        : undefined,
    execution,
  };
}
async function main() {
  const { values } = parseArgs({
    options: {
      kit: { type: "string" },
      input: { type: "string" },
      out: { type: "string" },
      type: { type: "string" },
      "work-dir": { type: "string" },
      python: { type: "string" },
      result: { type: "string" },
      overwrite: { type: "boolean" },
      "embed-fonts": { type: "boolean" },
    },
  });
  for (const field of ["kit", "input", "out", "type", "work-dir"])
    if (!values[field]) throw new Error(`Missing --${field}.`);
  const result = await generateDiagram({
    ...values,
    workDir: values["work-dir"],
    embedFonts: values["embed-fonts"],
  });
  if (values.result) {
    await mkdir(dirname(resolve(values.result)), { recursive: true });
    await writeFile(values.result, JSON.stringify(result, null, 2) + "\n", {
      flag: values.overwrite ? "w" : "wx",
    });
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      family: result.family,
      commit: result.commit,
      path: result.path,
      result: values.result,
      originalSourceSha256: result.originalSourceSha256,
      sourceSha256: result.sourceSha256,
    }) + "\n",
  );
}
// Node reports the module by its real path, so compare against the real
// path of the invoked script (macOS temp and home folders are symlinked).
if (
  process.argv[1] &&
  pathToFileURL(await realpath(resolve(process.argv[1]))).href ===
    import.meta.url
)
  await main();
