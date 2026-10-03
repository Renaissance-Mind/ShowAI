import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { build, type Plugin } from "esbuild";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import templates from "../../resources/catalog/templates.json";
import builtinComponents from "../../resources/catalog/components.json";
import { validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "../types";
import { assertJsonValue, assertProps } from "../components/custom/schema";
import {
  COMPONENT_DATA_MARKER,
  COMPONENT_ID,
  COMPONENT_VERSION,
  collectCustomComponentRefs,
  componentWidgetData as browserComponentWidgetData,
} from "../components/custom/contract";
import type {
  BuiltinComponentMetadata,
  CatalogScope,
  CompiledComponent,
  ComponentManifest,
  ComponentMetadata,
  ComponentSource,
  JsonSchema,
  TemplateMetadata,
  TemplateRecord,
} from "../components/custom/types";

export type {
  CompiledComponent,
  ComponentManifest,
  ComponentMetadata,
  ComponentSource,
  TemplateMetadata,
  TemplateRecord,
} from "../components/custom/types";

export function listBuiltinComponents(): BuiltinComponentMetadata[] {
  return structuredClone(builtinComponents) as BuiltinComponentMetadata[];
}
export function describeBuiltinComponent(
  kind: string,
): BuiltinComponentMetadata {
  const component = listBuiltinComponents().find((item) => item.kind === kind);
  if (!component) throw new Error(`Built-in component not found: ${kind}.`);
  return component;
}

const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".woff2",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
]);
const emptyContent = { type: "doc", content: [{ type: "paragraph" }] };

