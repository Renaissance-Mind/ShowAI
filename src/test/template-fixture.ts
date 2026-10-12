import {
  TEMPLATE_STAGES,
  type TemplateBundleSource,
} from "../portable/template-bundle.mjs";
export function templateFixture(
  id = "guided-example",
  component = true,
): TemplateBundleSource {
  const metadata = {
    format: "showai-template",
    schemaVersion: 1,
    id,
    name: "Guided explanation",
    version: "1.0.0",
    description: "Explain a sequence using persistent object labels.",
    scenarios: ["Read a two-step explanation."],
    guides: Object.fromEntries(
      TEMPLATE_STAGES.map((stage) => [stage, `guides/${stage}.md`]),
    ),
    components: component
      ? [{ id: "step-picker", path: "components/step-picker" }]
      : [],
    page: null,
  };
  const files: Record<string, string> = {
    "README.md":
      "---\n" +
      JSON.stringify(metadata, null, 2) +
      "\n---\n# Guided explanation\n\nKeep the task's objects visible while changing the selected step.\n",
  };
  for (const stage of TEMPLATE_STAGES)
    files[`guides/${stage}.md`] =
      `# ${stage}\n\nOnly the ${stage} phase instruction.\n`;
  if (component) {
    const documentation = {
      version: 2,
      reuse: {
        kind: "general",
        boundaries: ["Finite sequences with readable text labels."],
      },
      usage: {
        purpose: "Read a sequence one step at a time.",
        structure: ["Title, current label and next-step control."],
        inputs: [
          { path: "title", meaning: "Topic" },
          { path: "labels", meaning: "Ordered step labels" },
        ],
        recipes: [{ title: "Sequence", steps: ["Supply title and labels."] }],
        interactions: [
          {
            action: "Next",
            effect: "Select the next label",
            persistence: "view",
          },
        ],
        constraints: ["At least one label."],
        editing: {
          data: ["Update labels."],
          implementation: ["Preserve read-only transient selection."],
        },
      },
      development: {
        entryPoints: [{ path: "index.tsx", purpose: "React renderer" }],
        architecture: ["Local view state selects an ordered label."],
        extensionPoints: ["Add view controls."],
        invariants: ["Reading never calls onChange."],
        verification: ["Click Next and verify the next label."],
      },
    };
    files["components/step-picker/manifest.json"] = JSON.stringify({
      id: "step-picker",
      name: "Sequence reader",
      version: "1.0.0",
      description: "A readable sequence with transient selection.",
      entry: "index.tsx",
      scenarios: ["Explain a sequence."],
      defaultData: { title: "Sequence", labels: ["Start", "Accepted version"] },
      examples: [
        {
          name: "Sequence",
          data: { title: "Sequence", labels: ["Start", "Accepted version"] },
        },
      ],
      documentation,
    });
    files["components/step-picker/props.schema.json"] = JSON.stringify({
      type: "object",
      properties: {
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["title", "labels"],
      additionalProperties: false,
    });
    files["components/step-picker/index.tsx"] =
      'import React,{useState} from "react";export default function Sequence({data}){const[index,setIndex]=useState(0);return <section style={{fontSize:18,padding:20}}><h2>{data.title}</h2><p aria-live="polite">{data.labels[index]}</p><button onClick={()=>setIndex((index+1)%data.labels.length)}>Next step</button></section>}';
  }
  return { format: 1, files };
}
