import { Activity, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { RetainedEditorContent } from "../../components/rich-text/RetainedEditorContent";
import {
  WorkspaceEditors,
  WorkspaceEditorContext,
  useWorkspaceEditor,
} from "../workspace-editor";

function Probe() {
  const [count, setCount] = useState(0);
  return (
    <NodeViewWrapper>
      <button onClick={() => setCount(count + 1)}>
        Node view count {count}
      </button>
      <iframe
        title="Retained frame"
        srcDoc={'<input aria-label="Frame draft" value="original">'}
      />
    </NodeViewWrapper>
  );
}
const ProbeNode = Node.create({
  name: "hostProbe",
  group: "block",
  atom: true,
  selectable: false,
  renderHTML: () => ["section"],
  addNodeView: () => ReactNodeViewRenderer(Probe),
});
const extensions = [StarterKit, ProbeNode];
function Content({ scope }: { scope: string }) {
  const editor = useWorkspaceEditor({
    retentionKey: "same-page",
    extensions,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `Saved ${scope} Page content` }],
        },
        { type: "hostProbe" },
      ],
    },
  });
  const [report, setReport] = useState("");
  return (
    <>
      <RetainedEditorContent data-editor-scope={scope} editor={editor} />
      <button
        onClick={() =>
          setReport(
            JSON.stringify({
              selection: editor?.state.selection.toJSON(),
              text: editor?.state.doc.textContent,
              destroyed: editor?.isDestroyed,
            }),
          )
        }
      >
        Inspect Editor {scope}
      </button>
      <output>{report}</output>
    </>
  );
}
function Scope({ name }: { name: string }) {
  const [host, setHost] = useState("embedded"),
    [visible, setVisible] = useState(true),
    [editors] = useState(() => new WorkspaceEditors());
  return (
    <section data-scope={name}>
      <WorkspaceEditorContext.Provider value={editors}>
        <button
          onClick={() => setHost(host === "embedded" ? "expanded" : "embedded")}
        >
          Switch Page host {name}
        </button>
        <button onClick={() => setVisible(!visible)}>
          Toggle Activity {name}
        </button>
        <Activity mode={visible ? "visible" : "hidden"}>
          <section key={host} data-host={host}>
            <h1>
              {name} {host}
            </h1>
            <Content scope={name} />
          </section>
        </Activity>
      </WorkspaceEditorContext.Provider>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Scope name="A" />
    <Scope name="B" />
  </StrictMode>,
);
