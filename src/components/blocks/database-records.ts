import { parsePageCell } from "./database-contract.mjs";
import type { DatabaseRow } from "./types";

/** Keep the visible row order and identity, including separate records linking to one page. */
export function databaseRecordTargets(rows: DatabaseRow[], column: string) {
  return rows.flatMap((row) => {
    const target = parsePageCell(row[column]);
    return target ? [{ ...target, recordId: row.id }] : [];
  });
}
