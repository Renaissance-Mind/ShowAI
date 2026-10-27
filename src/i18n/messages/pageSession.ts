import { defineMessages } from "../index";

// Page saving, local drafts and save-state messages.
export default defineMessages("pageSession", {
  "zh-CN": {
    "status.saved": "本机已保存",
    "status.saving": "保存中",
    "status.changed": "待保存",
    "status.retained": "本机草稿已保留",
    "status.failed": "保存失败",
    savedWithExternalConflict: "你的修改已保存，但另一处也有修改，已单独保留。请处理冲突。",
    externalUnresolved: "另一处的修改尚未处理，已单独保留。",
    legacyDraftNoBase:
      "这份旧库草稿缺少可靠的基础版本，已保留在本机。可以保留为副本，或载入正式版本。",
    draftRestoredWithChanges:
      "已恢复本机草稿，正式版本也有新修改。请比较并处理。",
    draftRestored: "已恢复本机未提交的草稿",
    editedWhileReadingDraft:
      "读取草稿期间又有新的编辑，当前编辑已保留。请再次选择草稿。",
    draftNotForPage: "草稿不属于当前页面。",
    selectedDraftRestored: "已恢复选中的本机草稿",
    linksRepaired: "已修复无法保存的链接格式，文字和原始草稿均已保留。",
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
    closeRefusedUnlisted:
      "打开的页面没有确认修改已写入本机草稿（页面没有报告具体原因）。",
    reloadRefusedUnlisted: "打开的页面还没有完成正式保存。",
    fileChangedBy:
      "{name} 修改了这个文件。请选择保留本地草稿，或载入文件版本。",
    "external.title": "{name} 刚更新了这个页面的 {count} 处",
    "external.cause":
      "修改处已短暂高亮。撤销只恢复这次写入前的内容，你的编辑会保留。",
    "external.restoredCause":
      "这是页面上次打开时收到的修改。撤销只恢复这次写入前的内容，你的编辑会保留。",
    "external.details": "修改者：{name}\n来源：{channel}\n写入时间：{time}",
    "external.locate": "定位修改",
    "external.undo": "撤销此次修改",
    "external.dismiss": "知道了",
    "external.undone": "已撤销 {name} 的修改",
    "external.undoConflict":
      "无法自动撤销：你也修改了同样的内容。页面保持不变，可以手动调整。",
    "external.snapshotMissing":
      "这次修改的写入前快照已过期或已清除，无法撤销。页面保持不变。",
    "external.resolveFirst": "请先处理当前的保存冲突，再撤销这次修改。",
    "author.otherWindow": "另一个窗口",
    "author.cli": "命令行工具",
    "author.agent": "Agent",
    "author.otherTool": "其他工具",
    "save.action": "保存",
    "save.title.diskFull": "「{title}」还没有保存：磁盘空间不足",
    "save.title.permission": "「{title}」还没有保存：没有写入权限",
    "save.title.capacity": "「{title}」还没有保存：页面超过大小上限",
    "save.cause.diskFull":
      "内容库所在磁盘的可用空间不足。释放空间后再重试保存。",
    "save.cause.permission":
      "ShowAI 没有写入内容库这个位置的权限。检查该文件夹的权限后再重试保存。",
    "save.cause.capacity":
      "页面内容超过了单页的大小上限。删减或拆分占用最多的组件后再重试保存。",
    "save.librarySpace": "查看内容库空间",
    "save.locateLargest": "定位最大的组件",
    "save.statusLabel": "保存状态：{status}",
    "save.showProblem": "查看保存问题",
    "discard.title": "放弃修改并载入当前文件？",
    "discard.body":
      "本机草稿中的修改（最后编辑于 {time}）会被删除，并载入当前文件的版本。删除后无法恢复。",
    "discard.bodyUnknown":
      "本机草稿中的修改会被删除，并载入当前文件的版本。删除后无法恢复。",
    "discard.confirm": "放弃修改",
  },
  en: {
    "status.saved": "Saved on this device",
    "status.saving": "Saving",
    "status.changed": "Unsaved",
    "status.retained": "Local draft kept",
    "status.failed": "Couldn't save",
    savedWithExternalConflict: "Your changes were saved, but changes were also made elsewhere and are kept separately. Resolve the conflict.",
    externalUnresolved: "Changes made elsewhere are not resolved yet and are kept separately.",
    legacyDraftNoBase:
      "This draft from an older library has no reliable base version and is kept on this device. Keep it as a copy, or load the saved version.",
    draftRestoredWithChanges:
      "Local draft restored, but the saved version also has new changes. Compare them and decide.",
    draftRestored: "Restored an unsaved local draft",
    editedWhileReadingDraft:
      "New edits were made while the draft was loading. Your current edits are kept. Choose the draft again.",
    draftNotForPage: "This draft doesn't belong to the current page.",
    selectedDraftRestored: "Restored the selected local draft",
    linksRepaired:
      "Unusable link formatting was repaired. All text and the original draft were kept.",
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
    closeRefusedUnlisted:
      "An open page didn't confirm that its changes are in a local draft (it gave no specific reason).",
    reloadRefusedUnlisted: "An open page hasn't finished saving.",
    fileChangedBy:
      "{name} changed this file. Keep your local draft, or load the file version.",
    "external.title": {
      one: "{name} just updated {count} place on this page",
      other: "{name} just updated {count} places on this page",
    },
    "external.cause":
      "The changes are briefly highlighted. Undo restores only what this write replaced; your own edits are kept.",
    "external.restoredCause":
      "This change arrived while the page was last open. Undo restores only what this write replaced; your own edits are kept.",
    "external.details": "Changed by: {name}\nSource: {channel}\nWritten at: {time}",
    "external.locate": "Show changes",
    "external.undo": "Undo this change",
    "external.dismiss": "Got it",
    "external.undone": "Undid the change by {name}",
    "external.undoConflict":
      "Couldn't undo automatically: you also edited the same content. The page is unchanged; adjust it by hand.",
    "external.snapshotMissing":
      "The snapshot from before this change has expired or was cleared, so it can't be undone. The page is unchanged.",
    "external.resolveFirst":
      "Resolve the current save conflict before undoing this change.",
    "author.otherWindow": "Another window",
    "author.cli": "A command-line tool",
    "author.agent": "An Agent",
    "author.otherTool": "Another tool",
    "save.action": "Save",
    "save.title.diskFull": "“{title}” is not saved: the disk is full",
    "save.title.permission": "“{title}” is not saved: no write permission",
    "save.title.capacity": "“{title}” is not saved: the page is over its size limit",
    "save.cause.diskFull":
      "The disk that holds the library is out of space. Free up space, then save again.",
    "save.cause.permission":
      "ShowAI cannot write to this location in the library. Check the folder's permissions, then save again.",
    "save.cause.capacity":
      "The page is larger than a single page may be. Shorten or split the largest component, then save again.",
    "save.librarySpace": "View library storage",
    "save.locateLargest": "Find the largest component",
    "save.statusLabel": "Save status: {status}",
    "save.showProblem": "Show the save problem",
    "discard.title": "Discard changes and load the current file?",
    "discard.body":
      "The changes in your local draft (last edited {time}) will be deleted and the current file loaded. This cannot be undone.",
    "discard.bodyUnknown":
      "The changes in your local draft will be deleted and the current file loaded. This cannot be undone.",
    "discard.confirm": "Discard changes",
  },
});
