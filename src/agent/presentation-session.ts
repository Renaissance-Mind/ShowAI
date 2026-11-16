import { applyOperations } from "../core/diff";
import type { PageOperation } from "../core/model";
import { parseArtifact } from "../portable/validation.mjs";
import { assertJsonValue, assertProps } from "../contract/schema";
import { walk } from "../document/walk.mjs";
import type { ShowArtifact } from "../types";
import { CoreError } from "../core/model";
import type { ComponentSource } from "../contract/types";
import { assertContent } from "../portable/capacity.mjs";

export const MAX_LIVE_SOURCE_BYTES = 16 * 1024 * 1024;
function limitSource(source: string) {
  if (Buffer.byteLength(source) > MAX_LIVE_SOURCE_BYTES)
    throw new CoreError(
      "INVALID_DATA",
      "Live presentation source exceeds 16 MiB. Use ordinary presentation for larger content.",
    );
}

export interface PresentationSessionUpdate {
  operationId: string;
  baseRevision: number;
  operations: PageOperation[];
  complete?: boolean;
}

export interface PresentationSessionSnapshot {
  viewId: string;
  revision: number;
  source: string;
  complete: boolean;
}

function validated(source: string): ShowArtifact {
  limitSource(source);
  const artifact = parseArtifact(source) as ShowArtifact;
  if (artifact.remoteComponents?.length)
    throw new Error(
      "Live presentations require bundled component dependencies.",
    );
  walk(
    artifact.document.content,
    (node) => {
      if (node.attrs?.data && Object.hasOwn(node.attrs.data, "$binding"))
        throw new CoreError(
          "INVALID_DATA",
          "Live presentations need resolved data. Use a saved Page for shared dataset bindings.",
        );
      if (
        !["widget", "inlineWidget"].includes(node.type ?? "") ||
        node.attrs?.kind !== "custom"
      )
        return;
      const ref = node.attrs.data;
      const component = artifact.components?.find(
        (candidate) =>
          candidate.id === ref.componentId &&
          candidate.version === ref.version &&
          candidate.integrity === ref.integrity,
      );
      if (!component)
        throw new Error(
          "Live component revision is not bundled in this presentation.",
        );
      assertProps(component.schema, ref.props, component.documentation);
    },
    { scope: "content" },
  );
  return artifact;
}

export class PresentationSession {
  private closed = false;
  private current: PresentationSessionSnapshot;
  private last: { id: string; input: string } | undefined;
  private readonly componentSources?: ComponentSource[];

  constructor(viewId: string, source: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(viewId))
      throw new Error("Invalid presentation viewId.");
    const artifact = validated(source);
    this.componentSources = JSON.parse(source).componentSources;
    this.current = Object.freeze({
      viewId,
      revision: 0,
      source: this.serialize(artifact),
      complete: false,
    });
  }

  private serialize(artifact: ShowArtifact) {
    const source = JSON.stringify({
      ...artifact,
      ...(this.componentSources
        ? { componentSources: this.componentSources }
        : {}),
    });
    limitSource(source);
    return source;
  }

  snapshot(): PresentationSessionSnapshot {
    return this.current;
  }

  close(): void { this.closed = true; }

  apply(input: PresentationSessionUpdate): PresentationSessionSnapshot {
    return this.prepare(input).commit();
  }

  prepare(input: PresentationSessionUpdate): {
    snapshot: PresentationSessionSnapshot;
    commit: (source?: string) => PresentationSessionSnapshot;
  } {
    if (this.closed) throw new CoreError("READ_ONLY", "Presentation is closed.");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new CoreError(
        "INVALID_DATA",
        "Presentation update must be an object.",
      );
    assertJsonValue(input);
    assertContent(input, "Presentation update", MAX_LIVE_SOURCE_BYTES);
    for (const key of Object.keys(input))
      if (
        !["operationId", "baseRevision", "operations", "complete"].includes(key)
      )
        throw new CoreError(
          "INVALID_DATA",
          `Unknown presentation update field: ${key}.`,
        );
    if (
      !input.operationId ||
      typeof input.operationId !== "string" ||
      input.operationId.length > 128
    )
      throw new Error(
        "Presentation update needs an operationId of at most 128 characters.",
      );
    if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0)
      throw new Error("Presentation update needs a nonnegative baseRevision.");
    if (!Array.isArray(input.operations) || input.operations.length > 100)
      throw new Error("Presentation update needs at most 100 operations.");
    if (input.complete !== undefined && typeof input.complete !== "boolean")
      throw new Error("Presentation complete must be boolean.");
    const serialized = JSON.stringify(input);
    if (this.last?.id === input.operationId) {
      if (this.last.input !== serialized)
        throw new Error(
          "Presentation operationId was reused with different input.",
        );
      const snapshot = this.current;
      return { snapshot, commit: () => snapshot };
    }
    if (input.baseRevision !== this.current.revision) {
      const error = new CoreError(
        "CONFLICT",
        "Presentation revision conflict.",
        { currentRevision: String(this.current.revision) },
      );
      error.nextStep =
        "Call show_component_read for this viewId, compare the current source, and revise the intended operations.";
      throw error;
    }
    if (this.current.complete)
      throw new CoreError(
        "READ_ONLY",
        "Presentation is complete. Create a new live view to continue editing.",
      );
    const baseline = this.current;
    const operationId = input.operationId;
    const artifact = validated(baseline.source);
    artifact.document = applyOperations(artifact.document, input.operations);
    const next = validated(JSON.stringify(artifact));
    const snapshot = Object.freeze({
      viewId: this.current.viewId,
      revision: this.current.revision + 1,
      source: this.serialize(next),
      complete: input.complete === true,
    });
    return {
      snapshot,
      commit: (source = snapshot.source) => {
        if (this.closed) throw new CoreError("READ_ONLY", "Presentation is closed.");
        if (this.current !== baseline) {
          if (this.last?.id === operationId && this.last.input === serialized) return this.current;
          throw new CoreError("CONFLICT", "Presentation changed while preparing its resources.", { currentRevision: String(this.current.revision) });
        }
        const committed = Object.freeze({ ...snapshot, source: this.serialize(validated(source)) });
        this.current = committed;
        this.last = { id: operationId, input: serialized };
        return committed;
      },
    };
  }
}
