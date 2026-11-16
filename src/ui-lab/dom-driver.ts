import {
  getByRole,
  getByText,
  getByTestId,
  waitFor,
  queryByRole,
} from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import type { UiDriver, UiTarget } from "./types";

export function domDriver(document: Document): UiDriver {
  const user = userEvent.setup({ document });
  function root(target: UiTarget): HTMLElement {
    return target.within ? locate(target.within) : document.body;
  }
  function locate(target: UiTarget): HTMLElement {
    const container = root(target);
    if (target.role)
      return getByRole(container, target.role, {
        name: target.name,
      });
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
        if (
          !element.getClientRects().length ||
          getComputedStyle(element).visibility === "hidden"
        )
          throw new Error("Target is not visible.");
        return element;
      },
      { timeout: 15000, container: document.body },
    );
  }
  return {
    async click(target) {
      await user.click(await visible(target));
    },
    async fill(target, value) {
      const element = await visible(target);
      await user.clear(element);
      await user.type(element, value);
    },
    async select(target, value) {
      await user.selectOptions(await visible(target), value);
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
            if (element?.getClientRects().length)
              throw new Error("Target is still visible.");
            return;
          }
          const element = locate(target);
          if (!element.getClientRects().length)
            throw new Error("Target is not visible.");
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
