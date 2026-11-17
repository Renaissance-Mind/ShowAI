import {
  getByRole,
  getByText,
  getByTestId,
  waitFor,
  queryByRole,
  queryAllByRole,
  queryAllByLabelText,
  queryAllByTestId,
  queryAllByText,
} from "@testing-library/dom";
import type { UiDriver, UiTarget } from "./types";

function rendered(element: HTMLElement) {
  return (
    element.getClientRects().length > 0 &&
    element.checkVisibility({ visibilityProperty: true })
  );
}

export function queryUiTarget(
  document: Document,
  target: UiTarget,
): HTMLElement | undefined {
  const container = target.within
    ? queryUiTarget(document, target.within)
    : document.body;
  if (!container) return undefined;
  let elements: HTMLElement[];
  if (target.role) {
    elements = queryAllByRole(container, target.role, { name: target.name });
    if (!elements.length && target.role === "textbox" && target.name)
      elements = queryAllByLabelText(container, target.name).filter((element) =>
        element.matches("input,textarea"),
      );
  } else if (target.testId)
    elements = queryAllByTestId(container, target.testId);
  else if (target.selector)
    elements = [
      ...container.querySelectorAll<HTMLElement>(target.selector),
    ].filter(
      (element) =>
        !target.name ||
        element.textContent?.trim() === target.name ||
        element.getAttribute("aria-label") === target.name,
    );
  else if (target.name)
    elements = queryAllByText(container, target.name, { exact: true });
  else return undefined;
  return elements.find(rendered);
}

export function domDriver(document: Document): UiDriver {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  function view() {
    if (!document.defaultView) throw new Error("The UI session was closed.");
    return document.defaultView;
  }
  function changed(element: HTMLElement) {
    const window = view();
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  function root(target: UiTarget): HTMLElement {
    return target.within ? locate(target.within) : document.body;
  }
  function locate(target: UiTarget): HTMLElement {
    const container = root(target);
    if (target.role)
      return (
        (target.role === "textbox"
          ? queryUiTarget(document, target)
          : undefined) ??
        getByRole(container, target.role, {
          name: target.name,
        })
      );
    if (target.testId) return getByTestId(container, target.testId);
    if (target.selector) {
      const elements = [
        ...container.querySelectorAll<HTMLElement>(target.selector),
      ].filter(
        (element) =>
          !target.name ||
          element.textContent?.trim() === target.name ||
          element.getAttribute("aria-label") === target.name,
      );
      if (elements.length !== 1)
        throw new Error(
          `Expected one target, found ${elements.length}: ${JSON.stringify(target)}`,
        );
      return elements[0];
    }
    if (target.name) return getByText(container, target.name, { exact: true });
    throw new Error("UI target requires a role, test ID or selector.");
  }
  async function visible(target: UiTarget) {
    return waitFor(
      () => {
        const element = locate(target);
        if (!rendered(element)) throw new Error("Target is not visible.");
        return element;
      },
      { timeout: 15000, container: document.body },
    );
  }
  return {
    async click(target) {
      const element = await visible(target);
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (
        element.matches(":disabled") ||
        element.getAttribute("aria-disabled") === "true"
      )
        throw new Error("The control is disabled.");
      element.focus({ preventScroll: true });
      element.click();
      await settle();
    },
    async fill(target, value) {
      const element = await visible(target);
      const window = view();
      if (
        !(element instanceof window.HTMLInputElement) &&
        !(element instanceof window.HTMLTextAreaElement)
      )
        throw new Error("The target is not a form text field.");
      if (element.disabled || element.readOnly)
        throw new Error("The text field is not editable.");
      const prototype =
        element instanceof window.HTMLInputElement
          ? window.HTMLInputElement.prototype
          : window.HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        element,
        value,
      );
      changed(element);
      await settle();
    },
    async select(target, value) {
      const element = await visible(target),
        window = view();
      if (!(element instanceof window.HTMLSelectElement) || element.disabled)
        throw new Error("The target is not an enabled select field.");
      if (
        ![...element.options].some(
          (option) => option.value === value && !option.disabled,
        )
      )
        throw new Error("The select option is unavailable.");
      element.value = value;
      changed(element);
      await settle();
    },
    async expect(target, state = "visible") {
      await waitFor(
        () => {
          if (state === "hidden") {
            const element = target.role
              ? queryByRole(root(target), target.role, {
                  name: target.name,
                })
              : (() => {
                  try {
                    return locate(target);
                  } catch {
                    return null;
                  }
                })();
            if (element && rendered(element))
              throw new Error("Target is still visible.");
            return;
          }
          const element = locate(target);
          if (!rendered(element)) throw new Error("Target is not visible.");
          const disabled =
            (element as HTMLButtonElement).disabled ||
            element.getAttribute("aria-disabled") === "true";
          if (
            (state === "enabled" && disabled) ||
            (state === "disabled" && !disabled)
          )
            throw new Error(`Unexpected disabled state: ${state}`);
        },
        { timeout: 15000, container: document.body },
      );
    },
  };
}
