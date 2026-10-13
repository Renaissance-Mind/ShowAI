import { expect, test } from "vitest";
import { latestTemplateVersions } from "./template-catalog-model";
import type { TemplateMetadata } from "../components/custom/types";

test("latest cards retain scopes and conflicting identities, and prefer stable numeric versions", () => {
  const items = [
    { id: "same", scope: "builtin", version: "2.0.0", integrity: "a" },
    { id: "same", scope: "builtin", version: "10.0.0-beta", integrity: "b" },
    { id: "same", scope: "builtin", version: "10.0.0", integrity: "c" },
    { id: "same", scope: "builtin", version: "10.0.0", integrity: "d" },
    { id: "same", scope: "project", version: "1.0.0", integrity: "e" },
  ] as TemplateMetadata[];
  expect(latestTemplateVersions(items).map((item) => item.integrity)).toEqual([
    "c",
    "d",
    "e",
  ]);
});
