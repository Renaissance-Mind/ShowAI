import { randomUUID } from "node:crypto";
import { withChangeContext } from "../core/history-context";
import { mutateLibrary } from "../core/library-runtime";
import { readOnboarding, writeOnboarding } from "../core/onboarding";
import type { SampleState } from "../core/onboarding";
import { parseArtifact } from "../portable/validation.mjs";
import { AgentService } from "./service";

export interface SampleProjectInput {
  name: string;
  icon?: string;
  locale: string;
  /** Page sources in the order they appear in the project. */
  pages: { key: string; artifact: string }[];
}

const running = new Map<string, Promise<SampleState | null>>();

/**
 * Creates the sample project of a newly created library exactly once.
 * Pages and their component dependencies are written in one library change,
 * so a failed import leaves no partial project behind.
 */
export function seedSampleProject(
  root: string,
  input: SampleProjectInput,
): Promise<SampleState | null> {
  const current = running.get(root);
  if (current) return current;
  const work = seed(root, input).finally(() => running.delete(root));
  running.set(root, work);
  return work;
}

async function seed(root: string, input: SampleProjectInput) {
  const onboarding = await readOnboarding(root);
  if (onboarding?.samples.state !== "pending")
    return onboarding?.samples ?? null;
  if (
    typeof input.name !== "string" ||
    typeof input.locale !== "string" ||
    !Array.isArray(input.pages) ||
    !input.pages.length ||
    input.pages.length > 10 ||
    input.pages.some(
      (page) =>
        typeof page?.key !== "string" || typeof page.artifact !== "string",
    )
  )
    throw new Error("Invalid sample project input.");
  // Parse everything before the state changes, so invalid input stays retryable.
  const artifacts = input.pages.map((page) => ({
    key: page.key,
    ...parseArtifact(page.artifact),
  }));
  await writeOnboarding(root, {
    state: "seeding",
    startedAt: new Date().toISOString(),
  });
  const service = new AgentService({ root });
  const context = {
    actor: { kind: "system" as const },
    channel: "system" as const,
    operationId: randomUUID(),
    message: "Create sample project",
  };
  try {
    const result = await withChangeContext(context, () =>
      mutateLibrary(
        root,
        async () => {
          const project = await service.createProject(
            input.name,
            undefined,
            input.icon,
          );
          const pages: Record<string, string> = {};
          // Newest first is the default page order, so the first sample is created last.
          for (const artifact of [...artifacts].reverse()) {
            const page = await service.createPage(project.id, {
              document: { ...artifact.document, parentId: null },
              components: artifact.components ?? [],
            });
            pages[artifact.key] = page.document.id;
          }
          return { projectId: project.id, pages };
        },
        context,
      ),
    );
    const seeded: SampleState = {
      state: "seeded",
      ...result,
      locale: input.locale,
      seededAt: new Date().toISOString(),
    };
    await writeOnboarding(root, seeded);
    return seeded;
  } catch (error) {
    // Failed sample content is reported once instead of retried on every launch.
    const failed: SampleState = {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
      failedAt: new Date().toISOString(),
    };
    await writeOnboarding(root, failed);
    return failed;
  }
}
