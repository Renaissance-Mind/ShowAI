# Contributing a built-in template

**Language:** English | [简体中文](i18n/contributing-templates.zh-CN.md) · [Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

A built-in template ships with every ShowAI runtime and teaches Agents how to present one kind of content, for example a research paper. The runtime always supplies the `system-presentation` template, which holds the presentation workflow every work follows: seven stages from intent to delivery, the record each stage produces, and the visual principles. A task template adds the methods for its content type on top of that workflow and does not repeat it. This guide covers adding a built-in template, revising one, and revising the system workflow.

## Built-in or project template

Most templates belong in a user's content library. An Agent with the ShowAI plugin writes them through the `create-template` Skill and `template_save`, and they can be versioned, shared and published without changing this repository. Propose a built-in when the content type is common across many users, the method has been tried on several real instances, and its guides hold up without the author present. Open a feature request first and describe the content type, the readers it serves and the instances it was tried on.

## How templates are written

A template teaches judgment. Its guides explain what to find out about the reader, which material to collect and how to check it, how to derive the order of explanation from the content itself, and which designs have worked for which situations. It does not prescribe a fixed outline, a fixed set of components or section names, because every instance needs its own structure. Examples are labelled as examples of one instance. The `paper-explainer` template and the references of the `create-template` Skill in `plugins/showai/skills/create-template/references/` show this style.

## Folder format

A built-in template is a folder `resources/templates/<id>/`. The full format and limits are in [Template folders](template-bundles.md); the parts that matter most are:

- `README.md` starts with strict JSON frontmatter between `---` lines: `format` (`"showai-template"`), `schemaVersion` (`4`), `id` (the folder name), `name`, `version` (semver), `description`, `scenarios`, `guides` and `components`. Any other key is rejected. The body after the frontmatter is limited to 4 KiB.
- `guides` lists the guide Markdown files under `guides/` in reading order, and may be empty. An Agent reads the selected template whole, once, so write only the methods this content type needs; the stages and their records come from the system workflow. Each guide is limited to 32 KiB and all guides together to 48 KiB.
- `components` must stay empty. Built-in templates cannot ship their own components; a design guide names built-in components instead.

The README frontmatter is listed in `.prettierignore` because Prettier would add trailing commas to the JSON.

## Adding a template

1. **Folder.** Create `resources/templates/<id>/` with the README and the guides. Name the template in Chinese like the existing ones; Agents read these names and descriptions.
2. **Bundle registration.** Add a `?raw` import for every file and one bundle entry to `src/core/builtin-template-bundles.ts`. A file that is not imported does not ship. A malformed README throws when the catalog loads, so most tests fail until it is valid.
3. **.gitignore.** Markdown is ignored by default. Add an exact `!/resources/templates/<id>/…` line for every file; without it Git leaves the file untracked and the template is missing from your pull request.
4. **Studio navigation.** Add the template to `types` in `src/studio/TemplateNavigation.tsx` and its `type.<id>` label in both languages to `src/i18n/messages/templates.ts`.
5. **Agent guide.** `src/agent/guides.ts` names the shipped templates in the `templates` topic; mention the new one there.
6. **Tests.** Update the expected list and versions in `src/core/template-workflow.test.ts` (`builtin catalog ships only …`), and add a test that applies the template if it changes how templates are applied.

`src/core/builtin-template-files.test.ts` checks steps 2 to 4 and names the missing file or label.

## Revising a template

Only the current files of a built-in template ship, and pages created from a template keep their own content. Raise `version` in the README whenever any file changes, then update the versions that tests assert. `paper-explainer`'s version appears in `src/core/template-workflow.test.ts`, `src/agent/template-workflow.integration.test.ts` and `src/agent/mcp-http.integration.test.ts`; search `src` for the old version string to find any others.

Tool calls quoted in a guide must match the current tool schemas. `src/agent/doc-examples.test.ts` checks the examples in `resources/templates/**/*.md` against them.

## Revising the system workflow

`system-presentation` applies to every work. Its README body and all of its guides form the workflow that the `show-document` Skill carries in full. `npm run package:plugin` embeds the README body and every guide, with headings demoted one level, into `show-document/SKILL.md` between the `showai-system-workflow` markers. It copies the README's “视觉表达原则” section into `show-visual/SKILL.md` between the `showai-visual-principles` markers, then regenerates the host plugin copies. Run it after changing any file of the template and commit the regenerated files. A workflow change affects all templates; describe in the pull request which existing templates you re-read against it.

## Verifying

```sh
npx vitest run src/core/builtin-template-files.test.ts src/core/template-workflow.test.ts
npm run check
npm run build
npm test
```

Then use the template the way an Agent would. Start a development instance with its own port and library (see [Development and testing](development.md)), and read the `cli` field of `npm run dev:status` for the CLI command and environment of that instance. With it:

```sh
<cli> template context --project PROJECT --templates <id> --json
<cli> guide presentation --json
```

The first command returns the README and every guide as an Agent reads them; the second returns the system workflow.

Built-in templates are compiled into the runtime, so the instance must have rebuilt after your change; an MCP session keeps the code it started with, so test in a new session. Finally, ask an Agent connected to that instance to build a real page with the template from a realistic request, and read the result against the guides. Note in the pull request which instances you tried and what you changed after reading them.
