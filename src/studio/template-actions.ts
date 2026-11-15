import type { TemplateMetadata } from "../contract/types";
import { translator } from "../i18n";
import messages from "../i18n/messages/catalog";

const t = translator(messages);

export function templateSelection(
  template: Pick<TemplateMetadata, "id" | "scope" | "version" | "integrity">,
) {
  return {
    id: template.id,
    scope: template.scope,
    version: template.version,
    integrity: template.integrity,
  };
}

export function templateAgentPrompt(
  template: Pick<
    TemplateMetadata,
    "id" | "name" | "scope" | "version" | "integrity"
  >,
) {
  return t("agentPrompt", {
    name: template.name,
    selection: JSON.stringify(templateSelection(template)),
  });
}
