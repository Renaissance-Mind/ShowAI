/**
 * Continuity for the workbench's shared surfaces. Menus, dialogs, popovers and
 * toasts unmount the moment their owner drops them. This layer watches those
 * removals once for the whole workbench: a removed overlay is replaced by an
 * inert snapshot that plays its exit. It is installed by the workbench only,
 * so the portable reader and exported pages carry none of it.
 */
import {
  exitKeyframes,
  motionDuration,
  motionToken,
  prefersReducedMotion,
  type ExitStyle,
} from "./motion";

interface ExitRule {
  selector: string;
  style: ExitStyle;
  /** The visible panel inside a backdrop, which pops while the backdrop fades. */
  panel?: { selector: string; style: ExitStyle };
  /** A new element of the same kind replaces a leaving one at once. */
  replaces?: boolean;
}

export const EXIT_RULES: readonly ExitRule[] = [
  {
    selector: ".studio-modal-shade",
    style: "fade",
    panel: { selector: ".studio-modal", style: "pop" },
    replaces: true,
  },
  {
    selector: ".editor-modal-backdrop",
    style: "fade",
    panel: { selector: ".editor-modal", style: "pop" },
    replaces: true,
  },
  { selector: ".studio-context-menu", style: "pop", replaces: true },
  { selector: ".studio-popover", style: "pop", replaces: true },
  { selector: ".comment-popover", style: "pop", replaces: true },
  { selector: ".dataset-warning-popover", style: "pop", replaces: true },
  { selector: ".assistant-switcher-popover", style: "drop", replaces: true },
  { selector: ".slash-menu", style: "drop", replaces: true },
  { selector: ".editor-small-menu", style: "drop", replaces: true },
  { selector: ".editor-bubble", style: "drop", replaces: true },
  { selector: ".canvas-menu", style: "drop", replaces: true },
  { selector: ".studio-toast", style: "rise" },
];

const GHOST = "data-exit-ghost";

/** The removed element itself, or the overlay inside a thin wrapper around it. */
export function findExit(node: Element) {
  let current: Element | null = node;
  for (let depth = 0; current && depth < 3; depth++) {
    const rule = EXIT_RULES.find((item) => current!.matches(item.selector));
    if (rule) return { rule, target: current };
    current =
      current.childElementCount === 1 ? current.firstElementChild : null;
  }
  return null;
}

/** A copy that looks like the removed element but takes no part in the page. */
function snapshot(element: Element) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.setAttribute(GHOST, "");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.style.pointerEvents = "none";
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    if (!node.closest("svg")) node.removeAttribute("id");
    node.removeAttribute("role");
    node.removeAttribute("aria-modal");
    node.removeAttribute("data-autofocus");
    node.removeAttribute("autofocus");
    // CSS entrance animations would replay on the copy.
    node.style.animation = "none";
    node.style.transition = "none";
  }
  return copy;
}

export class ExitLayer {
  private ghosts = new Map<ExitRule, Set<HTMLElement>>();

  constructor(private doc: Document) {}

  /** Plays the exit of an element that was just removed from `parent`. */
  exit(removed: Element, parent: Node, next: Node | null) {
    const found = findExit(removed);
    if (!found || !parent.isConnected) return;
    if (prefersReducedMotion(this.doc.defaultView!)) return;
    const ghost = snapshot(removed);
    const path = indexPath(removed, found.target);
    const target = followPath(ghost, path);
    parent.insertBefore(ghost, next?.parentNode === parent ? next : null);
    const options: KeyframeAnimationOptions = {
      duration: motionDuration("--duration-fast"),
      easing: motionToken("--ease-out"),
      fill: "forwards",
    };
    const animations = [target.animate(exitKeyframes(found.rule.style), options)];
    const panel = found.rule.panel;
    const inner = panel ? target.querySelector<HTMLElement>(panel.selector) : null;
    if (panel && inner)
      animations.push(inner.animate(exitKeyframes(panel.style), options));
    const set = this.ghosts.get(found.rule) ?? new Set();
    this.ghosts.set(found.rule, set);
    set.add(ghost);
    const remove = () => {
      ghost.remove();
      set.delete(ghost);
    };
    animations[0].finished.then(remove, remove);
  }

  /** A new menu or dialog of the same kind takes over from a leaving one. */
  replace(added: Element) {
    const rule = findExit(added)?.rule;
    if (!rule?.replaces) return;
    for (const ghost of this.ghosts.get(rule) ?? []) ghost.remove();
    this.ghosts.get(rule)?.clear();
  }
}

function indexPath(root: Element, target: Element) {
  const path: number[] = [];
  for (let node = target; node !== root; node = node.parentElement!)
    path.unshift([...node.parentElement!.children].indexOf(node));
  return path;
}

function followPath(root: HTMLElement, path: number[]) {
  let node: HTMLElement = root;
  for (const index of path) node = node.children[index] as HTMLElement;
  return node;
}

/** Installs exit snapshots for one workbench document. */
export function installWorkbenchMotion(doc: Document) {
  const exits = new ExitLayer(doc);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof Element) || node.hasAttribute(GHOST)) continue;
        // A node that React moved is connected again by now.
        if (!node.isConnected) exits.exit(node, record.target, record.nextSibling);
      }
      for (const node of record.addedNodes)
        if (node instanceof Element && !node.hasAttribute(GHOST))
          exits.replace(node);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
