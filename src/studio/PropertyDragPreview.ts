type Axis = "horizontal" | "vertical";
type Point = { x: number; y: number };
const easing = "cubic-bezier(.2,.8,.2,1)";
export const propertyMotionDuration = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 170;

/** A same-size, inert snapshot, anchored at the original grab point. */
export class PropertyDragPreview {
  private ghost: HTMLDivElement;
  private origin: DOMRect;
  private offset: Point;
  private point: Point;
  private settling: Animation | null = null;
  private disposed = false;

  constructor(
    private source: HTMLElement,
    root: HTMLElement,
    private axis: Axis,
    point: Point,
  ) {
    this.origin = source.getBoundingClientRect();
    this.offset = { x: point.x - this.origin.x, y: point.y - this.origin.y };
    this.point = point;
    this.ghost = document.createElement("div");
    this.ghost.className = `project-database project-db-drag-layer project-db-drag-${axis}`;
    this.ghost.setAttribute("aria-hidden", "true");
    this.ghost.inert = true;
    this.ghost.style.width = `${this.origin.width}px`;
    this.ghost.style.font = getComputedStyle(source).font;
    if (axis === "horizontal") {
      const viewport = root
        .closest(".studio-database-library")
        ?.getBoundingClientRect();
      const height = Math.max(
        this.origin.height,
        Math.min(
          root.getBoundingClientRect().bottom,
          viewport?.bottom ?? window.innerHeight,
          window.innerHeight,
        ) - this.origin.top,
      );
      this.ghost.style.height = `${height}px`;
      const table = document.createElement("table");
      table.className = "project-db-table";
      table.createTHead().insertRow().append(this.clone(source));
      const body = table.createTBody();
      const id = source.dataset.propertyId;
      for (const cell of root.querySelectorAll<HTMLElement>(
        "tbody [data-property-cell]",
      )) {
        if (cell.dataset.propertyCell !== id) continue;
        if (cell.getBoundingClientRect().top >= this.origin.top + height) break;
        body.insertRow().append(this.clone(cell));
      }
      this.ghost.append(table);
    } else {
      this.ghost.style.height = `${this.origin.height}px`;
      const row = this.clone(source);
      row.style.gridTemplateColumns =
        getComputedStyle(source).gridTemplateColumns;
      row.style.margin = "0";
      this.ghost.append(row);
    }
    document.body.append(this.ghost);
    this.move(point);
  }
  private clone(source: HTMLElement) {
    const clone = source.cloneNode(true) as HTMLElement;
    const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    copies.forEach((node, index) => {
      for (const attribute of [...node.attributes]) {
        if (
          attribute.name === "id" ||
          attribute.name === "name" ||
          attribute.name === "for" ||
          attribute.name.startsWith("aria-") ||
          attribute.name.startsWith("data-")
        )
          node.removeAttribute(attribute.name);
      }
      const original = originals[index];
      if (
        node instanceof HTMLInputElement &&
        original instanceof HTMLInputElement
      ) {
        node.value = original.value;
        node.checked = original.checked;
      } else if (
        node instanceof HTMLSelectElement &&
        original instanceof HTMLSelectElement
      )
        node.selectedIndex = original.selectedIndex;
      node.style.transform = "none";
    });
    return clone;
  }
  move(point: Point) {
    if (this.disposed) return;
    this.point = point;
    const sourceRect = this.source.getBoundingClientRect();
    const x =
      this.axis === "horizontal" ? point.x - this.offset.x : sourceRect.x;
    const y = this.axis === "vertical" ? point.y - this.offset.y : sourceRect.y;
    this.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  center() {
    return this.axis === "horizontal"
      ? this.point.x - this.offset.x + this.origin.width / 2
      : this.point.y - this.offset.y + this.origin.height / 2;
  }
  async settle(target: HTMLElement) {
    if (this.disposed) return;
    const from = this.ghost.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    this.settling = this.ghost.animate(
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
        { transform: `translate3d(${to.x}px, ${to.y}px, 0)` },
      ],
      { duration: propertyMotionDuration(), easing, fill: "forwards" },
    );
    await this.settling.finished.catch(() => {});
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.settling?.cancel();
    this.ghost.remove();
  }
}

/** React owns the order. FLIP translates existing cells/rows between those layouts. */
export class PropertyLayoutMotion {
  private animations = new Map<HTMLElement, Animation>();
  private before = new Map<HTMLElement, DOMRect>();
  constructor(private elements: () => HTMLElement[]) {}
  capture() {
    this.before = new Map(
      this.elements().map((element) => [
        element,
        element.getBoundingClientRect(),
      ]),
    );
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
  play(sourceId?: string) {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    const duration = propertyMotionDuration();
    for (const element of this.elements()) {
      const before = this.before.get(element);
      const id = element.dataset.propertyId ?? element.dataset.propertyCell;
      if (!before || id === sourceId || !duration) continue;
      const next = element.getBoundingClientRect();
      const x = before.x - next.x,
        y = before.y - next.y;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = element.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration, easing },
      );
      this.animations.set(element, animation);
      animation.onfinish = () => {
        if (this.animations.get(element) === animation)
          this.animations.delete(element);
      };
    }
    this.before.clear();
  }
  dispose() {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    this.before.clear();
  }
}
