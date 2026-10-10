import {
  CAPACITY,
  assertBytes,
  measureContent,
} from "../portable/capacity.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  workspaceRoot,
  versionedLibrary,
  logicalPath,
  readLibraryFile,
  writeLibraryFiles,
  listLibraryDirectory,
  mutateLibrary,
} from "./library-runtime";
import { changeContext } from "./history-context";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  importPublishedBundle,
  resolveDocumentComponents,
  resolvePackageBundle,
  validatePackageBundle,
} from "./catalog";
import type {
  PackageBundle,
  PackageRevisionRef,
} from "../components/custom/types";
import type { ShowDocument } from "../types";
import type {
  PreparedPublication,
  PublicationManifest,
  PublishedComponentLocator,
  VerifiedPublication,
} from "../portable/publication-types";
import {
  fetchPublicationFile,
  publicationRefKey,
  publicationUrl,
  validatePublicationRef,
  validateRemoteComponents,
  MAX_PUBLICATION_BUNDLE_BYTES,
} from "../portable/remote.mjs";

export type {
  PreparedPublication,
  PublicationManifest,
  PublishedComponentLocator,
  VerifiedPublication,
} from "../portable/publication-types";
export { loadRemoteComponents } from "../portable/remote.mjs";

const sha256 = (bytes: string | Buffer) =>
  `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
const serialize = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const inside = (root: string, path: string) => {
  const name = relative(root, path);
  return (
    name === "" ||
    (!isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`))
  );
};
const optionalStat = (path: string) =>
  lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

async function effectivePath(path: string): Promise<string> {
  let existing = resolve(path);
  const suffix: string[] = [];
  while (!(await optionalStat(existing))) {
    suffix.unshift(relative(dirname(existing), existing));
    existing = dirname(existing);
  }
  return join(await realpath(existing), ...suffix);
}

async function publicationDestination(
  home: string,
  out: string,
  projectId?: string,
): Promise<string> {
  const target = await effectivePath(out),
    base = await effectivePath(home);
  const prepared = join(base, "publications", "prepared");
  const projectExport =
    projectId && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId)
      ? join(base, "projects", projectId, "exports")
      : undefined;
  if (
    inside(base, target) &&
    !inside(prepared, target) &&
    !(projectExport && inside(projectExport, target))
  )
    throw new Error(
      "Prepare a publication outside authoring sources, under publications/prepared, or in the selected project's exports folder.",
    );
  if ((await optionalStat(out))?.isSymbolicLink())
    throw new Error("The publication output cannot be a symbolic link.");
  const stat = await optionalStat(target);
  if (stat && (!stat.isDirectory() || (await readdir(target)).length))
    throw new Error(
      "Publication output must be a new or empty directory. Prepared releases are immutable.",
    );
  return target;
}

