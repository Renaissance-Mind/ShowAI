## Summary

<!-- What does this change and why? Link the issue that agreed on the scope of a new component, template or entry point. -->

## Verification

<!-- Commands you ran and where you checked the behavior (desktop / browser, platform). -->

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] Other: <!-- test:desktop, test:containers, test:component-gallery, manual checks ... -->

## Checklist for this kind of change

<!-- Keep the section that applies and delete the others. -->

**Built-in component** ([guide](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/contributing-components.md))

- [ ] Contract, renderer, catalog entry, documentation and registration; `builtin-registration.test.ts` passes
- [ ] `validateWidgetData` branch in `src/portable/validation.mjs`
- [ ] Existing pages still validate and render; `version` raised when the contract or behavior changed
- [ ] `reuse-selection.md` updated and `npm run package:plugin` run
- [ ] Checked in a development instance: insert, edit, reading view, reload, offline export, narrow window, dark theme

**Built-in template** ([guide](https://github.com/Renaissance-Mind/ShowAI/blob/main/docs/contributing-templates.md))

- [ ] Files imported in `builtin-template-bundles.ts` and allowed in `.gitignore`; `builtin-template-files.test.ts` passes
- [ ] README `version` raised and test versions updated
- [ ] Tried with an Agent on real instances (listed above)

**Feature or fix**

- [ ] Reuses existing menus and commands, or explains why a new entry point is needed
- [ ] Interface strings in both languages
- [ ] Data written by earlier versions still loads
- [ ] Desktop checked when Electron behavior changed

**Documentation**

- [ ] English and Chinese updated together, both indexes, `.gitignore` allowlist for new files
- [ ] Commands checked against the implementation

**Plugin, Skills or CLI protocol**

- [ ] Edited only `plugins/showai/`; regenerated copies committed
- [ ] Skills, `src/agent/guides.ts` and docs updated for changed commands or tools
- [ ] Fresh Agent session picks the right Skill for realistic requests (requests and result listed above)
