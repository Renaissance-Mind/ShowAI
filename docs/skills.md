# Skills and authoring workflows

**Language:** English | [简体中文](i18n/skills.zh-CN.md) · [Documentation](README.md)

The ShowAI plugin provides eight Skills. The runtime owns storage, native containers, catalog, compilation and rendering; the plugin supplies methods, references and connection configuration. Agent document operations use MCP. CLI supports startup, diagnostics and scripts.

| Skill                                                                        | Task                                                | Result                                                         |
| ---------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| [use-showai](../plugins/showai/skills/use-showai/SKILL.md)                   | Connect, find, read and discover capabilities       | Connection, content identities and available resources         |
| [plan-presentation](../plugins/showai/skills/plan-presentation/SKILL.md)     | Organize difficult material                         | Reader goals, evidence scope and understanding path            |
| [design-presentation](../plugins/showai/skills/design-presentation/SKILL.md) | Design expression and interaction                   | Objects, relationships, layout, states and static alternatives |
| [show-document](../plugins/showai/skills/show-document/SKILL.md)             | Create, revise, present, export or apply a template | Saved editable Page and delivery                               |
| [review-presentation](../plugins/showai/skills/review-presentation/SKILL.md) | Assess clarity and revise                           | Located issues, repairs and verified scope                     |
| [create-template](../plugins/showai/skills/create-template/SKILL.md)         | Create/extract reusable organization                | Template folder, instructions and applied example              |
| [create-component](../plugins/showai/skills/create-component/SKILL.md)       | Add a missing expression capability                 | Versioned React component, contract and real instance          |
| [collaborate-canvas](../plugins/showai/skills/collaborate-canvas/SKILL.md) | Concurrent editing, paired devices and spatial references | Saved content with clear synchronization and edit boundaries |

## Start from the request

Answer simple questions directly and perform focused edits at their natural scope. For a complete interactive explanation or report, `show-document` coordinates planning, design, authoring and review. Existing work can be reused; users need not invoke each Skill manually.

A request for a plan or design produces that artifact. A request for a complete work continues through creation, verification, saving and presentation. When a reader cannot understand a passage, read the full original and revise the affected text and diagrams coherently. See the [presentation contract](../plugins/showai/skills/plan-presentation/references/presentation-contract.md).

## Establish ownership

Begin a ShowAI task with `guide()` for the shared entrypoint, then `showai_capabilities` and `project_context` or `projects_list`. A local library connection can resolve a trusted host directory for new formal work. HTTP clients use authorized project identities. Read-only discovery does not create a project.

Read the current Page before editing; keep its hash, revision and stable IDs. Save formal work before `page_present`. Explicit standalone/file-only requests can use `render_document`. Report connection, save or display failures with their actual retained state.

## Templates and components

The system presentation baseline is mandatory. Six task families cover concepts/mechanisms, comparisons/decisions, evidence reports, procedures/troubleshooting, progress reports and exploration maps. Template folders declare intent, evidence, understanding, design, authoring and review stages, and may include components and a Page skeleton. Existing legacy templates remain readable. See [Template folders](template-bundles.md).

Read only the needed stage and selected exact-template context. For mechanisms, make the participating objects, state changes, steps and feedback observable. A template provides guidance and structure; the agent fills it with real evidence. Preserve the original when extracting a template and test the result with different material.

Components own their schema and versioned usage/development documentation. Query metadata, guide and [parameters](component-parameters.md) first; read implementation sources when developing a component. Reuse and combine existing capabilities before adding a new package. New source requires a new immutable revision.

## Verify and deliver

Source inspection, screenshots, interaction checks and reader trials establish different evidence. Check factual support, reading order, important states, narrow layouts and static/export behavior as relevant; report untested scope.

`page_present` captures one saved revision and returns full HTML/source. `blockIds` selects the conversation preview while retaining the complete delivery. Use meaningful excerpts if the inline budget is exceeded. See [Conversation display](../plugins/showai/skills/show-document/references/conversation-display.md).

Local plugin installation, host capability refresh and current-conversation guidance loading are separate checks. Remote ChatGPT users receive the same workflows through `guide` without installing local Skills. Updating either route does not automatically upgrade the other runtime.
