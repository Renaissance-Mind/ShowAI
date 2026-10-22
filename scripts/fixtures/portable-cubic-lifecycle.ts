import {
  createPageSession,
  type LoadedPage,
} from "../../src/studio/page-session";
import { sourceSessionFor } from "../../src/surface/source-client";
import { PortableInputScope } from "../../src/surface/portable-input-scope";
import { appendNewPortableInk } from "../../src/surface/portable-ink-append.mjs";

/** Executes only inside an explicit acceptance fixture, against the actual
 * installed browser bridge/backend and real independently owned Workers. */
export async function pendingLifecycle(
  projectId: string,
  kind: "leave" | "clear" | "dispose" | "switch",
) {
  const invoke = <T>(action: string, args: Record<string, unknown> = {}) =>
    window.showai!.invoke<T>(action, args);
  const initial = await invoke<LoadedPage>("pages:create", {
    projectId,
    title: `pending ${kind}`,
    kind: "board",
  });
  const second =
    kind === "switch"
      ? await invoke<LoadedPage>("pages:create", {
          projectId,
          title: "switch target",
          kind: "board",
        })
      : undefined;
  const clientId = `pending-${kind}-${crypto.randomUUID()}`,
    session = createPageSession({
      invoke,
      clientId,
      saveDelayMs: 50,
      draftDelayMs: 20,
    });
  if (!(await session.open(projectId, initial.document.id, initial)))
    throw new Error("Actual pending page failed to open");
  const owner = sourceSessionFor(session.getSnapshot().draft!)!;
  if (!owner) throw new Error("Actual source owner missing");
  const scope = new PortableInputScope(() => {
    session.edit(owner.document!);
    return {
      complete: async (value) => {
        session.edit(
          owner.replace(
            appendNewPortableInk(
              owner.document!,
              initial.document.content.attrs!.id,
              value.node,
              value.frame,
            ),
          ),
        );
      },
      fail: () => {},
    };
  }, owner);
  const options = {
    strokeId: crypto.randomUUID(),
    pageId: initial.document.id,
    boardId: initial.document.content.attrs!.id,
    tool: "pen" as const,
    color: "#111111",
    width: 3,
    pressure: true,
    creationZoom: 1,
    origin: { x: 0, y: 0 },
    name: "Actual pending input",
  };
  const contact = scope.begin(options, {
    actual: Array.from({ length: 2001 }, (_, i) => ({
      id: i + 1,
      x: i * 0.1,
      y: Math.sin(i / 25),
      time: i / 120,
      force: 0.7,
    })),
    predicted: [],
  });
  if (kind === "dispose") contact.finish();
  if (!scope.hasContacts)
    throw new Error(
      "Fixture must enter lifecycle while actual worker input is pending",
    );
  if (kind === "leave") {
    if (!(await session.leave())) throw new Error("Pending leave failed");
  } else if (kind === "clear") {
    if (!(await session.clear())) throw new Error("Pending clear failed");
  } else if (kind === "switch") {
    if (!(await session.open(projectId, second!.document.id, second)))
      throw new Error("Pending page switch failed");
  } else await session.dispose();
  let durable: any;
  if (kind === "leave" || kind === "dispose") {
    const drafts = await invoke<any[]>("drafts:list", {
      kind: "page",
      projectId,
      resourceId: initial.document.id,
    });
    const saved = drafts.find((draft) => draft.clientId === clientId);
    if (!saved)
      throw new Error("Accepted source has no actual durable recovery head");
    durable = (await invoke<any>("drafts:read", { id: saved.id })).content;
  } else
    durable = (
      await invoke<LoadedPage>("pages:get", {
        projectId,
        pageId: initial.document.id,
      })
    ).document;
  const drawing = durable.content.content.find(
    (node: any) => node.attrs?.id === options.strokeId,
  );
  if (
    drawing?.attrs?.ink?.format !== "showai-ink-v2" ||
    drawing.attrs.ink.capture.raw.length !== 2001
  )
    throw new Error("Actual pending raw source was lost at lifecycle barrier");
  if (
    kind === "switch" &&
    session.getSnapshot().draft?.id !== second!.document.id
  )
    throw new Error("Old accepted callback replaced the new page");
  await scope.close();
  await session.dispose();
  return {
    kind,
    pageId: initial.document.id,
    strokeId: options.strokeId,
    raw: drawing.attrs.ink.capture.raw.length,
    durable:
      kind === "leave" || kind === "dispose"
        ? "actual recovery draft"
        : "formal CAS page",
  };
}
(window as any).__cubicPendingLifecycle = pendingLifecycle;
