import { PureEditorContent } from "@tiptap/react";

/** Activity hides a connected editor and replays its lifecycle on tab switches.
 * Tiptap's default teardown destroys all node views, including live component
 * iframes. Only tear down after React actually removes the editor from the DOM.
 */
export class RetainedEditorContent extends PureEditorContent {
  componentWillUnmount() {
    const element = this.editorContentRef.current as HTMLElement | null;
    queueMicrotask(() => {
      if (!element?.isConnected) super.componentWillUnmount();
    });
  }
}
