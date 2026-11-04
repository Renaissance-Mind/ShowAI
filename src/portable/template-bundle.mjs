/** Portable template contract: Markdown instructions and editable component files. */
// A template supplements the presentation workflow in the show-document Skill
// with methods for one kind of content. Its guides are read whole, once per
// task; schemaVersion 4 lists them without stages.
export const TEMPLATE_SCHEMA_VERSION = 4;
/** schemaVersion 3 bundles declared four stage guides; they remain readable. */
export const STAGED_TEMPLATE_STAGES = Object.freeze([
  "intent",
  "material",
  "logic",
  "design",
]);
/** schemaVersion 1–2 bundles declared six stages; they remain readable. */
export const LEGACY_TEMPLATE_STAGES = Object.freeze([
  "intent",
  "evidence",
  "understanding",
  "design",
  "authoring",
  "review",
]);
// Legacy authoring and review guides predate the shared authoring rules and
// are not disclosed.
const LEGACY_DISCLOSED_STAGES = Object.freeze([
  "intent",
  "evidence",
  "understanding",
  "design",
]);
export const SYSTEM_TEMPLATE_ID = "system-presentation";
export const TEMPLATE_WORKFLOW_CAPABILITIES = Object.freeze({
  protocol: "showai-template-workflow-v3",
  bundleFormat: 1,
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  legacySchemaVersions: [1, 2, 3],
  systemBaselineRequired: true,
  systemBaseline: "show-document Skill; guide topic presentation without Skills",
  guideDisclosure: "whole-template",
  contextBinding: "explicit-exact-refs",
  directoryImport: "local-cli",
  portableBundleInput: "template_save",
  compactResponses: ["source", "receipt"],
});
const encoder = new TextEncoder();
const idPattern = /^[a-z][a-z0-9-]{0,79}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value;
};
const keys = (value, allowed, label) => {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`Unknown ${label} field: ${key}.`);
};
const text = (value, label, maximum = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error(`${label} must contain 1–${maximum} characters.`);
  return value;
};
export function templateFilePath(value) {
  text(value, "Template file path", 240);
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[a-zA-Z0-9_.\-/]+$/.test(value)
  )
    throw new Error(`Invalid relative template path: ${value}.`);
  if (
    value
      .split("/")
      .some(
        (part) =>
          part.endsWith(".") ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error(
      `Template path is not portable across platforms: ${value}.`,
    );
  if (
    value
      .split("/")
      .some((part) => ["__proto__", "prototype", "constructor"].includes(part))
  )
    throw new Error("Unsafe template path key.");
  return value;
}
/** Declared guide paths in reading order; staged and legacy bundles keep their stage order. */
export function declaredGuidePaths(metadata) {
  if (metadata.schemaVersion === TEMPLATE_SCHEMA_VERSION)
    return [...metadata.guides];
  const stages =
    metadata.schemaVersion === 3
      ? STAGED_TEMPLATE_STAGES
      : LEGACY_DISCLOSED_STAGES;
  return stages.map((stage) => metadata.guides[stage]).filter(Boolean);
}
export function parseTemplateReadme(source) {
  text(source, "README", 16000);
  const normalized = source.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(normalized);
  if (!match)
    throw new Error(
      "README.md needs JSON frontmatter between --- lines and a Markdown body.",
    );
  const metadata = object(JSON.parse(match[1]), "Template metadata");
  keys(
    metadata,
    [
      "format",
      "schemaVersion",
      "id",
      "name",
      "version",
      "description",
      "scenarios",
      "guides",
      "components",
      "page",
    ],
    "template metadata",
  );
  if (
    metadata.format !== "showai-template" ||
    ![1, 2, 3, TEMPLATE_SCHEMA_VERSION].includes(metadata.schemaVersion)
  )
    throw new Error("Unsupported template README format/schemaVersion.");
  if (!idPattern.test(metadata.id)) throw new Error("Invalid template id.");
  if (!versionPattern.test(metadata.version))
    throw new Error("Template version must be exact semver.");
  text(metadata.name, "Template name", 100);
  text(metadata.description, "Template description", 1000);
  if (
    !Array.isArray(metadata.scenarios) ||
    !metadata.scenarios.length ||
    metadata.scenarios.length > 20
  )
    throw new Error("Template scenarios must contain 1–20 entries.");
  metadata.scenarios.forEach((value) => text(value, "Template scenario", 500));
  if (metadata.schemaVersion === TEMPLATE_SCHEMA_VERSION) {
    if (!Array.isArray(metadata.guides) || metadata.guides.length > 20)
      throw new Error(
        "Template guides must be an array of at most 20 Markdown paths under guides/.",
      );
    const seenGuides = new Set();
    for (const path of metadata.guides) {
      if (
        typeof path !== "string" ||
        !templateFilePath(path).startsWith("guides/") ||
        !path.endsWith(".md") ||
        seenGuides.has(path.toLowerCase())
      )
        throw new Error(
          "Each template guide must be a distinct Markdown file under guides/.",
        );
      seenGuides.add(path.toLowerCase());
    }
  } else {
    const stages =
      metadata.schemaVersion === 3
        ? STAGED_TEMPLATE_STAGES
        : LEGACY_TEMPLATE_STAGES;
    const guides = object(metadata.guides, "Stage guides");
    keys(guides, stages, "stage guide");
    for (const stage of stages) {
      if (!Object.hasOwn(guides, stage))
        throw new Error(
          `Missing stage declaration: ${stage}. Use null when the template adds nothing.`,
        );
      if (
        guides[stage] !== null &&
        !templateFilePath(guides[stage]).startsWith("guides/")
      )
        throw new Error(
          `Stage ${stage} must reference guides/ Markdown, a guide folder, or null.`,
        );
    }
  }
  if (!Array.isArray(metadata.components) || metadata.components.length > 30)
    throw new Error(
      "Template components must be an array with at most 30 entries.",
    );
  const seen = new Set();
  const componentRoots = [];
  for (const component of metadata.components) {
    object(component, "Template component");
    keys(component, ["id", "path"], "template component");
    if (!idPattern.test(component.id) || seen.has(component.id))
      throw new Error("Template component IDs must be unique valid IDs.");
    seen.add(component.id);
    if (!templateFilePath(component.path).startsWith("components/"))
      throw new Error("Template components must live under components/.");
    const componentRoot = component.path.toLowerCase();
    if (
      componentRoots.some(
        (path) =>
          path === componentRoot ||
          path.startsWith(componentRoot + "/") ||
          componentRoot.startsWith(path + "/"),
      )
    )
      throw new Error(
        "Template component folders must be distinct and cannot contain each other.",
      );
    componentRoots.push(componentRoot);
  }
  if (metadata.schemaVersion !== 1 && Object.hasOwn(metadata, "page"))
    throw new Error(
      "Templates guide logic and design for each instance; page skeletons exist only in legacy schemaVersion 1.",
    );
  if (
    metadata.schemaVersion === 1 &&
    metadata.page !== null &&
    (!templateFilePath(metadata.page).endsWith(".json") ||
      metadata.page.startsWith("components/"))
  )
    throw new Error("Template page must be a relative JSON file or null.");
  text(match[2], "README body", 12000);
  if (encoder.encode(match[2]).byteLength > 4096)
    throw new Error(
      "README body exceeds 4 KiB; move method details into guides/.",
    );
  return { metadata, body: match[2].trim() };
}
export function parseTemplateBundle(input) {
  object(input, "Template bundle");
  keys(input, ["format", "files", "assets"], "template bundle");
  if (input.format !== 1)
    throw new Error("Unsupported template bundle format.");
  const files = object(input.files, "Template files");
  const assets =
    input.assets === undefined ? {} : object(input.assets, "Template assets");
  const names = [...Object.keys(files), ...Object.keys(assets)];
  if (names.length > 200 || new Set(names).size !== names.length)
    throw new Error(
      "Template file limit exceeded or duplicate text/asset path.",
    );
  const folded = names.map((name) => name.toLowerCase());
  if (folded.some((name) => ["guides", "components"].includes(name)))
    throw new Error("guides and components are reserved template directories.");
  if (
    new Set(folded).size !== folded.length ||
    folded.some((name) =>
      folded.some((other) => other !== name && other.startsWith(name + "/")),
    )
  )
    throw new Error(
      "Template paths conflict on case-insensitive filesystems or between files and directories.",
    );
  let bytes = 0;
  for (const [name, value] of Object.entries(files)) {
    templateFilePath(name);
    if (typeof value !== "string")
      throw new Error(`Template file ${name} must be text.`);
    bytes += encoder.encode(value).byteLength;
  }
  for (const [name, value] of Object.entries(assets)) {
    templateFilePath(name);
    if (
      !name.startsWith("components/") ||
      typeof value !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    )
      throw new Error(`Invalid base64 component asset: ${name}.`);
    bytes += value.length;
  }
  if (bytes > 16 * 1024 * 1024)
    throw new Error("Template bundle exceeds 16 MiB.");
  const read = (name) => {
    if (!Object.hasOwn(files, name))
      throw new Error(`Missing template file: ${name}.`);
    return files[name];
  };
  const { metadata, body } = parseTemplateReadme(read("README.md"));
  // A staged guide folder contributes its README first, then its other Markdown files.
  const guides = [];
  for (const declared of declaredGuidePaths(metadata)) {
    const paths = declared.endsWith(".md")
      ? [declared]
      : [
          declared + "/README.md",
          ...Object.keys(files)
            .filter(
              (name) =>
                name.startsWith(declared + "/") &&
                name.endsWith(".md") &&
                name !== declared + "/README.md",
            )
            .sort(),
        ];
    for (const path of paths) {
      const markdown = read(path);
      text(markdown, `Guide ${path}`, 32000);
      if (encoder.encode(markdown).byteLength > 32768)
        throw new Error(`Guide ${path} exceeds 32 KiB; split it into files.`);
      guides.push({ path, markdown });
    }
  }
  if (
    encoder.encode(guides.map(({ markdown }) => markdown).join("\n"))
      .byteLength > 48 * 1024
  )
    throw new Error(
      "Template guides exceed 48 KiB in total; an Agent reads them whole, so keep only the methods this kind of content needs.",
    );
  const components = metadata.components.map(({ id, path }) => {
    const prefix = path + "/";
    const manifest = object(
      JSON.parse(read(prefix + "manifest.json")),
      "Component manifest",
    );
    if (!manifest.documentation)
      throw new Error(
        `Template component ${id} needs versioned usage/development documentation.`,
      );
    if (manifest.id !== id)
      throw new Error(`Component ${path} manifest.id must equal ${id}.`);
    const entry = templateFilePath(manifest.entry);
    const source = read(prefix + entry);
    const componentFiles = Object.fromEntries(
      Object.entries(files)
        .filter(
          ([name]) =>
            name.startsWith(prefix) &&
            ![
              prefix + "manifest.json",
              prefix + "props.schema.json",
              prefix + entry,
            ].includes(name),
        )
        .map(([name, value]) => [name.slice(prefix.length), value]),
    );
    const componentAssets = Object.fromEntries(
      Object.entries(assets)
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, value]) => [name.slice(prefix.length), value]),
    );
    return {
      id,
      path,
      source: {
        manifest,
        schema: JSON.parse(read(prefix + "props.schema.json")),
        source,
        files: componentFiles,
        ...(Object.keys(componentAssets).length
          ? { assets: componentAssets }
          : {}),
      },
    };
  });
  for (const name of names)
    if (
      name.startsWith("components/") &&
      !metadata.components.some(({ path }) => name.startsWith(path + "/"))
    )
      throw new Error(`Undeclared component file: ${name}.`);
  if (metadata.schemaVersion !== 1 && Object.hasOwn(files, "page.json"))
    throw new Error(
      "Template page.json is only read by legacy schemaVersion 1 bundles.",
    );
  const document =
    metadata.schemaVersion !== 1 || metadata.page === null
      ? undefined
      : object(JSON.parse(read(metadata.page)), "Template page");
  return {
    metadata,
    body,
    guides,
    components,
    document,
    legacy: metadata.schemaVersion < 3,
    staged: metadata.schemaVersion < TEMPLATE_SCHEMA_VERSION,
    source: structuredClone(input),
  };
}
