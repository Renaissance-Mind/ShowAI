# Page and Board

**Language:** English | [简体中文](i18n/page-surface.zh-CN.md) · [Documentation](README.md)

A **Page** arranges content in reading order. A **Board** provides a spatial workspace with pan, zoom, drawing and free placement. New content defaults to Page. Both are native containers that can nest recursively; expanding a container edits the same node.

## Database projects

Click **New database** at the top of the sidebar, or choose **New database project** from the **Add** menu. You can also select **Database** when creating a project. A database is always created as a separate project; every record is a real Page. Clicking a document name or **New document** opens an editor on the right while the database remains interactive on the left. Edit the title, properties and body, navigate through the current view with previous/next, close the peek with its close button or Escape, or choose **Open as full page**. Renaming the Page updates its database entry.

Switch between table, board and list tabs, or add, rename and delete views. Each view retains its own filter, sort and board grouping settings. The selected view is remembered locally for its content library and database. Boards group documents by a select property; changing that property on a card moves it between groups. Deleting a view retains documents and properties, and at least one view must remain. Older databases receive compatible default views.

Database projects include a content area between their title and view tabs. Click **Add text, headings, or lists…** to write an introduction in the native editor, or use `/` for common content. It saves automatically and is shared by the table, board and list views. Existing databases start empty; ordinary projects do not show this entry point. Introduction changes and document properties save independently, with the existing conflict controls available for concurrent edits to the same introduction.

Database properties support text, numbers, select options, dates, checkboxes and URLs. Click **Add property** after the last column heading, enter a name and choose a type in the popover, then create the column. Canceling leaves the schema unchanged. The same form is available in **Properties**, where you can also manage existing columns. Drag a property heading or a row's handle in **Properties** to reorder it. The entire column or row follows the drag while its neighbors make room; dropping settles and saves the order, while Escape cancels the preview. The table, other views and document peek share this order; document names remain first. Ordering supports undo/redo, as well as Alt+Shift with the corresponding arrow keys. Edit cells in the table, click a column heading to sort, and use search or an equality filter to narrow the records. Properties save automatically; a concurrent edit to the same value asks which value to retain. Removing a record uses the existing Page deletion confirmation and retains its property data with the archived Page.

Database records can be organized within their project. Moving records or their containing folders to another project is blocked until property migration is supported.

## Insert and organize

Search the common component catalog from `/` in a Page or on a blank Board. Page/Board insert at the current position while preserving surrounding text and nesting. Existing flow/grid/free regions remain editable.

The parent owns an object's frame and position; a child container owns its internal layout. Page children follow content order. Board children use local coordinates. `region` supplies flow/grid/free grouping without creating a separate viewport.

An embedded Board has a fixed-height viewport. A Page inside a Board normally has a bounded reading window and can expand; its frame can also grow with content. Page text and flow text share continuous cursor movement, selection and keyboard navigation. Page content has no additional hover/selection border; existing handles, menus, text selection and cell selection indicate interaction. Board object selection retains its frame handles.

The content breadcrumb tracks expansion. Moving, wrapping and deleting containers uses the same resource, save system and undo history at every level.

## Native Page outline

Enable an optional outline from **Page actions → Outline settings**. A Page without an enabled outline has no navigation rail or reserved space. The built-in reading index follows native headings, excludes nested container contents and supports depth, title overrides and hidden headings. Manual outlines organize groups and links to Page content using the entry editor's ordering and indent controls. Adjusting the outline does not move content.

Standard and wide Pages use their measured outer gutter when it can fit the outline; otherwise the outline floats. Full-width Pages use a floating outline. Readers can collapse, expand or pin it; narrow Pages use a drawer that closes after navigation. Reader choices are retained separately for each Page view and never change the stored document. Independent HTML keeps navigation, the selected renderer and author width preferences; printing projects a simple semantic outline.

Store author configuration in the Page surface's `attrs.outline`:

```json
{
  "version": 1,
  "enabled": true,
  "source": { "mode": "headings", "maxLevel": 3 },
  "initialState": "auto",
  "placement": "auto",
  "width": 220
}
```

`initialState` accepts `auto`, `expanded` or `collapsed`; `placement` accepts `auto`, `floating` or `docked`; width is 180–480px. Set `enabled:false` to retain configuration while hiding the outline, or remove the attribute to remove configuration. Headings can have `source.overrides: {"HEADING_ID": {"title":"Alias", "hidden":false}}`. Manual sources use `{mode:"manual",entries:[{id,title?,nodeId?,children?}]}`. Groups require a title; unavailable targets remain editable and are omitted from reader navigation. Only targets within the owning Page can navigate.

### Custom outline components

A directory renderer is a versioned component with `role:"page-outline"`, `pageOutlineProtocol:1` and category `outline` in its manifest. It uses the same source, schema, immutable revisions, compiler and sandbox as content packages and appears in the **Page outlines** catalog category. Attach it through outline settings or set `attrs.outline.renderer` to `{componentId,version,integrity,props}`. The exact reference travels with template copies and offline exports. The built-in index is used when renderer is omitted; an unavailable renderer displays a recovery message and the basic native index.

