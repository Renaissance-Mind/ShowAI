/**
 * Continuity for the workbench's shared surfaces. Menus, dialogs, popovers and
 * toasts unmount the moment their owner drops them, and library rows are
 * replaced by React as lists change. This layer watches those removals and
 * insertions once for the whole workbench: a removed overlay is replaced by
 * an inert snapshot that plays its exit, and list rows animate from their
 * previous place. It is installed by the workbench only, so the portable
 * reader and exported pages carry none of it.
 */
import {
  exitKeyframes,
  motionDuration,
  motionToken,
  planRowMotion,
  prefersReducedMotion,
  type ExitStyle,
  type RowBox,
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

const ROW_SELECTOR =
  ".studio-tree-row[data-library-id], .studio-page-list-row[data-library-id]";
/** Scroll containers whose rows keep their place across changes. */
const LIST_SELECTOR = ".studio-sidebar-projects, .studio-page-list";
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
    node.removeAttribute("data-library-id");
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

/** Keeps library rows in place visually while React rearranges them. */
export class ListMotion {
  private layouts = new WeakMap<Element, Map<string, RowBox>>();
  private running = new Map<Element, Animation>();

  constructor(private doc: Document) {}

  private rows(list: Element) {
    const rows = new Map<string, HTMLElement>();
    for (const row of list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
      if (row.closest(`[${GHOST}]`) || !row.getClientRects().length) continue;
      const id = row.dataset.libraryId!;
      let key = id;
      for (let copy = 2; rows.has(key); copy++) key = `${id}#${copy}`;
      rows.set(key, row);
    }
    return rows;
  }

  /** Row boxes in the list's content coordinates, without in-flight transforms. */
  private measure(list: Element, rows: Map<string, HTMLElement>) {
    const origin = list.getBoundingClientRect();
    const boxes = new Map<string, RowBox>();
    for (const [key, row] of rows) {
      const rect = row.getBoundingClientRect();
      let x = 0,
        y = 0;
      if (this.running.has(row)) {
        const translate = getComputedStyle(row).translate;
        if (translate !== "none") {
          const [tx, ty = "0"] = translate.split(" ");
          x = parseFloat(tx);
          y = parseFloat(ty);
        }
      }
      boxes.set(key, {
        top: rect.top - y - origin.top + list.scrollTop,
        left: rect.left - x - origin.left + list.scrollLeft,
        width: rect.width,
        height: rect.height,
      });
    }
    return boxes;
  }

  /** Records the current layout so the next change can animate from it. */
  remember(list: Element) {
    this.layouts.set(list, this.measure(list, this.rows(list)));
  }

  update(list: Element, removed: Element[]) {
    const before = this.layouts.get(list);
    const rows = this.rows(list);
    const after = this.measure(list, rows);
    this.layouts.set(list, after);
    // Dragging previews its own layout; the drop lands without a second pass.
    if (!before || this.doc.querySelector(".library-drag-ghost")) return;
    if (prefersReducedMotion(this.doc.defaultView!)) return;
    // The part of the list inside the window, in the list's content coordinates.
    const origin = list.getBoundingClientRect();
    const height = this.doc.documentElement.clientHeight;
    const plan = planRowMotion(before, after, {
      top: Math.max(origin.top, 0) - origin.top + list.scrollTop,
      bottom: Math.min(origin.bottom, height) - origin.top + list.scrollTop,
    });
    if (!plan) return;
    const base = motionDuration("--duration-base");
    for (const { key, dx, dy } of plan.moves) {
      const row = rows.get(key)!;
      this.running.get(row)?.cancel();
      const animation = row.animate(
        [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }],
        { duration: base, easing: motionToken("--ease-in-out") },
      );
      this.track(row, animation);
    }
    for (const key of plan.enters) {
      const row = rows.get(key)!;
      this.running.get(row)?.cancel();
      const animation = row.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: base,
        easing: motionToken("--ease-out"),
      });
      this.track(row, animation);
    }
    this.leave(list, plan.exits, before, removed);
  }

  private track(row: Element, animation: Animation) {
    this.running.set(row, animation);
    const done = () => {
      if (this.running.get(row) === animation) this.running.delete(row);
    };
    animation.finished.then(done, done);
  }

  /** Removed rows fade where they were while their neighbours close the gap. */
  private leave(
    list: Element,
    keys: string[],
    before: Map<string, RowBox>,
    removed: Element[],
  ) {
    if (!keys.length) return;
    const leaving = new Set(keys.map((key) => key.replace(/#\d+$/, "")));
    const origin = list.getBoundingClientRect();
    for (const root of removed) {
      const rows = [
        ...(root.matches(ROW_SELECTOR) ? [root] : []),
        ...root.querySelectorAll<HTMLElement>(ROW_SELECTOR),
      ] as HTMLElement[];
      const row = rows.find((item) => leaving.has(item.dataset.libraryId!));
      const box = row && before.get(row.dataset.libraryId!);
      if (!row || !box) continue;
      leaving.delete(row.dataset.libraryId!);
      const ghost = snapshot(row);
      Object.assign(ghost.style, {
        position: "absolute",
        margin: "0",
        width: `${box.width}px`,
        height: `${box.height}px`,
        zIndex: "0",
      });
      list.prepend(ghost);
      const parent = ghost.offsetParent ?? this.doc.body;
      const frame = parent.getBoundingClientRect();
      ghost.style.left = `${origin.left + box.left - list.scrollLeft - frame.left - parent.clientLeft + parent.scrollLeft}px`;
      ghost.style.top = `${origin.top + box.top - list.scrollTop - frame.top - parent.clientTop + parent.scrollTop}px`;
      const animation = ghost.animate(
        [
          { opacity: 1, scale: "1" },
          { opacity: 0, scale: "1 0.6" },
        ],
        {
          duration: motionDuration("--duration-fast"),
          easing: motionToken("--ease-out"),
          fill: "forwards",
        },
      );
      ghost.style.transformOrigin = "top";
      const remove = () => ghost.remove();
      animation.finished.then(remove, remove);
    }
  }
}

/** Installs exit snapshots and list motion for one workbench document. */
export function installWorkbenchMotion(doc: Document) {
  const exits = new ExitLayer(doc);
  const lists = new ListMotion(doc);
  for (const list of doc.querySelectorAll(LIST_SELECTOR)) lists.remember(list);
  const observer = new MutationObserver((records) => {
    const changed = new Map<Element, Element[]>();
    const touch = (node: Node, removed?: Element) => {
      const element = node instanceof Element ? node : node.parentElement;
      const list = element?.closest(LIST_SELECTOR);
      if (!list) return;
      const entry = changed.get(list) ?? [];
      if (removed) entry.push(removed);
      changed.set(list, entry);
    };
    for (const record of records) {
      if (record.type === "attributes") {
        touch(record.target);
        continue;
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element) || node.hasAttribute(GHOST)) continue;
        // A node that React moved is connected again by now.
        if (!node.isConnected) exits.exit(node, record.target, record.nextSibling);
        touch(record.target, node);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || node.hasAttribute(GHOST)) continue;
        exits.replace(node);
        if (node.matches(LIST_SELECTOR)) lists.remember(node);
        else for (const list of node.querySelectorAll(LIST_SELECTOR)) lists.remember(list);
        touch(record.target);
      }
    }
    for (const [list, removed] of changed)
      if (list.isConnected) lists.update(list, removed);
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
  return () => observer.disconnect();
}
