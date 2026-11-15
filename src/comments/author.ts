import { useEffect, useState } from "react";
import { desktop } from "../host/bridge";
import type { CommentAuthor } from "../types";

interface SyncStatus {
  defaultConnectionId: string | null;
  connections: { id: string; user?: { id: string; name: string } }[];
  projects: { projectId: string; connectionId: string }[];
}

let status: Promise<SyncStatus> | undefined;

export function useCommentAuthor(projectId?: string): CommentAuthor {
  const [author, setAuthor] = useState<CommentAuthor>({ kind: "person" });
  useEffect(() => {
    if (!window.showai) return;
    status ??= desktop.invoke<SyncStatus>("sync:status");
    let live = true;
    void status.then(
      (value) => {
        const connectionId =
          value.projects.find((item) => item.projectId === projectId)
            ?.connectionId ?? value.defaultConnectionId;
        const user = value.connections.find(
          (connection) => connection.id === connectionId,
        )?.user;
        if (live)
          setAuthor(
            user ? { kind: "person", id: user.id, name: user.name } : { kind: "person" },
          );
      },
      (error) => {
        status = undefined;
        console.warn("Comment author unavailable", error);
      },
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  return author;
}
