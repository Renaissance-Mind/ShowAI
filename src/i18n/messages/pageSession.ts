import { defineMessages } from "../index";

// Page saving, local drafts and save-state messages.
export default defineMessages("pageSession", {
  "zh-CN": {
    "status.saved": "本机已保存",
    "status.saving": "保存中",
    "status.changed": "待保存",
    "status.retained": "本机草稿已保留",
    "status.failed": "保存失败",
    savedWithExternalConflict:
      "正式修改已保存，但外部文件也有修改，外部版本已保留。请处理冲突。",
    externalUnresolved: "外部文件有未处理修改，外部版本已保留。",
    legacyDraftNoBase:
      "这份旧库草稿缺少可靠的基础版本，已保留在本机。可以保留为副本，或载入正式版本。",
    draftRestoredWithChanges:
      "已恢复本机草稿，正式版本也有新修改。请比较并处理。",
    draftRestored: "已恢复本机未提交的草稿",
    editedWhileReadingDraft:
      "读取草稿期间又有新的编辑，当前编辑已保留。请再次选择草稿。",
    draftNotForPage: "草稿不属于当前页面。",
    selectedDraftRestored: "已恢复选中的本机草稿",
    fileChangedElsewhere:
      "文件已被其他工具修改。请选择保留本地草稿，或载入文件版本。",
    editedWhileReadingFile:
      "读取文件期间又有新的编辑，草稿已保留。请再次选择如何处理。",
    copyTitle: "{title} 副本",
    mergeBaseExpired: "保存冲突的基础版本已失效，请重新查看。",
    editMergedDraft: "保存失败：请修改当前合并草稿，然后重新保存，或放弃修改。",
    conflictNotForPage: "冲突不属于当前页面。",
    draftSaveFailed: "本机草稿保存失败：{error}",
    keepDraftsBeforeSwitch: "切换内容库前需要可靠保留所有页面草稿。",
  },
  en: {
    "status.saved": "Saved on this device",
    "status.saving": "Saving",
    "status.changed": "Unsaved",
    "status.retained": "Local draft kept",
    "status.failed": "Couldn't save",
    savedWithExternalConflict:
      "Your changes were saved, but the file was also changed elsewhere. The external version is kept. Resolve the conflict.",
    externalUnresolved:
      "The file has unresolved external changes. The external version is kept.",
    legacyDraftNoBase:
      "This draft from an older library has no reliable base version and is kept on this device. Keep it as a copy, or load the saved version.",
    draftRestoredWithChanges:
      "Local draft restored, but the saved version also has new changes. Compare them and decide.",
    draftRestored: "Restored an unsaved local draft",
    editedWhileReadingDraft:
      "New edits were made while the draft was loading. Your current edits are kept. Choose the draft again.",
    draftNotForPage: "This draft doesn't belong to the current page.",
    selectedDraftRestored: "Restored the selected local draft",
    fileChangedElsewhere:
      "The file was changed by another tool. Keep your local draft, or load the file version.",
    editedWhileReadingFile:
      "New edits were made while the file was loading. Your draft is kept. Choose how to proceed again.",
    copyTitle: "{title} copy",
    mergeBaseExpired:
      "The base version for this save conflict is out of date. Review it again.",
    editMergedDraft:
      "Couldn't save. Edit the merged draft and save again, or discard your changes.",
    conflictNotForPage: "This conflict doesn't belong to the current page.",
    draftSaveFailed: "Couldn't save the local draft: {error}",
    keepDraftsBeforeSwitch:
      "All page drafts must be safely kept before switching libraries.",
  },
});