The React entry receives:

```ts
{
  props, // author parameters, validated by the package schema
  outline: {
    protocol: 1, pageId,
    items: [{ id, title, level, navigable, children }],
    activeItemId, expandedItemIds,
    container: { placement, width, height },
    theme, locale
  },
  navigate(itemId),
  setBranchExpanded(itemId, expanded),
  collapse()
}
```

Layouts can implement their own lists, trees or visual navigation. Render within the provided container, retain keyboard and touch access, and expose current and expanded states. The host validates item IDs and performs navigation; read-only Pages retain these actions. Author parameters are separate from the generated tree and personal branch state. The host always supplies the overall collapse control. Component actions work in sandboxed readers and conversation inline readers.

`examples/page-outline-index` and `examples/page-outline-path` are complete independently importable implementations. For example, import with `showai catalog import --project PROJECT --input examples/page-outline-index --json`, then select it in Page outline settings. Agents can use `block.attrs.set` on the Page ID to configure the native feature with the current base hash/revision.

## Interaction

| Action                            | Behavior                                                    |
| --------------------------------- | ----------------------------------------------------------- |
| Read Page                         | Native vertical scrolling, text selection, keyboard and IME |
| Scroll over locked embedded Board | Continue reading the outer Page                             |
| Unlock embedded Board             | Enable its pan, zoom and drawing gestures                   |
| Middle-drag, Space-drag or M      | Pan; Space remains typing while editing text                |
| Drag blank Board                  | Marquee selection                                           |
| Pinch or Ctrl/Cmd+wheel           | Zoom around pointer, 10%–400%                               |
| Draw pen/rectangle/ellipse/arrow  | Create nodes in the owning Board's local coordinates        |
| Expand a frame                    | Edit the same node in a larger workspace                    |
| Escape                            | Cancel current action, then leave the current level         |
| Wrap in Page/Board                | Add a container around the original node                    |

Click a Board object to select; drag it to move. Click selected text again or press Enter to edit; Escape ends editing while keeping selection. Double-click a rectangle, ellipse or arrow, or select it and press Enter, to edit its label; Escape, Cmd/Ctrl+Enter or clicking elsewhere finishes, and a shape grows taller when its text no longer fits. Component clicks reach the selected component. Shift locks drag direction; Alt-drag duplicates; Alt-resize uses the center; Cmd/Ctrl disables snapping. Shift constrains drawing proportions and Alt draws from center.

The toolbar docks at any canvas edge and saves its position locally. Object actions include duplicate, layer order, alignment/distribution, locking and deletion; shape style controls include label size. With two or more objects connected by arrows selected, the alignment menu can also arrange them along the arrows, left to right or top to bottom. Edge-dragging and wheel input during a drag pan the canvas. Double-click blank space or use the text tool to type. Drawing keeps the current tool active. Existing regions can be ungrouped; their empty interior allows interaction with underlying content. Full-page Boards offer a minimap with click/drag navigation.