export async function preparePublication(
  home: string,
  input: { refs: PackageRevisionRef[]; out: string; projectId?: string },
): Promise<PreparedPublication> {
  if (
    !Array.isArray(input.refs) ||
    input.refs.length < 1 ||
    input.refs.length > 100
  )
    throw new Error(
      "Choose between 1 and 100 exact package revisions to publish.",
    );
  const refs = [
    ...new Map(
      input.refs.map((value) => {
        const ref = validatePublicationRef(value);
        return [publicationRefKey(ref), ref];
      }),
    ).values(),
  ].sort((left, right) =>
    publicationRefKey(left).localeCompare(publicationRefKey(right)),
  );
  const bundles = await Promise.all(
    refs.map((ref) => resolvePackageBundle(home, ref, input.projectId)),
  );
  const files = bundles.map((value) => {
    const bundle = validatePackageBundle(value);
    assertBytes(
      "Publication package JSON",
      measureContent(bundle).prettyJsonBytes,
      MAX_PUBLICATION_BUNDLE_BYTES,
    );
    const bytes = Buffer.from(serialize(bundle));
    assertBytes(
      `Publication package ${publicationRefKey(bundle.root)}`,
      bytes.length,
      MAX_PUBLICATION_BUNDLE_BYTES,
    );
    const transportHash = sha256(bytes);
    const file = `packages/${bundle.root.kind}/${bundle.root.id}/${bundle.root.version}/${transportHash.slice(7)}/bundle.json`;
    return { bundle, bytes, file, sha256: transportHash };
  });
  const metadata = files.map(({ bundle }) => {
    const item =
      bundle.root.kind === "component"
        ? bundle.components.find(
            (entry) =>
              entry.component.id === bundle.root.id &&
              entry.component.version === bundle.root.version &&
              entry.component.integrity === bundle.root.integrity,
          )?.component
        : bundle.templates.find(
            (entry) =>
              entry.id === bundle.root.id &&
              entry.version === bundle.root.version &&
              entry.integrity === bundle.root.integrity,
          );
    if (!item)
      throw new Error("Publication bundle does not contain its root revision.");
    return {
      ref: bundle.root,
      name: item.name,
      description: item.description,
      ...("scenarios" in item ? { scenarios: item.scenarios } : {}),
      ...(bundle.root.kind === "component"
        ? { effects: ("effects" in item ? item.effects : undefined) ?? [] }
        : {}),
    };
  });
  const metadataBytes = Buffer.from(
    serialize({
      format: "showai-publication-metadata",
      version: 1,
      packages: metadata,
    }),
  );
  const entries = files.map(({ bundle, bytes, file, sha256 }) => ({
    ref: bundle.root,
    file,
    sha256,
    bytes: bytes.length,
  }));
  const metadataFile = {
    file: "metadata.json",
    sha256: sha256(metadataBytes),
    bytes: metadataBytes.length,
  };
  const manifest: PublicationManifest = {
    format: "showai-publication",
    version: 1,
    releaseId: sha256(
      JSON.stringify({ packages: entries, metadata: metadataFile }),
    ),
    packages: entries,
    metadata: metadataFile,
  };
  const path = await publicationDestination(
    home,
    resolve(input.out),
    input.projectId,
  );
  await mkdir(path, { recursive: true });
  for (const file of files) {
    const target = join(path, file.file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: "wx" });
  }
  await writeFile(join(path, "metadata.json"), metadataBytes, { flag: "wx" });
  await writeFile(join(path, "manifest.json"), serialize(manifest), {
    flag: "wx",
  });
  await writeFile(
    join(path, "_headers"),
    "/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n",
    { flag: "wx" },
  );
  await writeFile(
    join(path, "README.txt"),
    "This directory is prepared, not published. Deploy its contents to your static host, then verify its exact manifest.json URL in ShowAI. Keep these content-addressed files unchanged. Serve JSON files with Content-Type: application/json and Access-Control-Allow-Origin: *. The included _headers file is supported by some static hosts; configure equivalent response headers on other servers. HTTPS is required except for localhost/loopback HTTP. Remote exports require network access; bundled exports remain offline. No server is started and nothing is uploaded by preparation.\n",
    { flag: "wx" },
  );
  return {
    status: "prepared",
    path,
    manifestPath: join(path, "manifest.json"),
    manifest,
    bytes: files.reduce(
      (total, file) => total + file.bytes.length,
      metadataBytes.length + Buffer.byteLength(serialize(manifest)),
    ),
  };
}

