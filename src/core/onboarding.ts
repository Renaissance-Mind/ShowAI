import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { atomicRename } from "./atomic-rename";

/**
 * First-run state of one content library. It lives in the library's local
 * state, so it never syncs and never changes project history.
 *
 * Only a library created by `openLibrary` is marked `pending`; libraries that
 * existed before have no file and are never given sample content. Once the
 * samples were created (or creation failed), the state never returns to
 * `pending`, so a deleted sample project does not come back.
 */
export type SampleState =
  | { state: "pending"; markedAt: string }
  | { state: "seeding"; startedAt: string }
  | {
      state: "seeded";
      projectId: string;
      locale: string;
      /** Sample key → page ID in the sample project. */
      pages: Record<string, string>;
      seededAt: string;
    }
  | { state: "failed"; error: string; failedAt: string };

export interface OnboardingState {
  format: "showai-onboarding";
  version: 1;
  samples: SampleState;
}

export const onboardingPath = (root: string) =>
  join(root, "local", "onboarding.json");

export async function readOnboarding(
  root: string,
): Promise<OnboardingState | null> {
  const text = await readFile(onboardingPath(root), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (text === null) return null;
  const value = JSON.parse(text) as OnboardingState;
  if (
    value.format !== "showai-onboarding" ||
    value.version !== 1 ||
    !value.samples ||
    !["pending", "seeding", "seeded", "failed"].includes(value.samples.state)
  )
    throw new Error("Invalid library onboarding state.");
  return value;
}

export async function writeOnboarding(root: string, samples: SampleState) {
  const path = onboardingPath(root);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const value: OnboardingState = {
    format: "showai-onboarding",
    version: 1,
    samples,
  };
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await atomicRename(temporary, path);
}

/** Marks a newly created library once; an existing state is never replaced. */
export async function markNewLibrary(root: string) {
  const path = onboardingPath(root);
  await mkdir(dirname(path), { recursive: true });
  const value: OnboardingState = {
    format: "showai-onboarding",
    version: 1,
    samples: { state: "pending", markedAt: new Date().toISOString() },
  };
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
