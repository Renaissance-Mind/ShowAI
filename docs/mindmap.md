# Mind maps

**Language:** English | [简体中文](i18n/mindmap.zh-CN.md) · [Documentation](README.md)

Find **Mind map** in the Page/Board insertion menu or type `/` and search for it. Maps support up to **500 nodes**, with automatic layout and balanced branches.

## Layout and editing

Hover over the map to choose radial or one-sided layout. Radial balances subtrees across both sides. One-sided starts to the right; clicking it again switches left. Layout/direction persist with the Page while retaining hierarchy, labels and collapsed states. Read-only switching changes only the current view.

Select a node before using shortcuts. New nodes enter name editing immediately; Enter saves and Escape cancels the name edit. Node actions use the editor's selection menu.

| Shortcut                   | Action                                                      |
| -------------------------- | ----------------------------------------------------------- |
| Tab                        | Add child                                                   |
| Enter / Shift+Enter        | Add following / preceding sibling; Enter on root adds child |
| Shift+Tab                  | Promote node and subtree                                    |
| F2 / double-click          | Edit name                                                   |
| Left / Right               | Parent / first child; Right can expand                      |
| Up / Down                  | Previous / next sibling                                     |
| Space                      | Collapse or expand                                          |
| Delete / Backspace         | Delete subtree; root is protected                           |
| Cmd/Ctrl+Z                 | Undo changes since opening the map                          |
| Shift+Cmd/Ctrl+Z or Ctrl+Y | Redo                                                        |
| Escape                     | Leave the node menu                                         |

Zoom and fit controls appear below the map. Large maps can scroll. Read-only navigation, collapse and zoom do not write to the source.

## Agent data

Read `mindmap` in the catalog. Nodes form a flat tree with exactly one root (`parentId: null`). Other parents must exist; sibling order follows array order.

```json
{
  "kind": "mindmap",
  "data": {
    "title": "Research plan",
    "height": 460,
    "layout": "radial",
    "direction": "right",
    "nodes": [
      { "id": "root", "parentId": null, "label": "Research plan" },
      { "id": "question", "parentId": "root", "label": "Question" },
      {
        "id": "method",
        "parentId": "root",
        "label": "Method",
        "collapsed": false
      }
    ]
  }
}
```

IDs and labels allow up to 200 characters each. Validation rejects duplicate IDs, missing parents, cycles and multiple roots. HTML exports retain reading interactions and hide editing menus/inputs.
