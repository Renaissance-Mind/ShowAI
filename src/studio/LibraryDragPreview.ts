import type { LibraryTarget } from "./LibraryNavigation";

let cloneSerial = 0;
const rowSelector =
  ".studio-tree-row[data-library-id], .studio-page-list-row[data-library-id]";
const duration = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;

export class LibraryDragPreview {
  private ghost: HTMLElement;
  private placeholder: HTMLElement;
  private unit: HTMLElement;
  private originalDisplay: string;
  private originalParent: HTMLElement;
  private originalNext: ChildNode | null;
  private temporary: HTMLElement | null = null;
  private animations = new Map<HTMLElement, Animation>();
  private offset: { x: number; y: number };
  private lastPoint: { x: number; y: number };
  private signature = "";
  private closed = false;
  private receiver: HTMLElement | null = null;
  private arrival: HTMLElement | null = null;
  private landing: Animation | null = null;
  private compact: boolean;
  private sourceHeight: number;

  constructor(
    private source: HTMLElement,
    private root: HTMLElement,
    x: number,
    y: number,
    private item: LibraryTarget,
  ) {
    const box = source.getBoundingClientRect();
    const grid = source.closest<HTMLElement>(".studio-page-list");
    this.compact = !!grid?.dataset.view && grid.dataset.view !== "list";
    this.sourceHeight = box.height;
    const width = this.compact ? Math.min(112, box.width * 0.78) : box.width;
    const height = this.compact ? width * 1.12 : box.height;
    this.offset = {
      x: ((x - box.left) * width) / box.width,
      y: ((y - box.top) * height) / box.height,
    };
    this.lastPoint = { x, y };
    this.unit = source.matches(".studio-tree-row")
      ? source.parentElement!
      : source;
    this.originalParent = this.unit.parentElement!;
    this.originalNext = this.unit.nextSibling;
    this.originalDisplay = this.unit.style.display;
    this.placeholder = this.makePlaceholder(this.unit);
    this.ghost = document.createElement("div");
    this.ghost.className = this.compact
      ? "library-drag-ghost library-card-ghost"
      : `library-drag-ghost${grid ? " studio-page-list" : ""}`;
    if (grid?.dataset.view) this.ghost.dataset.view = grid.dataset.view;
    this.ghost.setAttribute("aria-hidden", "true");
    this.ghost.inert = true;
    Object.assign(this.ghost.style, {
      width: `${width}px`,
      height: `${height}px`,
    });
    const face = this.compact ? this.makePaper() : this.clone(source);
    this.ghost.append(face);
    root.append(this.ghost);
    this.unit.before(this.placeholder);
    this.unit.style.display = "none";
    this.move({ x, y });
    if (this.compact && duration()) {
      face.style.transformOrigin = `${this.offset.x}px ${this.offset.y}px`;
      face.animate(
        [
          { transform: `scale(${box.width / width}, ${box.height / height})` },
          { transform: "scale(1)" },
        ],
        { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    }
  }
  private makePaper() {
    const face = document.createElement("div");
    face.className = "library-carry-sheet";
    face.dataset.kind = this.item.kind;
    const title = document.createElement("span");
    title.textContent = this.item.title;
    face.append(title);
    return face;
  }
  private makePlaceholder(unit: HTMLElement) {
    let copy: HTMLElement;
    if (this.compact && unit.matches(".studio-page-list-row")) {
      copy = document.createElement("div");
      copy.className = "studio-page-list-row library-card-space";
      copy.style.height = `${this.sourceHeight}px`;
      copy.setAttribute("aria-hidden", "true");
      copy.inert = true;
    } else copy = this.clone(unit);
    copy.classList.add("library-drag-placeholder");
    copy.style.display = "";
    return copy;
  }
  private clone(element: HTMLElement) {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    const nodes = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
    const prefix = `library-drag-${++cloneSerial}-`;
    const ids = new Map(
      nodes
        .filter((node) => node.id)
        .map((node) => [node.id, prefix + node.id]),
    );
    for (const node of nodes) {
      for (const attribute of [...node.attributes]) {
        const key = attribute.name;
        if (
          key.startsWith("data-library") ||
          key.startsWith("data-drop") ||
          key === "data-dragging"
        )
          node.removeAttribute(key);
        else if (key === "id") node.id = ids.get(attribute.value)!;
        else {
          let value = attribute.value.replace(
            /url\(["']?#([^\)"']+)["']?\)/g,
            (match, id) => (ids.has(id) ? `url(#${ids.get(id)})` : match),
          );
          if (
            (key === "href" || key === "xlink:href") &&
            value.startsWith("#") &&
            ids.has(value.slice(1))
          )
            value = `#${ids.get(value.slice(1))}`;
          if (value !== attribute.value) node.setAttribute(key, value);
        }
      }
      node.classList.remove("active");
    }
    return copy;
  }
  layoutRect(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    if (!this.animations.has(element)) return rect;
    const transform = getComputedStyle(element).transform;
    const matrix = new DOMMatrixReadOnly(
      transform === "none" ? undefined : transform,
    );
    return new DOMRect(
      rect.x - matrix.m41,
      rect.y - matrix.m42,
      rect.width,
      rect.height,
    );
  }
  hit(x: number, y: number) {
    if (!this.animations.size) return null;
    return (
      [...this.root.querySelectorAll<HTMLElement>(rowSelector)]
        .reverse()
        .find((el) => {
          if (this.unit.contains(el) || el.getClientRects().length === 0)
            return false;
          const rect = this.layoutRect(el);
          return (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          );
        }) ?? null
    );
  }
  inPlaceholder(x: number, y: number) {
    const rect = this.placeholder.getBoundingClientRect();
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }
  get overFolderCard() {
    return !!this.receiver;
  }
  private receive(folder: HTMLElement | null) {
    if (folder === this.receiver) return;
    if (this.receiver) delete this.receiver.dataset.folderDrop;
    this.receiver = folder;
    if (folder) folder.dataset.folderDrop = "over";
  }
  move(point: { x: number; y: number }) {
    this.lastPoint = point;
    this.ghost.style.transform = `translate3d(${point.x - this.offset.x}px, ${point.y - this.offset.y}px, 0)`;
  }
  private animateLayout(change: () => void) {
    const elements = [
      ...this.root.querySelectorAll<HTMLElement>(rowSelector),
    ].filter((el) => !this.unit.contains(el));
    const before = new Map(
      elements.map((el) => [el, el.getBoundingClientRect()]),
    );
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    change();
    for (const element of elements) {
      if (!element.isConnected || !element.getClientRects().length) continue;
      const old = before.get(element)!,
        next = element.getBoundingClientRect();
      const x = old.x - next.x,
        y = old.y - next.y;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = element.animate(
        [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: duration(), easing: "cubic-bezier(.2,.8,.2,1)" },
      );
      this.animations.set(element, animation);
      animation.onfinish = () => {
        if (this.animations.get(element) === animation)
          this.animations.delete(element);
      };
    }
  }
  project(target: HTMLElement, position: "before" | "after" | "inside"): void {
    this.receive(
      position === "inside" && target.hasAttribute("data-folder-card")
        ? target
        : null,
    );
    if (this.receiver) return;
    let parent: HTMLElement, before: ChildNode | null;
    if (position === "inside") {
      const unit = target.matches("[data-library-drop-section]")
        ? target.closest<HTMLElement>(".studio-project-section")!
        : target.matches(".studio-tree-row")
          ? target.parentElement!
          : target;
      if (target.matches(".studio-page-list-row")) {
        const tree = [
          ...this.root.querySelectorAll<HTMLElement>(
            ".studio-tree-row[data-library-id]",
          ),
        ].find((el) => el.dataset.libraryId === target.dataset.libraryId);
        if (tree) return this.project(tree, position);
      }
      const existing =
        unit.querySelector<HTMLElement>(
          ":scope > .studio-tree-children:not([data-drag-container])",
        ) ??
        (target.matches("[data-library-drop-section]")
          ? target
              .closest(".studio-project-section")
              ?.querySelector<HTMLElement>(".studio-project-section-items")
          : null);
      if (existing) parent = existing;
      else {
        if (!this.temporary || this.temporary.parentElement !== unit) {
          this.temporary?.remove();
          this.temporary = document.createElement("div");
          this.temporary.className = target.matches(
            "[data-library-drop-section]",
          )
            ? "studio-project-section-items"
            : "studio-tree-children";
          this.temporary.dataset.dragContainer = "true";
          unit.append(this.temporary);
        }
        parent = this.temporary;
      }
      before = null;
    } else {
      const unit = target.matches(".studio-tree-row")
        ? target.parentElement!
        : target;
      parent = unit.parentElement!;
      before = position === "before" ? unit : unit.nextSibling;
      if (before === this.placeholder) before = this.placeholder.nextSibling;
    }
    const signature = `${target.dataset.libraryId ?? target.dataset.libraryDropSection}:${position}`;
    if (
      this.signature === signature &&
      this.placeholder.parentElement === parent
    )
      return;
    this.signature = signature;
    this.animateLayout(() => {
      const grid = parent.matches(".studio-page-list");
      const representative = [
        ...this.root.querySelectorAll<HTMLElement>(rowSelector),
      ].find(
        (el) =>
          el.dataset.libraryId === this.source.dataset.libraryId &&
          el.matches(".studio-page-list-row") === grid,
      );
      const unit = representative
        ? grid
          ? representative
          : representative.parentElement!
        : this.unit;
      const next = this.makePlaceholder(unit);
      this.placeholder.remove();
      this.placeholder = next;
      parent.insertBefore(next, before);
      if (this.temporary && this.temporary !== parent) {
        this.temporary.remove();
        this.temporary = null;
      }
    });
  }
  async settle() {
    if (this.closed) return;
    const from = this.ghost.getBoundingClientRect();
    const folder = this.receiver;
    const slot = folder?.querySelector<HTMLElement>(
      '.studio-folder-sheet[data-position="0"]',
    );
    let element = this.ghost;
    let keyframes: Keyframe[];
    if (folder && slot) {
      folder.dataset.folderDrop = "landing";
      const paper = this.makePaper();
      paper.classList.add("studio-folder-arrival");
      slot.append(paper);
      const to = paper.getBoundingClientRect();
      element = this.arrival = paper;
      this.ghost.style.visibility = "hidden";
      keyframes = [
        {
          transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transform: "none" },
      ];
    } else {
      const to = this.placeholder.getBoundingClientRect();
      element.style.transformOrigin = "top left";
      keyframes = [
        { transform: `translate(${from.x}px, ${from.y}px)`, opacity: 0.78 },
        {
          transform: `translate(${to.x}px, ${to.y}px) scale(${to.width / from.width}, ${to.height / from.height})`,
          opacity: 0.3,
        },
      ];
    }
    const animation = element.animate(keyframes, {
      duration: duration(),
      easing: "cubic-bezier(.2,.82,.3,1)",
      fill: "forwards",
    });
    this.landing = animation;
    await new Promise<void>((resolve) => {
      animation.onfinish = animation.oncancel = () => resolve();
    });
  }
  restorePosition() {
    this.receive(null);
    if (!this.signature) return;
    this.signature = "";
    this.animateLayout(() => {
      this.originalParent.insertBefore(
        this.placeholder,
        this.originalNext?.parentNode === this.originalParent
          ? this.originalNext
          : this.unit,
      );
      this.temporary?.remove();
      this.temporary = null;
    });
    this.move(this.lastPoint);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.receive(null);
    this.landing?.cancel();
    this.arrival?.remove();
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    this.ghost.remove();
    this.placeholder.remove();
    this.temporary?.remove();
    this.unit.style.display = this.originalDisplay;
  }
}
