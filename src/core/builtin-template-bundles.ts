// Template folders are the authoritative source; raw imports also bundle into remote runtimes.
import system_presentation_0 from "../../resources/templates/system-presentation/README.md?raw";
import system_presentation_1 from "../../resources/templates/system-presentation/guides/01-intent.md?raw";
import system_presentation_2 from "../../resources/templates/system-presentation/guides/02-material.md?raw";
import system_presentation_3 from "../../resources/templates/system-presentation/guides/03-logic.md?raw";
import system_presentation_4 from "../../resources/templates/system-presentation/guides/04-design.md?raw";
import paper_explainer_0 from "../../resources/templates/paper-explainer/README.md?raw";
import paper_explainer_1 from "../../resources/templates/paper-explainer/guides/01-intent.md?raw";
import paper_explainer_2 from "../../resources/templates/paper-explainer/guides/02-material.md?raw";
import paper_explainer_3 from "../../resources/templates/paper-explainer/guides/03-logic.md?raw";
import paper_explainer_4 from "../../resources/templates/paper-explainer/guides/04-design.md?raw";
import type { TemplateBundleSource } from "../portable/template-bundle.mjs";
export const builtinTemplateBundles: TemplateBundleSource[] = [
  {
    format: 1,
    files: {
      "README.md": system_presentation_0,
      "guides/01-intent.md": system_presentation_1,
      "guides/02-material.md": system_presentation_2,
      "guides/03-logic.md": system_presentation_3,
      "guides/04-design.md": system_presentation_4,
    },
  },
  {
    format: 1,
    files: {
      "README.md": paper_explainer_0,
      "guides/01-intent.md": paper_explainer_1,
      "guides/02-material.md": paper_explainer_2,
      "guides/03-logic.md": paper_explainer_3,
      "guides/04-design.md": paper_explainer_4,
    },
  },
];
