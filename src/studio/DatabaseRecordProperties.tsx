import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "../core/model";
import { validateProjectDatabaseData } from "../core/project-database";
import { useDatasetSnapshot, workbenchDatasetClient } from "../datasets/react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/databasePeek";
import { databaseCellOperations } from "./project-database-view";
import { DatabasePropertyCell } from "./DatabaseProject";
import { errorMessage } from "./bridge";

/** The peek and every database view edit the same dataset session. */
export default function DatabaseRecordProperties({
  project,
  pageId,
  readOnly,
}: {
  project: ProjectSummary;
  pageId: string;
  readOnly: boolean;
}) {
  const t = useTranslator(messages);
  const client = workbenchDatasetClient();
  const session = useMemo(
    () =>
      project.database && client
        ? client.session(project.id, project.database.datasetId)
        : undefined,
    [client, project.id, project.database?.datasetId],
  );
  useEffect(
    () => (session && client ? client.retain(session) : undefined),
    [client, session],
  );
  const snapshot = useDatasetSnapshot(session);
  const [error, setError] = useState("");
  const data = useMemo(() => {
    if (snapshot?.status !== "ready") return null;
    try {
      return validateProjectDatabaseData(snapshot.value);
    } catch {
      return null;
    }
  }, [snapshot?.status, snapshot?.value]);
  if (!data)
    return (
      <p className="database-peek-property-error">
        {snapshot?.error || t("propertyError")}
      </p>
    );
  const row = data.rows.find((item) => item.id === pageId);
  const locked = readOnly || !!snapshot?.readOnly;
  return (
    <section
      className="database-record-properties project-database"
      aria-label={t("properties")}
    >
      {data.columns.map((column) => (
        <div key={column.id} className="database-record-property">
          <span>{column.name}</span>
          <div>
            <DatabasePropertyCell
              column={column}
              label={`${column.name} · ${t("properties")}`}
              value={row?.[column.id]}
              locked={locked}
              update={(value, before) => {
                if (!session || locked) return;
                try {
                  const current = validateProjectDatabaseData(
                    session.getSnapshot().value,
                  );
                  if (
                    current.columns.find((item) => item.id === column.id)
                      ?.type !== column.type
                  )
                    throw new Error(t("propertyError"));
                  session.edit(
                    databaseCellOperations(
                      current,
                      pageId,
                      column.id,
                      value,
                      before,
                    ),
                  );
                  setError("");
                } catch (reason) {
                  setError(errorMessage(reason));
                }
              }}
            />
          </div>
        </div>
      ))}
      {error && (
        <p className="database-peek-property-error" role="alert">
          {error}
        </p>
      )}
      {(snapshot?.error || !!snapshot?.conflicts.length) && (
        <p className="database-peek-property-error" role="alert">
          {snapshot.error || t("propertyConflict")}
        </p>
      )}
    </section>
  );
}