function validateManifest(input: unknown): PublicationManifest {
  const value = input as PublicationManifest;
  if (
    !value ||
    value.format !== "showai-publication" ||
    value.version !== 1 ||
    !Array.isArray(value.packages) ||
    !value.packages.length ||
    value.packages.length > 100
  )
    throw new Error("Unsupported publication manifest.");
  const seen = new Set<string>();
  for (const entry of [...value.packages, value.metadata]) {
    if (
      !entry ||
      typeof entry.file !== "string" ||
      !/^(?:metadata\.json|packages\/(?:component|template)\/[a-z][a-z0-9-]{0,79}\/[a-zA-Z0-9.-]+\/[a-f0-9]{64}\/bundle\.json)$/.test(
        entry.file,
      ) ||
      !/^sha256-[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > MAX_PUBLICATION_BUNDLE_BYTES
    )
      throw new Error("Publication manifest contains an invalid file entry.");
  }
  for (const entry of value.packages) {
    const ref = validatePublicationRef(entry.ref);
    const key = publicationRefKey(ref);
    if (seen.has(key))
      throw new Error(`Duplicate publication revision: ${key}`);
    seen.add(key);
    if (
      entry.file !==
      `packages/${ref.kind}/${ref.id}/${ref.version}/${entry.sha256.slice(7)}/bundle.json`
    )
      throw new Error("Publication path does not match its locked revision.");
  }
  if (
    value.metadata.file !== "metadata.json" ||
    value.releaseId !==
      sha256(
        JSON.stringify({ packages: value.packages, metadata: value.metadata }),
      )
  )
    throw new Error("Publication manifest identity is inconsistent.");
  return value;
}

async function receiptDirectory(home: string): Promise<string> {
  const root = workspaceRoot(home);
  await mkdir(root, { recursive: true });
  for (const path of [
    root,
    join(root, "publications"),
    join(root, "publications", "verified"),
  ]) {
    const stat = await optionalStat(path);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
      throw new Error(
        "Publication registry directories must be ordinary directories.",
      );
    if (!stat) await mkdir(path);
  }
  return join(root, "publications", "verified");
}

async function verifyPublicationImpl(
  home: string,
  input: { manifestUrl: string; projectId?: string },
): Promise<VerifiedPublication> {
  const manifestUrl = publicationUrl(input.manifestUrl);
  const manifestFile = await fetchPublicationFile(manifestUrl, {
    maxBytes: 1024 * 1024,
    requireCors: true,
  });
  const manifest = validateManifest(JSON.parse(manifestFile.text));
  const metadata = await fetchPublicationFile(
    new URL(manifest.metadata.file, manifestUrl).href,
    { maxBytes: manifest.metadata.bytes, requireCors: true },
  );
  if (
    metadata.sha256 !== manifest.metadata.sha256 ||
    metadata.bytes.byteLength !== manifest.metadata.bytes
  )
    throw new Error(
      "Published metadata failed its SHA-256 or byte-length check.",
    );
  const bundles: {
    bundle: PackageBundle;
    locator: { url: string; sha256: string; bytes: number };
  }[] = [];
  let downloaded = metadata.bytes.byteLength;
  for (const entry of manifest.packages) {
    const url = publicationUrl(new URL(entry.file, manifestUrl).href);
    const file = await fetchPublicationFile(url, {
      maxBytes: entry.bytes,
      requireCors: true,
    });
    downloaded += file.bytes.byteLength;
    assertBytes(
      "Publication transfer",
      downloaded,
      CAPACITY.publicationTransferBytes,
    );
    if (file.sha256 !== entry.sha256 || file.bytes.byteLength !== entry.bytes)
      throw new Error(
        `Published package ${publicationRefKey(entry.ref)} failed its SHA-256 or byte-length check.`,
      );
    const bundle = validatePackageBundle(JSON.parse(file.text));
    if (publicationRefKey(bundle.root) !== publicationRefKey(entry.ref))
      throw new Error(
        "Published bundle root does not match the manifest's exact revision.",
      );
    bundles.push({
      bundle,
      locator: { url, sha256: file.sha256, bytes: file.bytes.byteLength },
    });
  }
  // Merge once so the catalog can preflight every immutable slot before writing.
  // No verified receipt is written until every transport and semantic check passes.
  const componentEntries = new Map<
    string,
    PackageBundle["components"][number]
  >();
  const templateEntries = new Map<string, PackageBundle["templates"][number]>();
  for (const { bundle } of bundles) {
    for (const entry of bundle.components)
      componentEntries.set(
        publicationRefKey({
          kind: "component",
          id: entry.component.id,
          version: entry.component.version,
          integrity: entry.component.integrity,
        }),
        entry,
      );
    for (const entry of bundle.templates)
      templateEntries.set(
        publicationRefKey({
          kind: "template",
          id: entry.id,
          version: entry.version,
          integrity: entry.integrity,
        }),
        entry,
      );
  }
  await importPublishedBundle(home, {
    format: "showai-catalog-bundle",
    version: 1,
    root: bundles[0].bundle.root,
    components: [...componentEntries.values()],
    templates: [...templateEntries.values()],
  });
  const verifiedAt = new Date().toISOString();
  const components = new Map<string, PublishedComponentLocator>();
  for (const { bundle, locator } of bundles)
    for (const { component } of bundle.components) {
      const ref = {
        kind: "component" as const,
        id: component.id,
        version: component.version,
        integrity: component.integrity,
        scope: "published" as const,
      };
      components.set(publicationRefKey(ref), {
        ref,
        bundleRef: bundle.root,
        ...locator,
        manifestUrl,
        manifestIntegrity: manifestFile.sha256,
        verifiedAt,
      });
    }
  const receipt: VerifiedPublication = {
    status: "published",
    manifestUrl,
    manifestIntegrity: manifestFile.sha256,
    releaseId: manifest.releaseId,
    verifiedAt,
    components: [...components.values()],
  };
  const directory = await receiptDirectory(home);
  const name =
    sha256(manifestUrl + "\n" + manifestFile.sha256).slice(7) + ".json";
  const target = join(directory, name);
  if (versionedLibrary(home))
    await writeLibraryFiles(
      home,
      new Map([[logicalPath(home, target)!, Buffer.from(serialize(receipt))]]),
    );
  else {
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, serialize(receipt), { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  }
  return receipt;
}

export async function listPublications(
  home: string,
): Promise<VerifiedPublication[]> {
  const path = join(workspaceRoot(home), "publications", "verified");
  const managed = await listLibraryDirectory(home, path);
  if (!managed && !(await optionalStat(path))) return [];
  const directory = managed ? path : await receiptDirectory(home);
  const receipts: VerifiedPublication[] = [];
  for (const name of (managed ?? (await readdir(directory)))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort()) {
    const target = join(directory, name);
    const bytes =
      (await readLibraryFile(home, target)) ?? (await readFile(target));
    if (!managed) {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("Invalid publication receipt file.");
    }
    if (bytes.length > 4 * 1024 * 1024)
      throw new Error("Invalid publication receipt file.");
    const receipt = JSON.parse(bytes.toString("utf8")) as VerifiedPublication;
    if (
      receipt.status !== "published" ||
      !/^sha256-[a-f0-9]{64}$/.test(receipt.manifestIntegrity) ||
      !/^sha256-[a-f0-9]{64}$/.test(receipt.releaseId) ||
      typeof receipt.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.verifiedAt))
    )
      throw new Error("Publication receipt has not been verified.");
    receipt.manifestUrl = publicationUrl(receipt.manifestUrl);
    receipt.components = validateRemoteComponents(receipt.components);
    for (const locator of receipt.components) {
      if (
        locator.manifestUrl !== receipt.manifestUrl ||
        locator.manifestIntegrity !== receipt.manifestIntegrity ||
        locator.verifiedAt !== receipt.verifiedAt
      )
        throw new Error("Publication receipt metadata is inconsistent.");
    }
    receipts.push(receipt);
  }
  return receipts.sort(
    (left, right) => Date.parse(right.verifiedAt) - Date.parse(left.verifiedAt),
  );
}

