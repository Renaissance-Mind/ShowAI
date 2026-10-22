import type { TemplateMetadata } from "../components/custom/types";
import { translator } from "../i18n";
import messages from "../i18n/messages/catalog";

const t = translator(messages);

/** The exact template_context selection an agent needs for this template revision. */
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

/** A prompt that names the template and tells the agent to start from template_context. */
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
