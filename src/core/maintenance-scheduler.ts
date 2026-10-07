import { IndexClient } from "./index-client";
import { versionedLibrary } from "./library-runtime";
import { LibraryMaintenance } from "./library-maintenance";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { join } from "node:path";
import { CoreError } from "./model";
export interface MaintenancePolicy {
  automatic: boolean;
  idleMs: number;
  intervalMs: number;
  minimumPacks: number;
  minimumLooseObjects: number;
  minimumLooseBytes: number;
}
const defaults: MaintenancePolicy = {
  automatic: true,
  idleMs: 15000,
  intervalMs: 60000,
  minimumPacks: 64,
  minimumLooseObjects: 1024,
  minimumLooseBytes: 32 * 1024 * 1024,
};
function checked(value: MaintenancePolicy): MaintenancePolicy {
  if (
    typeof value.automatic !== "boolean" ||
    Object.entries(value).some(
      ([name, field]) =>
        name !== "automatic" &&
        (!Number.isSafeInteger(field) || (field as number) < 0),
    )
  )
    throw new CoreError(
      "INVALID_DATA",
      "Invalid automatic maintenance policy.",
    );
  return value;
}
export async function maintenancePolicy(root: string) {
  const bytes = await readLibraryBytes(
    root,
    join(root, "local", "maintenance-policy.json"),
  );
  return bytes
    ? checked({ ...defaults, ...JSON.parse(bytes.toString("utf8")) })
    : { ...defaults };
}
export async function setMaintenancePolicy(
  root: string,
  update: Partial<MaintenancePolicy>,
) {
  const policy = checked({ ...(await maintenancePolicy(root)), ...update });
  await atomicLibraryFile(
    root,
    join(root, "local", "maintenance-policy.json"),
    Buffer.from(JSON.stringify(policy)),
  );
  return policy;
}
/** Persistent hosts compact only after observed idle time; short CLI calls stay synchronous. */
export class MaintenanceScheduler {
  private lastHead: string | null | undefined;
  private changedAt = Date.now();
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  constructor(
    readonly root: string,
    readonly onError: (error: unknown) => void = (error) =>
      console.error("ShowAI library maintenance:", error),
  ) {}
  markActivity() {
    this.changedAt = Date.now();
  }
  async tick() {
    const library = versionedLibrary(this.root);
    if (!library || this.stopped) return;
    const policy = await maintenancePolicy(this.root);
    if (!policy.automatic) return;
    const head = await library.head();
    if (head !== this.lastHead) {
      this.lastHead = head;
      this.changedAt = Date.now();
    }
    if (!head || Date.now() - this.changedAt < policy.idleMs) return;
    await new IndexClient(this.root).synchronize();
    if (this.stopped || Date.now() - this.changedAt < policy.idleMs) return;
    const objects = await library.objectStatistics();
    if (
      objects.packs < policy.minimumPacks &&
      objects.looseObjects < policy.minimumLooseObjects &&
      objects.looseBytes < policy.minimumLooseBytes
    )
      return;
    await new LibraryMaintenance(this.root).compact();
  }
  start() {
    const schedule = async () => {
      if (this.stopped) return;
      const policy = await maintenancePolicy(this.root);
      this.timer = setTimeout(
        () => {
          this.pending = this.tick()
            .catch(this.onError)
            .finally(() => {
              this.pending = undefined;
              void schedule().catch(this.onError);
            });
        },
        Math.max(policy.intervalMs, 50),
      );
      this.timer.unref?.();
    };
    void schedule().catch(this.onError);
    return this;
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
  }
}