export async function listPublishedComponents(
  home: string,
): Promise<PublishedComponentLocator[]> {
  const found = new Map<string, PublishedComponentLocator>();
  for (const receipt of await listPublications(home))
    for (const locator of receipt.components) {
      const key = publicationRefKey(locator.ref);
      if (!found.has(key)) found.set(key, locator);
    }
  return [...found.values()].sort((left, right) =>
    publicationRefKey(left.ref).localeCompare(publicationRefKey(right.ref)),
  );
}

export async function resolvePublishedComponents(
  home: string,
  document: ShowDocument,
  projectId?: string,
): Promise<PublishedComponentLocator[]> {
  const dependencies = await resolveDocumentComponents(
    home,
    document,
    projectId,
  );
  const published = new Map(
    (await listPublishedComponents(home)).map((locator) => [
      publicationRefKey(locator.ref),
      locator,
    ]),
  );
  const missing: string[] = [];
  const resolved: PublishedComponentLocator[] = [];
  for (const component of dependencies) {
    const key = publicationRefKey({
      kind: "component",
      id: component.id,
      version: component.version,
      integrity: component.integrity,
    });
    const locator = published.get(key);
    if (locator) resolved.push(locator);
    else missing.push(key);
  }
  if (missing.length)
    throw new Error(
      `Remote export requires verified immutable publications. Unpublished dependencies:\n${missing.map((ref) => `- ${ref}`).join("\n")}`,
    );
  return resolved;
}

export function verifyPublication(
  home: string,
  input: { manifestUrl: string; projectId?: string },
): Promise<VerifiedPublication> {
  return mutateLibrary(home, () => verifyPublicationImpl(home, input), {
    ...changeContext(),
    message: changeContext().message ?? "Verify published packages",
  });
}
