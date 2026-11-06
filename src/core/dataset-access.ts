import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { CoreError } from "./model";

interface DatasetAccess {
  root: string;
  read: Set<string>;
  write: Set<string>;
}
const access = new AsyncLocalStorage<DatasetAccess>();
/** Recursive transforms and cross-project bindings inherit the external caller's policy. */
export function withDatasetAccess<T>(
  policy: DatasetAccess,
  operation: () => Promise<T>,
) {
  return access.run({ ...policy, root: resolve(policy.root) }, operation);
}
export function assertDatasetAccess(
  root: string,
  projectId: string,
  write = false,
) {
  const policy = access.getStore();
  if (
    policy &&
    (resolve(root) !== policy.root ||
      !(write ? policy.write : policy.read).has(projectId))
  )
    throw new CoreError(
      "INVALID_PATH",
      "This dataset project is outside the remote connection's permissions.",
    );
}
