import { PureEditorContent } from "@tiptap/react";

export class RetainedEditorContent extends PureEditorContent {
  init() {
    const editor = this.props.editor;
    const host = this.editorContentRef.current as HTMLElement | null;
    const mounted = editor as typeof editor & { contentComponent?: unknown };
    if (editor && !editor.isDestroyed && host && mounted?.contentComponent) {
      const owner = editor.view.dom.parentElement;
      if (owner && owner !== host) {
        if (owner.isConnected)
          throw new Error(
            "A retained editor cannot occupy two connected hosts.",
          );
        host.append(...owner.childNodes);
        editor.setOptions({ element: host });
      }
      return;
    }
    super.init();
  }

  componentWillUnmount() {
    const host = this.editorContentRef.current as HTMLElement | null;
    const editor = this.props.editor;
    queueMicrotask(() => {
      if (host && !host.isConnected && editor?.options.element === host)
        super.componentWillUnmount();
    });
  }
}
