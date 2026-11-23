import { useState } from "react";
import {
  paletteColors,
  sidebarRootProps,
  sidebarSchemes,
  type SidebarPalette,
} from "../design/sidebar-palette";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/settings";
import { FileText, FolderOpen } from "../ui/icons";
import { LibraryRow, type LibraryTarget } from "./LibraryNavigation";
import "./sidebar-root-tones.css";
import "./sidebar-palette-settings.css";

const sampleNames = {
  design: "previewDesign",
  drafts: "previewDrafts",
  review: "previewReview",
  field: "previewField",
  notes: "previewNotes",
  archive: "previewArchive",
  samples: "previewSamples",
} as const;
type SampleId = keyof typeof sampleNames;
type Entry = { id: SampleId; tone?: string; children?: Entry[] };
const entries: Entry[] = [
  {
    id: "design",
    tone: "sage",
    children: [{ id: "drafts", children: [{ id: "review" }] }],
  },
  { id: "field", tone: "blue", children: [{ id: "notes" }] },
  { id: "archive", tone: "rose", children: [{ id: "samples" }] },
];

function FolderPreview({ palette }: { palette: SidebarPalette }) {
  const t = useTranslator(messages);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    design: true,
    drafts: true,
  });
  const [selected, setSelected] = useState<{ id: SampleId; folder: boolean }>({
    id: "review",
    folder: false,
  });
  const Icon = selected.folder ? FolderOpen : FileText;
  function entryView(entry: Entry, projectId: string, parentId: string | null) {
    const { id, children } = entry;
    const title = t(sampleNames[id]);
    const target: LibraryTarget = entry.tone
      ? { id, projectId, title, kind: "project", pinned: false, parentId: null }
      : {
          id,
          projectId,
          title,
          kind: children ? "folder" : "page",
          pinned: false,
          parentId,
        };
    const open = !!expanded[id];
    return (
      <div
        className="studio-tree-entry"
        key={id}
        {...sidebarRootProps(palette, entry.tone)}
      >
        <LibraryRow
          target={target}
          active={selected.id === id}
          expanded={open}
          prefetch={false}
          onToggle={
            children
              ? () =>
                  setExpanded((current) => ({ ...current, [id]: !current[id] }))
              : undefined
          }
          onOpen={() => {
            setSelected({ id, folder: !!children });
            if (children)
              setExpanded((current) => ({ ...current, [id]: true }));
          }}
        />
        {children && open && (
          <div className="studio-tree-children">
            {children.map((child) => entryView(child, projectId, id))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className="settings-folder-preview"
      role="group"
      aria-label={t("folderPreview")}
    >
      <div className="settings-folder-preview-tree">
        <div
          className="studio-sidebar-projects"
          data-sidebar-scheme={palette.scheme}
        >
          {entries.map((entry) => entryView(entry, entry.id, null))}
        </div>
      </div>
      <div className="settings-folder-document" aria-hidden="true">
        <Icon size={21} strokeWidth={1.5} />
        <strong>{t(sampleNames[selected.id])}</strong>
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export default function SidebarPaletteSettings({
  palette,
  onChange,
}: {
  palette: SidebarPalette;
  onChange: (palette: SidebarPalette) => void;
}) {
  const t = useTranslator(messages);
  return (
    <section
      className="settings-group"
      aria-labelledby="settings-interface-title"
    >
      <h2 id="settings-interface-title">{t("interface")}</h2>
      <div className="settings-card settings-folder-card">
        <h3 id="settings-folder-colors">{t("folderColors")}</h3>
        <FolderPreview palette={palette} />
        <div
          className="settings-palette-options"
          role="radiogroup"
          aria-labelledby="settings-folder-colors"
        >
          {sidebarSchemes.map((scheme) => (
            <label
              key={scheme}
              className={`settings-palette-option${scheme === palette.scheme ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="sidebar-palette"
                value={scheme}
                checked={palette.scheme === scheme}
                onChange={() => onChange({ ...palette, scheme })}
              />
              <span className="settings-palette-strip" aria-hidden="true">
                {paletteColors({ ...palette, scheme }).map((color, index) => (
                  <i key={index} style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="settings-palette-name">
                {t(`palette.${scheme}`)}
                <i className="settings-radio-mark" aria-hidden="true" />
              </span>
            </label>
          ))}
        </div>
        {palette.scheme === "solid" && (
          <label className="settings-solid-color">
            <span>{t("solidColor")}</span>
            <input
              type="color"
              value={palette.solidColor}
              onChange={(event) =>
                onChange({
                  ...palette,
                  solidColor: event.currentTarget.value,
                })
              }
            />
          </label>
        )}
      </div>
    </section>
  );
}
