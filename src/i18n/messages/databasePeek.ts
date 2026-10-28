import { defineMessages } from "../index";

export default defineMessages("databasePeek", {
  "zh-CN": {
    preview: "文档侧栏",
    close: "关闭文档侧栏",
    fullPage: "全页打开",
    previous: "上一份文档",
    next: "下一份文档",
    position: "第 {index} / {count} 份",
    saved: "已保存",
    saving: "保存中…",
    unsaved: "正在编辑",
    readOnly: "只读",
    retry: "重试保存",
    resolve: "全页查看并处理",
    restore: "恢复未保存的草稿",
    properties: "文档属性",
    propertyError: "属性暂时无法读取，请关闭侧栏后重试。",
    needsAttention: "保存需处理",
    propertyConflict: "属性存在保存冲突，请关闭侧栏后在数据库中选择保留的值。",
    createdNotOpened:
      "文档已创建，但当前文档尚未保存成功。请处理保存提示后再打开新文档。",
  },
  en: {
    preview: "Document side peek",
    close: "Close side peek",
    fullPage: "Open as full page",
    previous: "Previous document",
    next: "Next document",
    position: "{index} of {count}",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Editing",
    readOnly: "Read only",
    retry: "Retry saving",
    resolve: "Open full page to resolve",
    restore: "Restore unsaved draft",
    properties: "Document properties",
    propertyError: "Properties are unavailable. Close the peek and try again.",
    needsAttention: "Save needs attention",
    propertyConflict:
      "Properties have a save conflict. Close the peek to choose which values to keep in the database.",
    createdNotOpened:
      "The document was created, but the current document could not be saved. Resolve its save issue before opening the new document.",
  },
});
