/** Runs inside an opaque sandbox. Only pointer coordinates cross the boundary;
 * component code, DOM, and editing data stay in the sandbox. */
export function installComponentSelectionBridge(channel: string) {
  const excluded =
    'button,input,textarea,select,summary,[role="button"],[role="slider"],[data-surface-ui],.react-flow,[data-surface-gesture="own"]';
  const sendText = () => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(excluded + ",script,style,[hidden]")
      .forEach((node) => node.remove());
    clone
      .querySelectorAll(
        "p,div,section,article,li,tr,h1,h2,h3,h4,pre,blockquote",
      )
      .forEach((node) => node.append("\n"));
    clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    parent.postMessage(
      {
        channel,
        type: "showai:text-selection-content",
        text: (clone.textContent ?? "").slice(0, 256_000),
      },
      "*",
    );
  };
  window.addEventListener("message", (event) => {
    if (
      event.source === parent &&
      event.data?.channel === channel &&
      event.data.type === "showai:text-selection-content-request"
    )
      sendText();
  });
  const send = (phase: string, event: PointerEvent) =>
    parent.postMessage(
      {
        channel,
        type: "showai:text-selection-pointer",
        phase,
        x: event.clientX,
        y: event.clientY,
        width: innerWidth,
        height: innerHeight,
        buttons: event.buttons,
      },
      "*",
    );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        event.pointerType !== "mouse" ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        !(event.target instanceof Element) ||
        event.target.closest(excluded)
      )
        return;
      const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (
        caret?.startContainer.nodeType !== Node.TEXT_NODE ||
        !event.target.contains(caret.startContainer)
      )
        return;
      sendText();
      send("down", event);
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "mouse" && event.buttons & 1)
        send("move", event);
    },
    true,
  );
  document.addEventListener("pointerup", (event) => send("up", event), true);
  document.addEventListener(
    "pointercancel",
    (event) => send("cancel", event),
    true,
  );
}