function assertId(id: string): void {
  if (!COMPONENT_ID.test(id))
    throw new Error(
      "Catalog ids must use lowercase letters, numbers and hyphens.",
    );
}
function assertVersion(version: string): void {
  if (!COMPONENT_VERSION.test(version))
    throw new Error(
      "Component version must be an exact semantic version, such as 1.0.0.",
    );
}
function projectRoot(home: string, projectId?: string): string {
  if (projectId === undefined) return resolve(home);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(projectId)
  )
    throw new Error("Invalid project id.");
  return join(resolve(home), "projects", projectId);
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}
async function optionalStat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
/** Every descendant is checked, including the final file, before catalog I/O. */
async function safePath(
  home: string,
  path: string,
  createParent = false,
): Promise<string> {
  const base = resolve(home),
    target = resolve(path);
  if (!inside(base, target)) throw new Error("Catalog path escapes its home.");
  await mkdir(base, { recursive: true });
  if ((await lstat(base)).isSymbolicLink())
    throw new Error("Catalog home cannot be a symbolic link.");
  const parts = relative(base, target).split(sep).filter(Boolean);
  let current = base;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await optionalStat(current);
    if (stat?.isSymbolicLink())
      throw new Error("Symbolic links are not allowed inside the catalog.");
    if (index < parts.length - 1) {
      if (stat && !stat.isDirectory())
        throw new Error("Catalog parent is not a directory.");
      if (!stat && createParent) await mkdir(current);
    }
  }
  return target;
}
async function readJson(home: string, path: string): Promise<unknown> {
  await safePath(home, path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 12 * 1024 * 1024)
    throw new Error("Invalid catalog file.");
  return JSON.parse(await readFile(path, "utf8"));
}
async function writeJson(
  home: string,
  path: string,
  value: unknown,
): Promise<void> {
  await safePath(home, path, true);
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}
function packageBase(
  home: string,
  kind: "templates" | "components",
  projectId?: string,
): string {
  return join(projectRoot(home, projectId), "packages", kind);
}
function locations(
  home: string,
  kind: "templates" | "components",
  projectId?: string,
): { path: string; scope: CatalogScope }[] {
  return [
    ...(projectId
      ? [
          {
            path: packageBase(home, kind, projectId),
            scope: "project" as const,
          },
        ]
      : []),
    { path: packageBase(home, kind), scope: "user" as const },
  ];
}
async function children(home: string, path: string): Promise<string[]> {
  await safePath(home, path);
  if (!(await optionalStat(path))) return [];
  return readdir(path);
}
function documentCopy(document: ShowDocument): ShowDocument {
  return validateDocument(JSON.parse(JSON.stringify(document))) as ShowDocument;
}
function builtinTemplate(id: string): TemplateRecord | undefined {
  const item = templates.find((template) => template.id === id);
  if (!item) return undefined;
  const date = "2026-10-03T00:00:00.000Z";
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    scope: "builtin",
    updatedAt: date,
    document: documentCopy({
      id: `template-${item.id}`,
      title: item.id === "blank" ? "" : item.name,
      icon: "",
      cover: "none",
      parentId: null,
      favorite: false,
      archived: false,
      createdAt: date,
      updatedAt: date,
      comments: [],
      content: { type: "doc", content: item.content },
    }),
  };
}
function templateRecord(value: unknown, scope: CatalogScope): TemplateRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid template file.");
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.description !== "string" ||
    typeof item.updatedAt !== "string"
  )
    throw new Error("Invalid template metadata.");
  assertId(item.id);
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    updatedAt: item.updatedAt,
    scope,
    document: documentCopy(item.document as ShowDocument),
  };
}
export async function listTemplates(
  home: string,
  projectId?: string,
): Promise<TemplateMetadata[]> {
  const found = new Map<string, TemplateMetadata>();
  for (const location of locations(home, "templates", projectId)) {
    for (const file of (await children(home, location.path))
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const item = templateRecord(
        await readJson(home, join(location.path, file)),
        location.scope,
      );
      if (!found.has(item.id)) {
        const { document: _document, ...metadata } = item;
        found.set(item.id, metadata);
      }
    }
  }
  for (const spec of templates)
    if (!found.has(spec.id)) {
      const { document: _document, ...metadata } = builtinTemplate(spec.id)!;
      found.set(spec.id, metadata);
    }
  return [...found.values()];
}
export async function getTemplate(
  home: string,
  id: string,
  projectId?: string,
): Promise<TemplateRecord> {
  assertId(id);
  for (const location of locations(home, "templates", projectId)) {
    const path = await safePath(home, join(location.path, `${id}.json`));
    if (await optionalStat(path))
      return templateRecord(await readJson(home, path), location.scope);
  }
  const builtin = builtinTemplate(id);
  if (builtin) return builtin;
  throw new Error(`Template not found: ${id}.`);
}
export async function saveTemplate(
  home: string,
  input: {
    id?: string;
    name: string;
    description: string;
    document: ShowDocument;
  },
  projectId?: string,
): Promise<TemplateRecord> {
  const id = input.id || `template-${randomUUID()}`;
  assertId(id);
  if (
    !input.name?.trim() ||
    input.name.length > 200 ||
    typeof input.description !== "string" ||
    input.description.length > 4000
  )
    throw new Error("A template needs a name and a short description.");
  const record: TemplateRecord = {
    id,
    name: input.name.trim(),
    description: input.description.trim(),
    document: documentCopy(input.document),
    scope: projectId ? "project" : "user",
    updatedAt: new Date().toISOString(),
  };
  await writeJson(
    home,
    join(packageBase(home, "templates", projectId), `${id}.json`),
    record,
  );
  return record;
}
export function instantiateTemplate(document: ShowDocument): ShowDocument {
  const copy = documentCopy(document),
    date = new Date().toISOString();
  const visit = (node: typeof copy.content) => {
    if (node.attrs?.id) node.attrs.id = randomUUID();
    node.content?.forEach(visit);
  };
  visit(copy.content);
  return {
    ...copy,
    id: randomUUID(),
    createdAt: date,
    updatedAt: date,
    favorite: false,
    archived: false,
    parentId: null,
    comments: [],
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  assertJsonValue(value);
  return value as Record<string, unknown>;
}
function manifestFrom(value: unknown): ComponentManifest {
  const item = record(value, "Component manifest");
  for (const key of ["id", "name", "version", "description", "entry"])
    if (typeof item[key] !== "string" || (item[key] as string).length > 4000)
      throw new Error(`Component manifest needs ${key}.`);
  const id = item.id as string,
    version = item.version as string,
    entry = item.entry as string;
  assertId(id);
  assertVersion(version);
  if (!(item.name as string).trim())
    throw new Error("A component needs a name.");
  if (
    isAbsolute(entry) ||
    entry.includes("\\") ||
    entry.split("/").some((part) => part === "..") ||
    !/\.[jt]sx?$/.test(entry)
  )
    throw new Error(
      "Component entry must be a local JavaScript or TypeScript file.",
    );
  if (
    !Array.isArray(item.scenarios) ||
    item.scenarios.some((item) => typeof item !== "string")
  )
    throw new Error("Component scenarios must be an array of text.");
  const defaultData = record(item.defaultData, "Component defaultData");
  if (!Array.isArray(item.examples))
    throw new Error("Component examples must be an array.");
  const examples = item.examples.map((value) => {
    const example = record(value, "Component example");
    if (typeof example.name !== "string")
      throw new Error("Each component example needs a name.");
    return { name: example.name, data: record(example.data, "Example data") };
  });
  return {
    id,
    version,
    name: (item.name as string).trim(),
    description: item.description as string,
    entry,
    scenarios: item.scenarios as string[],
    defaultData,
    examples,
  };
}
async function packageFiles(directory: string): Promise<Map<string, Buffer>> {
  const root = await realpath(directory);
  const files = new Map<string, Buffer>();
  let bytes = 0;
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (
        ["node_modules", ".git", "compiled.json"].includes(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      const target = join(path, entry.name),
        stat = await lstat(target);
      if (stat.isSymbolicLink())
        throw new Error("Component packages cannot contain symbolic links.");
      if (stat.isDirectory()) {
        await walk(target);
        continue;
      }
      if (
        !stat.isFile() ||
        !SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())
      )
        continue;
      bytes += stat.size;
      if (files.size >= MAX_FILES || bytes > MAX_PACKAGE_BYTES)
        throw new Error("Component package exceeds the 200-file / 8 MB limit.");
      files.set(
        relative(root, target).split(sep).join("/"),
        await readFile(target),
      );
    }
  };
  await walk(root);
  return files;
}
function digest(value: string | Buffer): string {
  return `sha256-${createHash("sha256").update(value).digest("hex")}`;
}
function sourceDigest(files: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const [name, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    hash.update(name).update("\0").update(content).update("\0");
  return `sha256-${hash.digest("hex")}`;
}
function compiledIntegrity(
  component: Pick<
    CompiledComponent,
    keyof ComponentManifest | "html" | "schema" | "inline"
  >,
): string {
  const manifest = manifestFrom(component);
  return digest(
    JSON.stringify({
      manifest,
      schema: component.schema,
      html: component.html,
      ...(component.inline ? { inline: component.inline } : {}),
    }),
  );
}

function runtimeSource(entry: string): string {
  return `import React, {useState} from 'react';import{createRoot}from'react-dom/client';import UserComponent from ${JSON.stringify(entry)};import validate from 'showai:validator';
const config=JSON.parse(document.getElementById('showai-component-data')?.textContent||'{}');const channel=config.channel;
const send=(type,extra={})=>parent.postMessage({channel,type,...extra},'*');let update;
const validationMessage=()=>(validate.errors||[]).map(error=>(error.instancePath||error.params?.missingProperty||'data')+' '+error.message).join('; ');
function check(props){if(validate(props))return true;send('showai:error',{message:validationMessage()});return false;}
function App(){const[state,setState]=useState({data:config.props||{},readOnly:config.readOnly!==false});update=(data,readOnly)=>{if(check(data)){setState({data,readOnly});send('showai:valid')}};return React.createElement(UserComponent,{...state,onChange:state.readOnly?undefined:(data)=>{if(check(data)){setState(s=>({...s,data}));send('showai:change',{props:data});}}});}
window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;if(event.data?.type==='showai:validate'){const valid=validate(event.data.props);send('showai:validation',{requestId:event.data.requestId,valid,message:valid?'':validationMessage()});return;}if(event.data?.type==='showai:props')update?.(event.data.props,event.data.readOnly!==false);});
window.addEventListener('error',event=>send('showai:error',{message:event.message}));window.addEventListener('unhandledrejection',event=>send('showai:error',{message:String(event.reason?.message||event.reason)}));
createRoot(document.getElementById('component-root')).render(React.createElement(App));
new ResizeObserver(()=>send('showai:height',{height:Math.ceil(document.getElementById('component-root').getBoundingClientRect().height)+2})).observe(document.getElementById('component-root'));send('showai:ready');`;
}

function inlineRuntimeSource(entry: string): string {
  return `import React from 'react';import{createRoot}from'react-dom/client';import UserComponent from ${JSON.stringify(entry)};import validate from 'showai:validator';
export function mount(target,initial){const root=createRoot(target,{onUncaughtError:error=>initial.onError(String(error?.message||error))});
const render=data=>{if(!validate(data)){initial.onError((validate.errors||[]).map(error=>(error.instancePath||'data')+' '+error.message).join('; '));return;}initial.onError('');root.render(React.createElement(UserComponent,{data,readOnly:true,onChange:undefined}));};render(initial.data);return{update:render,destroy:()=>root.unmount()};}`;
}

async function compilePackage(
  directory: string,
  manifest: ComponentManifest,
  schema: JsonSchema,
  files: Map<string, Buffer>,
  scope: CatalogScope,
): Promise<CompiledComponent> {
  const require = createRequire(
    process.env.SHOWAI_RUNTIME_ENTRY ?? import.meta.url,
  );
  assertProps(schema, manifest.defaultData);
  manifest.examples.forEach((example) => assertProps(schema, example.data));
  const root = await realpath(directory);
  if (!files.has(manifest.entry.replace(/^\.\//, "")))
    throw new Error("The component entry does not exist inside the package.");
  const ajv = new Ajv({
    strict: true,
    validateFormats: false,
    code: { source: true, esm: true },
    allErrors: true,
  });
  const validator = standaloneCode(ajv, ajv.compile(schema));
  const trusted = ["react", "react-dom", "scheduler", "ajv"].map((name) =>
    dirname(require.resolve(`${name}/package.json`)),
  );
  const boundary: Plugin = {
    name: "showai-component-boundary",
    setup(plugin) {
      plugin.onResolve({ filter: /^showai:/ }, (args) =>
        args.path === "showai:validator"
          ? { path: args.path, namespace: "showai-validator" }
          : { errors: [{ text: "Unknown ShowAI component module." }] },
      );
      plugin.onLoad({ filter: /.*/, namespace: "showai-validator" }, () => ({
        contents: validator,
        loader: "js",
        resolveDir: root,
      }));
      plugin.onResolve({ filter: /.*/ }, async (args) => {
        if (args.path.startsWith("showai:")) return;
        if (
          args.namespace === "showai-validator" &&
          args.path.startsWith("ajv/")
        )
          return { path: require.resolve(args.path) };
        const importerTrusted = trusted.some((base) =>
          inside(base, args.importer),
        );
        if (
          [
            "react",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            "react-dom/client",
          ].includes(args.path)
        )
          return { path: require.resolve(args.path) };
        if (importerTrusted) {
          if (["scheduler", "react", "react-dom"].includes(args.path))
            return { path: require.resolve(args.path) };
          if (args.path.startsWith(".")) {
            const resolved = require.resolve(
              resolve(args.resolveDir, args.path),
            );
            if (trusted.some((base) => inside(base, resolved)))
              return { path: resolved };
          }
          return {
            errors: [{ text: `Unexpected runtime dependency: ${args.path}` }],
          };
        }
        if (!args.path.startsWith("."))
          return {
            errors: [
              {
                text: `Only React and package-local imports are allowed: ${args.path}`,
              },
            ],
          };
        const candidate = resolve(args.resolveDir, args.path);
        if (!inside(root, candidate))
          return {
            errors: [{ text: "Component imports cannot leave the package." }],
          };
        const candidates = [
          candidate,
          ...[
            ".tsx",
            ".ts",
            ".jsx",
            ".js",
            ".json",
            "/index.tsx",
            "/index.ts",
            "/index.jsx",
            "/index.js",
          ].map((suffix) => candidate + suffix),
        ];
        for (const path of candidates) {
          const key = relative(root, path).split(sep).join("/");
          if (files.has(key)) return { path };
        }
        return { errors: [{ text: `Missing package file: ${args.path}` }] };
      });
      plugin.onLoad({ filter: /.*/, namespace: "file" }, (args) => {
        if (!inside(root, args.path)) return;
        const contents = files.get(
          relative(root, args.path).split(sep).join("/"),
        );
        if (!contents)
          return {
            errors: [
              { text: "Component file is outside the imported package." },
            ],
          };
        const extension = extname(args.path).slice(1);
        const loader = ["tsx", "ts", "jsx", "js", "json", "css"].includes(
          extension,
        )
          ? (extension as "tsx" | "ts" | "jsx" | "js" | "json" | "css")
          : "dataurl";
        return { contents, loader };
      });
    },
  };
  const output = await build({
    stdin: {
      contents: runtimeSource(`./${manifest.entry.replace(/^\.\//, "")}`),
      resolveDir: root,
      sourcefile: "showai-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    outfile: "component.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [boundary],
    logLevel: "silent",
    legalComments: "none",
  });
  const script = output.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  )?.text;
  if (!script)
    throw new Error("The component compiler did not produce JavaScript.");
  const css = output.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
  // The conversation already provides the security sandbox and forbids nested
  // frames. Reuse its reader's React instead of embedding React twice per package.
  const inlineReact: Plugin = {
    name: "showai-inline-react",
    setup(plugin) {
      plugin.onResolve(
        { filter: /^(?:react(?:\/jsx(?:-dev)?-runtime)?|react-dom\/client)$/ },
        (args) => ({ path: args.path, namespace: "showai-inline-react" }),
      );
      plugin.onLoad(
        { filter: /.*/, namespace: "showai-inline-react" },
        (args) => {
          const namespace = {
            react: "react",
            "react-dom/client": "client",
            "react/jsx-runtime": "jsx",
            "react/jsx-dev-runtime": "jsxDev",
          }[args.path];
          const names = Object.keys(require(args.path)).filter(
            (name) => name !== "default" && /^[$A-Z_a-z][$\w]*$/.test(name),
          );
          return {
            contents: `const runtime=globalThis.__SHOWAI_COMPONENT_HOST__.${namespace};export default runtime;${names.map((name) => `export const ${name}=runtime.${name};`).join("")}`,
            loader: "js",
          };
        },
      );
    },
  };
  const inlineOutput = await build({
    stdin: {
      contents: inlineRuntimeSource(`./${manifest.entry.replace(/^\.\//, "")}`),
      resolveDir: root,
      sourcefile: "showai-inline-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "ShowAIInlineComponent",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    outfile: "inline.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [inlineReact, boundary],
    logLevel: "silent",
    legalComments: "none",
  });
  const inline = {
    script: inlineOutput.outputFiles.find((file) => file.path.endsWith(".js"))!
      .text,
    styles: inlineOutput.outputFiles
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => file.text)
      .join("\n"),
  };
  if (
    Buffer.byteLength(inline.script) + Buffer.byteLength(inline.styles) >
    MAX_HTML_BYTES
  )
    throw new Error("Compiled inline component exceeds 2 MB.");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;font:14px/1.6 system-ui,sans-serif;color:#292d29}*{box-sizing:border-box}button,input,select,textarea{font:inherit}#component-root{display:flow-root;overflow-wrap:anywhere}${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="component-root"></div>${COMPONENT_DATA_MARKER}<script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  if (Buffer.byteLength(html) > MAX_HTML_BYTES)
    throw new Error("Compiled component exceeds 2 MB.");
  const component: CompiledComponent = {
    ...manifest,
    schema,
    html,
    inline,
    scope,
    updatedAt: new Date().toISOString(),
    integrity: "",
  };
  component.integrity = compiledIntegrity(component);
  return component;
}

interface StoredComponent extends CompiledComponent {
  sourceIntegrity: string;
}
function compiledRecord(value: unknown, scope: CatalogScope): StoredComponent {
  const item = record(value, "Compiled component");
  const manifest = manifestFrom(item);
  if (
    typeof item.html !== "string" ||
    Buffer.byteLength(item.html) > MAX_HTML_BYTES ||
    !item.html.includes(COMPONENT_DATA_MARKER) ||
    typeof item.updatedAt !== "string" ||
    typeof item.sourceIntegrity !== "string"
  )
    throw new Error("Invalid compiled component file.");
  const result = {
    ...manifest,
    html: item.html,
    schema: item.schema as JsonSchema,
    ...(item.inline
      ? { inline: item.inline as CompiledComponent["inline"] }
      : {}),
    updatedAt: item.updatedAt,
    integrity: String(item.integrity),
    sourceIntegrity: item.sourceIntegrity,
    scope,
  };
  if (
    result.inline &&
    (typeof result.inline.script !== "string" ||
      typeof result.inline.styles !== "string" ||
      Buffer.byteLength(result.inline.script) +
        Buffer.byteLength(result.inline.styles) >
        MAX_HTML_BYTES)
  )
    throw new Error("Invalid inline component runtime.");
  if (compiledIntegrity(result) !== result.integrity)
    throw new Error("Compiled component integrity verification failed.");
  return result;
}
export async function listComponents(
  home: string,
  projectId?: string,
): Promise<ComponentMetadata[]> {
  const found = new Map<string, ComponentMetadata>();
  for (const location of locations(home, "components", projectId)) {
    for (const id of (await children(home, location.path))
      .filter((id) => COMPONENT_ID.test(id))
      .sort()) {
      for (const version of (await children(home, join(location.path, id)))
        .filter((version) => COMPONENT_VERSION.test(version))
        .sort()) {
        const key = `${id}@${version}`;
        if (found.has(key)) continue;
        const {
          html: _html,
          inline: _inline,
          schema: _schema,
          sourceIntegrity: _source,
          ...metadata
        } = compiledRecord(
          await readJson(
            home,
            join(location.path, id, version, "compiled.json"),
          ),
          location.scope,
        );
        found.set(key, metadata);
      }
    }
  }
  return [...found.values()].sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      right.version.localeCompare(left.version, undefined, { numeric: true }),
  );
}
async function componentLocation(
  home: string,
  id: string,
  version?: string,
  projectId?: string,
): Promise<{ path: string; scope: CatalogScope }> {
  assertId(id);
  const selected =
    version ??
    (await listComponents(home, projectId)).find(
      (component) => component.id === id,
    )?.version;
  if (!selected) throw new Error(`Component not found: ${id}.`);
  assertVersion(selected);
  for (const location of locations(home, "components", projectId)) {
    const path = await safePath(home, join(location.path, id, selected));
    if (await optionalStat(path)) return { path, scope: location.scope };
  }
  throw new Error(`Component not found: ${id}@${selected}.`);
}
export async function getComponent(
  home: string,
  id: string,
  version?: string,
  projectId?: string,
): Promise<CompiledComponent> {
  const location = await componentLocation(home, id, version, projectId);
  const { sourceIntegrity: _source, ...component } = compiledRecord(
    await readJson(home, join(location.path, "compiled.json")),
    location.scope,
  );
  return component;
}
export async function importComponent(
  home: string,
  packageDirectory: string,
  projectId?: string,
): Promise<CompiledComponent> {
  const directory = await realpath(packageDirectory);
  const files = await packageFiles(directory);
  if (!files.has("manifest.json") || !files.has("props.schema.json"))
    throw new Error(
      "Component package needs manifest.json and props.schema.json.",
    );
  const manifest = manifestFrom(
    JSON.parse(files.get("manifest.json")!.toString("utf8")),
  );
  const schema = JSON.parse(
    files.get("props.schema.json")!.toString("utf8"),
  ) as JsonSchema;
  const sourceIntegrity = sourceDigest(files);
  const destination = await safePath(
    home,
    join(
      packageBase(home, "components", projectId),
      manifest.id,
      manifest.version,
    ),
    true,
  );
  const scope = projectId ? "project" : "user";
  if (await optionalStat(destination)) {
    const existing = compiledRecord(
      await readJson(home, join(destination, "compiled.json")),
      scope,
    );
    if (existing.sourceIntegrity === sourceIntegrity)
      return getComponent(home, manifest.id, manifest.version, projectId);
    if (existing.sourceIntegrity !== "portable")
      throw new Error(
        `Component ${manifest.id}@${manifest.version} is immutable. Increase its version before changing the package.`,
      );
    const compiled = await compilePackage(
      directory,
      manifest,
      schema,
      files,
      scope,
    );
    if (compiled.integrity !== existing.integrity)
      throw new Error(
        `Component ${manifest.id}@${manifest.version} is immutable. Increase its version before changing the package.`,
      );
    for (const [path, contents] of files) {
      const target = await safePath(home, join(destination, path), true);
      await writeFile(target, contents, { flag: "wx", mode: 0o600 });
    }
    await writeJson(home, join(destination, "compiled.json"), {
      ...compiled,
      sourceIntegrity,
    });
    return compiled;
  }
  const component = await compilePackage(
    directory,
    manifest,
    schema,
    files,
    scope,
  );
  const staging = join(dirname(destination), `.import-${randomUUID()}`);
  await mkdir(staging);
  try {
    for (const [path, contents] of files) {
      const target = join(staging, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, { flag: "wx", mode: 0o600 });
    }
    await writeFile(
      join(staging, "compiled.json"),
      JSON.stringify({ ...component, sourceIntegrity }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return component;
}
export async function readComponentSource(
  home: string,
  id: string,
  version?: string,
  projectId?: string,
): Promise<ComponentSource> {
  const location = await componentLocation(home, id, version, projectId);
  await safePath(home, location.path);
  const files = await packageFiles(location.path);
  if (!files.has("manifest.json") || !files.has("props.schema.json"))
    throw new Error(
      "This component was imported from a portable page and has no editable source. Import the original source package to edit it.",
    );
  const manifest = manifestFrom(
    JSON.parse(files.get("manifest.json")!.toString("utf8")),
  );
  return {
    manifest,
    schema: JSON.parse(files.get("props.schema.json")!.toString("utf8")),
    source: files.get(manifest.entry.replace(/^\.\//, ""))!.toString("utf8"),
    files: Object.fromEntries(
      [...files]
        .filter(([path]) => TEXT_EXTENSIONS.has(extname(path)))
        .map(([path, contents]) => [path, contents.toString("utf8")]),
    ),
    assets: Object.fromEntries(
      [...files]
        .filter(([path]) => !TEXT_EXTENSIONS.has(extname(path)))
        .map(([path, contents]) => [path, contents.toString("base64")]),
    ),
  };
}
export async function saveComponent(
  home: string,
  input: {
    manifest: ComponentManifest;
    schema: JsonSchema;
    source: string;
    files?: Record<string, string>;
    assets?: Record<string, string>;
  },
  projectId?: string,
): Promise<CompiledComponent> {
  const manifest = manifestFrom(input.manifest);
  if (typeof input.source !== "string")
    throw new Error("Component source must be text.");
  const directory = await safePath(
    home,
    join(resolve(home), "tmp", `component-${randomUUID()}`),
    true,
  );
  await mkdir(directory);
  try {
    const files = {
      ...(input.files ?? {}),
      "manifest.json": JSON.stringify(manifest, null, 2),
      "props.schema.json": JSON.stringify(input.schema, null, 2),
      [manifest.entry]: input.source,
    };
    for (const [path, source] of Object.entries(files)) {
      if (
        isAbsolute(path) ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        !inside(directory, resolve(directory, path)) ||
        !TEXT_EXTENSIONS.has(extname(path)) ||
        typeof source !== "string"
      )
        throw new Error(
          "Component source files must stay inside the package and use supported text extensions.",
        );
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source, { flag: "wx", mode: 0o600 });
    }
    for (const [path, encoded] of Object.entries(input.assets ?? {})) {
      if (
        isAbsolute(path) ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        !inside(directory, resolve(directory, path)) ||
        !SOURCE_EXTENSIONS.has(extname(path)) ||
        TEXT_EXTENSIONS.has(extname(path)) ||
        typeof encoded !== "string" ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) ||
        encoded.length > MAX_PACKAGE_BYTES * 1.4
      )
        throw new Error(
          "Component assets must be supported package-local files encoded as base64.",
        );
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(encoded, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
    }
    return await importComponent(home, directory, projectId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function resolveDocumentComponents(
  home: string,
  document: ShowDocument,
  projectId?: string,
): Promise<CompiledComponent[]> {
  return Promise.all(
    collectCustomComponentRefs(document).map(async (ref) => {
      const component = await getComponent(
        home,
        ref.componentId,
        ref.version,
        projectId,
      );
      if (ref.integrity && component.integrity !== ref.integrity)
        throw new Error(
          `Component integrity mismatch: ${ref.componentId}@${ref.version}.`,
        );
      const visit = (node: typeof document.content) => {
        if (
          node.type === "widget" &&
          node.attrs?.kind === "custom" &&
          node.attrs.data?.componentId === component.id &&
          node.attrs.data?.version === component.version
        )
          assertProps(component.schema, node.attrs.data.props);
        node.content?.forEach(visit);
      };
      visit(document.content);
      return component;
    }),
  );
}

/** Installs serialized sandbox runtimes without ever evaluating or executing their code. */
export async function importCompiledComponents(
  home: string,
  components: CompiledComponent[],
  projectId?: string,
): Promise<ComponentMetadata[]> {
  if (!Array.isArray(components) || components.length > 100)
    throw new Error("Invalid portable component collection.");
  const scope = projectId ? "project" : "user";
  const checked = components.map((component) => {
    const validated = compiledRecord(
      { ...component, sourceIntegrity: "portable" },
      scope,
    );
    assertProps(validated.schema, validated.defaultData);
    validated.examples.forEach((example) =>
      assertProps(validated.schema, example.data),
    );
    return validated;
  });
  const keys = new Map<string, string>();
  for (const component of checked) {
    const key = `${component.id}@${component.version}`;
    if (keys.has(key) && keys.get(key) !== component.integrity)
      throw new Error(`Conflicting portable component: ${key}.`);
    keys.set(key, component.integrity);
    const path = await safePath(
      home,
      join(
        packageBase(home, "components", projectId),
        component.id,
        component.version,
      ),
    );
    if (await optionalStat(path)) {
      const existing = compiledRecord(
        await readJson(home, join(path, "compiled.json")),
        scope,
      );
      if (existing.integrity !== component.integrity)
        throw new Error(
          `Component ${key} is immutable. Its installed content differs from this page.`,
        );
    }
  }
  const imported: ComponentMetadata[] = [];
  for (const component of checked) {
    const path = await safePath(
      home,
      join(
        packageBase(home, "components", projectId),
        component.id,
        component.version,
      ),
      true,
    );
    if (!(await optionalStat(path))) {
      const staging = join(dirname(path), `.portable-${randomUUID()}`);
      await mkdir(staging);
      try {
        await writeFile(
          join(staging, "compiled.json"),
          JSON.stringify(component, null, 2) + "\n",
          { flag: "wx", mode: 0o600 },
        );
        await rename(staging, path);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    const {
      html: _html,
      inline: _inline,
      schema: _schema,
      sourceIntegrity: _source,
      ...metadata
    } = component;
    imported.push(metadata);
  }
  return imported;
}
export function componentWidgetData(
  component: CompiledComponent,
  props: Record<string, unknown> = component.defaultData,
): Record<string, unknown> {
  assertProps(component.schema, props);
  return browserComponentWidgetData(component, props);
}
export function blankDocument(): ShowDocument {
  const date = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "",
    icon: "",
    cover: "none",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: date,
    updatedAt: date,
    comments: [],
    content: structuredClone(emptyContent),
  };
}
