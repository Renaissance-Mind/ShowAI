import { useState } from "react";
import { Widget } from "../components/blocks/Widget";
import { downloadFile } from "../components/blocks/helpers";
import {
  componentAuthoringIndex,
  componentAuthoringGuide,
} from "../components/custom/authoring";
import type { ComponentSource } from "../components/custom/types";
import { componentAuthoringContent } from "./component-authoring-content";
import { errorMessage } from "./bridge";
import "./component-authoring-guides.css";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";

export default function ComponentAuthoringGuides({
  entry,
  loadSource,
}: {
  entry: string;
  loadSource?: () => Promise<ComponentSource>;
}) {
  const t = useTranslator(messages);
  const [source, setSource] = useState<ComponentSource>(),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  if (!source)
    return (
      <div className="component-authoring-guides">
        <p>{t("authoring.intro")}</p>
        <button
          type="button"
          disabled={loading || !loadSource}
          onClick={() => {
            setLoading(true);
            setError("");
            loadSource!()
              .then((source) => {
                const index = componentAuthoringIndex(source.files, entry);
                setSelected(
                  index.guides.find((guide) =>
                    guide.sourcePath?.endsWith("SKILL.md"),
                  )?.id ?? index.guides[0].id,
                );
                setSource(source);
              })
              .catch((error) => setError(errorMessage(error)))
              .finally(() => setLoading(false));
          }}
        >
          {loading ? t("authoring.loading") : t("authoring.open")}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const index = componentAuthoringIndex(source.files, entry),
    guide = componentAuthoringGuide(source.files, index, selected);
  return (
    <div className="component-authoring-guides">
      <label>
        {t("authoring.guide")}
        <select
          aria-label={t("authoring.guide")}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {index.guides.map((guide) => (
            <option key={guide.id} value={guide.id}>
              {guide.title}
              {guide.appliesTo?.length
                ? ` · ${guide.appliesTo.join(", ")}`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <p>
        {guide.url ? (
          <a href={guide.url} target="_blank" rel="noreferrer">
            {t("authoring.source")}
          </a>
        ) : (
          t("authoring.local")
        )}{" "}
        · {index.commit?.slice(0, 8) ?? guide.sha256.slice(0, 8)}
      </p>
      <details>
        <summary>{t("authoring.tools")}</summary>
        <p>{t("authoring.toolsHelp")}</p>
        <div className="component-authoring-downloads">
          {[
            index.kit,
            index.runner,
            "authoring/diagram-authoring-fonts.mjs",
            "authoring/font-licenses.json",
            index.schemas,
            index.examples,
          ]
            .filter((path): path is string => !!path && !!source.files[path])
            .map((path) => (
              <button
                key={path}
                type="button"
                onClick={() =>
                  downloadFile(
                    source.files[path],
                    path.split("/").pop()!,
                    path.endsWith(".json")
                      ? "application/json"
                      : "text/javascript",
                  )
                }
              >
                {path.split("/").pop()}
              </button>
            ))}
        </div>
      </details>
      <Widget
        kind="text"
        data={{
          content: componentAuthoringContent(
            guide.markdown,
            guide.url,
            t("authoring.image"),
          ),
          format: "richtext",
        }}
        readOnly
      />
    </div>
  );
}
