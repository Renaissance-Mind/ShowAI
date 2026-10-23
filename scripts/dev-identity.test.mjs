import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { identityRefresher } from "./dev-identity.mjs";

const interrupted = () =>
  Object.assign(new Error("uv_cwd"), { code: "EINTR", syscall: "uv_cwd" });

test("identity refresh retries transient git failures without throwing", async () => {
  const logs = [];
  const applied = [];
  let failures = 2;
  const refresher = identityRefresher({
    read: () => {
      if (failures-- > 0) throw interrupted();
      return { branch: "main", commit: "abc" };
    },
    apply: (identity) => applied.push(identity),
    log: (message) => logs.push(message),
    delay: 5,
  });
  assert.doesNotThrow(() => refresher.refresh());
  await wait(60);
  assert.deepEqual(applied, [{ branch: "main", commit: "abc" }]);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /EINTR/);
});

test("identity refresh gives up until the next change and stops when closed", async () => {
  const logs = [];
  let reads = 0;
  const refresher = identityRefresher({
    read: () => {
      reads++;
      throw interrupted();
    },
    apply: () => assert.fail("must not apply"),
    log: (message) => logs.push(message),
    retries: 2,
    delay: 2,
  });
  refresher.refresh();
  await wait(40);
  assert.equal(reads, 3);
  assert.match(logs.at(-1), /下次 Git 变化/);
  refresher.refresh();
  refresher.close();
  await wait(20);
  assert.equal(reads, 4);
});
