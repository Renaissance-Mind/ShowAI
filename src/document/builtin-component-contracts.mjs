const activation = (entity) => [
  { name: "activate", entity, intent: "request", payload: { type: "null" } },
];
export const legacyChildKindPaths = {
  "multi-level-view": ["/levels/*/component/kind"],
};
export const builtinContracts = {
  flowchart: {
    version: 1,
    entities: [
      {
        name: "node",
        path: "/flows/*/nodes/*",
        id: "/id",
        scope: "/flows/*/id",
      },
    ],
    events: activation("node"),
  },
  "layer-diagram": {
    version: 1,
    entities: [
      {
        name: "module",
        path: "/layers/*/modules/*",
        id: "/id",
        scope: "/layers/*/id",
      },
    ],
    events: activation("module"),
  },
  "card-grid": {
    version: 1,
    entities: [
      {
        name: "card",
        path: "/cards/*",
        id: "/id",
        scopeValue: "cards",
        optional: true,
      },
    ],
    events: activation("card"),
  },
  "multi-level-view": {
    version: 1,
    slots: [{ name: "views", path: "/levels/*/content", format: "richtext" }],
    references: [
      {
        path: "/levels/*/bindings/*/blockId",
        slot: "views",
        scope: "/levels/*",
      },
    ],
  },
};
for (const kind of [
  "image",
  "code",
  "divider",
  "table",
  "callout",
  "toggle",
  "stepper",
]) {
  builtinContracts[kind] = {
    version: 1,
    slots: [
      { name: "document", path: "/document", format: "richtext" },
      ...(["callout", "toggle"].includes(kind)
        ? [
            {
              name: "content",
              path: "/content",
              format: "richtext",
              fallbackFor: "document",
            },
          ]
        : []),
      ...(kind === "stepper"
        ? [
            {
              name: "steps",
              path: "/steps/*/content",
              format: "richtext",
              fallbackFor: "document",
            },
          ]
        : []),
    ],
  };
}
builtinContracts.text = {
  version: 1,
  slots: [{ name: "content", path: "/content", format: "richtext" }],
};

export function builtinComponentContract(kind) {
  return builtinContracts[kind] ?? { version: 1 };
}