| Shortcut                                         | Action                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| V / P / H / R / E (or O) / A / M / X / L / T     | Select, pen, highlighter, rectangle, ellipse, arrow, pan, ink eraser, lasso, text         |
| 1–6, 8, 9                                        | Select through arrow, then pan and ink eraser                                             |
| Shift+1 / Shift+2 / Shift+0                      | Fit all / fit selection / 100%                                                            |
| + / -                                            | Zoom; Cmd/Ctrl combinations remain application zoom                                       |
| Cmd/Ctrl+C / X / V / D                           | Copy / cut / paste / duplicate                                                            |
| ] / [ and Shift+] / Shift+[                      | Raise/lower and front/back                                                                |
| Alt+A / H / D / W / V / S                        | Align left/center/right/top/middle/bottom                                                 |
| Alt+Shift+H / V                                  | Distribute horizontally/vertically                                                        |
| Shift+Cmd/Ctrl+G                                 | Ungroup a region                                                                          |
| Shift+Cmd/Ctrl+L                                 | Lock / unlock                                                                             |
| Arrows; Shift for ×10                            | Nudge; continuous keypress is one undo step                                               |

A locked object stores `layout[id].locked: true`: it cannot drag, resize or enter a marquee, but can be clicked and unlocked.

## Reading locks and gestures

Full-page and expanded Boards are directly interactive. Embedded Boards and flow diagrams start reading-locked. Locking prevents navigation gestures while preserving clicks, context menus, tips, disclosures and editing controls.

G2 shows a lock only when brush, slider, scrollbar or fisheye navigation is configured. Tooltip/hover/legend interactions alone do not capture outer scrolling. The 43 default G2 charts need no lock. Lock state is local personal view data; opaque exports can keep a temporary state if persistent storage is unavailable.

Nested containers, tables, code areas and components claim explicit input boundaries. A started gesture stays with its owner until completion. Custom components use `GestureBoundary` for the axes they need. Whiteboard motion supports interruption and reduced-motion preferences. Drawing capture and camera panning remain separate.

## Version 3 data

```json
{
  "format": "showai",
  "version": 3,
  "document": {
    "id": "research",
    "title": "研究报告",
    "content": {
      "type": "surface",
      "attrs": { "id": "report", "kind": "page", "name": "报告" },
      "content": [
        {
          "type": "paragraph",
          "attrs": { "id": "intro" },
          "content": [{ "type": "text", "text": "问题、材料与解释。" }]
        },
        {
          "type": "surface",
          "attrs": { "id": "analysis", "kind": "board", "name": "分析白板" },
          "content": [
            {
              "type": "surface",
              "attrs": { "id": "evidence", "kind": "page", "name": "详细论证" },
              "content": [
                {
                  "type": "paragraph",
                  "attrs": { "id": "detail" },
                  "content": [{ "type": "text", "text": "这里继续顺序阅读。" }]
                }
              ]
            }
          ]
        }
      ]
    },
    "layout": {
      "analysis": {
        "x": 0,
        "y": 0,
        "width": 800,
        "height": 460,
        "heightMode": "fixed"
      },
      "evidence": {
        "x": 80,
        "y": 60,
        "width": 600,
        "height": 380,
        "heightMode": "fixed"
      }
    },
    "surfaceViews": {
      "report": {
        "initial": null,
        "saved": [],
        "readingOrder": ["intro", "analysis"]
      },
      "analysis": {
        "initial": null,
        "saved": [],
        "readingOrder": ["evidence"]
      },
      "evidence": { "initial": null, "saved": [], "readingOrder": ["detail"] }
    }
  }
}
```

Every non-text node has a unique stable ID. `surface.attrs.kind` is `page` or `board`. `layout` describes child frames; roots have no parent-owned frame. Coordinates range from −1,000,000 to 1,000,000. Ordinary widths are 120–10,000; drawings can be smaller. `heightMode: auto` applies only to Page. Regions retain mode/columns/gap.

`surfaceViews` holds saved views, initial view and reading order by container ID. View targets belong to that container. Page reading order follows its tree; Board reading order supports linear export. Camera, scroll, selection and expansion are local user state and do not change the content hash.

Drawing nodes store tool, six-digit hex color, stroke width, local points and extent. Rectangles, ellipses and arrows may add a plain-text `label` (up to 2000 characters) and `labelSize` (8–160 Board units, default 16); the label is centred inside the shape or at the arrow's midpoint and uses the shape's color. Layout stores displayed position/size; scaling a parent does not rewrite points. `rotation` ranges from −360 to 360 degrees around the center and applies to images/non-arrow drawings. Auto-sized objects may store a measured `contentSize`; the reader remeasures without saving.

Arrow `attrs.bindings.start/end` each contain `{targetId,anchor:{x,y}}`, with normalized anchors on an unrotated sibling frame. When an operation omits an anchor, it becomes the edge midpoint facing the other end; an arrow bound at both ends needs no points or frame. The parent must be a Board/free region; the target cannot be another arrow. Endpoints follow movement, size and rotation. Removing/reparenting a target frees that endpoint. Changing free regions to flow/grid clears direct child arrow bindings and rotation; nested spatial geometry remains intact. Undo restores relationships.

Moving an arrow alone with `surface.layout.set` clears bindings; moving it with its targets in one operation retains their bindings. Equal-value updates do not clear them. Full writes use explicit bindings. Template copies remap targets; partial exports free endpoints aimed outside the selection. A drag/resize/rotation is one undo step, including measurement updates.

## Agents, templates and exports

`guide containers` provides the full operation contract. New resources support `pages create --kind page|board`. `component.insert` handles ordinary components and native containers. `surface.create`, `surface.wrap`, block operations and view operations preserve identities; saves require current hash/revision. `diagram.insert` (see `guide whiteboard`) creates labelled rectangles/ellipses and arrows bound at both ends from a list of nodes and edges, laying out unpositioned nodes along the edges; `diagram.arrange` re-lays out existing connected objects the same way as the editor's arrange-along-arrows command. When `block.insert` adds a drawing, omitted color, stroke width, points and extent are derived from the frame or label.

Templates retain trees, frames and views and remap identities together on application. Partial export includes selected descendants and necessary ancestors. Standalone HTML preserves reading, Board navigation and expansion. `--presentation reading` projects the selected root Board into reading order. Printing preserves embedded Board geometry; export an inner Page separately for complete linear reading.

v1/v2 inputs adapt without rewriting on read. The first managed v3 save retains original bytes under `migrations/<resource-id>/original-v1.json` or `original-v2.json` and existing snapshots. Managed resources reject downgrades. See [Artifact format](artifact-format.md).
