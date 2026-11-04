# Skills and authoring workflows

**Language:** English | [简体中文](i18n/skills.zh-CN.md) · [Documentation](README.md)

The ShowAI plugin provides six Skills. The runtime owns storage, native containers, catalog, compilation and rendering; the plugin supplies methods, references and connection configuration. Agent document operations use MCP. CLI supports startup, diagnostics and scripts.

| Skill                                                                      | Task                                                                                | Result                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [use-showai](../plugins/showai/skills/use-showai/SKILL.md)                 | Entry point: route the request; connect, find, read and manage content              | Connection, content identities, managed content and the next Skill |
| [show-visual](../plugins/showai/skills/show-visual/SKILL.md)               | Show a visualization in the conversation                                            | One to five components displayed, nothing saved                    |
| [show-document](../plugins/showai/skills/show-document/SKILL.md)           | Create or revise a work: report, explanation page, whiteboard diagram or small site | Work records, a saved editable Page and delivery                   |
| [create-template](../plugins/showai/skills/create-template/SKILL.md)       | Create or extract a template for one kind of content                                | Template folder, guides and applied example                        |
| [create-component](../plugins/showai/skills/create-component/SKILL.md)     | Add a missing expression capability                                                 | Versioned React component, contract and real instance              |
| [collaborate-canvas](../plugins/showai/skills/collaborate-canvas/SKILL.md) | Concurrent editing, paired devices and spatial references                           | Saved content with clear synchronization and edit boundaries       |

## Start from the request

`use-showai` is the single entry point. It routes each request by the result the user wants: creating or revising a work goes to `show-document`; seeing components in the conversation without saving goes to `show-visual`; finding, reading and managing existing content stays in `use-showai` and its references; components, templates and collaborative canvases go to their own Skills. `use-showai` also holds the shared rules for connection, project ownership, the content model and saving. Users need not invoke each Skill manually.

Answer simple questions directly and perform focused edits at their natural scope. For a work to create or revise, the agent reads `show-document` once at the start. It contains the whole presentation workflow, how to carry out each stage with ShowAI, the work records, template use, authoring and delivery. Existing records are reused.

A request for a plan or design stops at that record and delivers it. A request for a complete work continues through authoring, review, saving and presentation. When a reader cannot understand a passage, read the full original and revise the affected text and diagrams coherently.

## Establish ownership

Begin a ShowAI task with `guide()` for the shared entrypoint, then `showai_capabilities` and `project_context` or `projects_list`. A local library connection can resolve a trusted host directory for new formal work. HTTP clients use authorized project identities. Read-only discovery does not create a project.

Read the current Page before editing; keep its hash, revision and stable IDs. Save formal work before `page_present`. Explicit standalone/file-only requests can use `render_document`. Report connection, save or display failures with their actual retained state.

## Templates and components

The system presentation workflow is mandatory. It has seven stages: intent, material, logic, design, authoring, review and delivery. Intent produces a reader brief, material produces source notes, logic produces a multi-level presentation plan, design produces a scene-by-scene design draft, and review produces a review record; authoring implements the draft and delivery presents the saved Page. A template adds the methods for one kind of content on top of this workflow and may include a component library; it does not repeat the workflow. The runtime ships the `paper-explainer` method template; earlier staged templates remain readable. See [Template folders](template-bundles.md).

The agent writes the records of each work into one folder, `<YYYYMMDD-HHmm>-<short name>-<8 random hex>/`, under the directory returned by `showai_capabilities.authoring.workRecords`: `brief.md`, `material.md`, `presentation-plan.json` and `review.md`. The default directory is `showai-records` in the system temporary directory; change it in the App under Settings → General, or pin it with the `SHOWAI_RECORDS_DIR` environment variable. Continued editing reuses the folder that records the Page ID. Remote connections without a file system keep the records in the conversation.

When a template fits the request, the agent reads it whole, once, with `template_context` and applies its methods at each stage. Prefer visual expression, keep text as the necessary complement, and design both the whole page and each part. A template provides the method; the agent fills it with real evidence. Preserve the original when extracting a template and test the result with different material.

Components own their schema and versioned usage/development documentation. Query metadata, guide and [parameters](component-parameters.md) first; read implementation sources when developing a component. Reuse and combine existing capabilities before adding a new package. New source requires a new immutable revision.

## Verify and deliver

Source inspection, screenshots, interaction checks and reader trials establish different evidence. Check factual support, reading order, important states, narrow layouts and static/export behavior as relevant; report untested scope.

`page_present` captures one saved revision and returns full HTML/source. `blockIds` selects the conversation preview while retaining the complete delivery. Use meaningful excerpts if the inline budget is exceeded. See [Conversation display](../plugins/showai/skills/use-showai/references/host-display.md).

Local plugin installation, host capability refresh and current-conversation guidance loading are separate checks. Remote ChatGPT users receive the same workflows through `guide` without installing local Skills. Updating either route does not automatically upgrade the other runtime.
