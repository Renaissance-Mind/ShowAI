import { Extension } from "@tiptap/core";
import { Selection, TextSelection, Plugin } from "@tiptap/pm/state";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** A continuous range may end at a component boundary as well as a character. */
export class ComponentRangeSelection extends Selection {
  constructor($anchor: ResolvedPos, $head: ResolvedPos) {
    super($anchor, $head);
  }
  static create(doc: Node, anchor: number, head: number): Selection {
    const $anchor = doc.resolve(anchor),
      $head = doc.resolve(head);
    return anchor === head
      ? Selection.near($head)
      : $anchor.parent.inlineContent && $head.parent.inlineContent
        ? new TextSelection($anchor, $head)
        : new ComponentRangeSelection($anchor, $head);
  }
  map(doc: Node, mapping: Mappable) {
    return ComponentRangeSelection.create(
      doc,
      mapping.map(this.anchor),
      mapping.map(this.head),
    );
  }
  eq(other: Selection) {
    return (
      other instanceof ComponentRangeSelection &&
      other.anchor === this.anchor &&
      other.head === this.head
    );
  }
  toJSON() {
    return {
      type: "showai-component-range",
      anchor: this.anchor,
      head: this.head,
    };
  }
  static fromJSON(doc: Node, json: { anchor: number; head: number }) {
    if (!Number.isInteger(json.anchor) || !Number.isInteger(json.head))
      throw new RangeError("Invalid component selection");
    return ComponentRangeSelection.create(doc, json.anchor, json.head);
  }
  getBookmark() {
    return new ComponentRangeBookmark(this.anchor, this.head);
  }
}
class ComponentRangeBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}
  map(mapping: Mappable) {
    return new ComponentRangeBookmark(
      mapping.map(this.anchor),
      mapping.map(this.head),
    );
  }
  resolve(doc: Node) {
    return ComponentRangeSelection.create(
      doc,
      Math.min(this.anchor, doc.content.size),
      Math.min(this.head, doc.content.size),
    );
  }
}
Selection.jsonID("showai-component-range", ComponentRangeSelection);

export const ComponentRange = Extension.create({
  name: "componentRangeSelection",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Native selection normalization must not round a component boundary to
          // the nearest paragraph and silently leave that component unselected.
          createSelectionBetween(view, $anchor, $head) {
            const current = view.state.selection;
            return current instanceof ComponentRangeSelection &&
              Math.min($anchor.pos, $head.pos) === current.from &&
              Math.max($anchor.pos, $head.pos) === current.to
              ? current
              : null;
          },
          decorations(state) {
            const { selection } = state;
            if (selection.empty) return null;
            const decorations: Decoration[] = [];
            state.doc.nodesBetween(
              selection.from,
              selection.to,
              (node, pos) => {
                if (
                  node.isAtom &&
                  !node.isText &&
                  pos >= selection.from &&
                  pos + node.nodeSize <= selection.to
                ) {
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                      class: "is-component-range-selected",
                    }),
                  );
                  return false;
                }
              },
            );
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
