import { defineMessages } from "../index";

// The single-page canvas used when ShowAI runs without the workbench.
export default defineMessages("canvas", {
  "zh-CN": {
    readFailed: "本地页面未能读取，原始数据已保留。",
    saveFailed: "保存失败，请下载源文件备份。",
    blockedNotice: "为保护原始数据，当前修改不会自动保存。",
    downloadCurrent: "下载当前内容",
    exported: "已导出",
    exportFailed: "导出失败：{reason}",
    tryAgain: "请重试",
    fileTooLarge: "导入文件为 {size}，文件上限 {limit}。",
    openFailed: "打开失败：{reason}",
    checkFormat: "请检查页面格式",
    exportPage: "导出页面",
    openPage: "打开页面…",
    exportMarkdown: "导出 Markdown",
    pageTitle: "页面标题",
  },
  en: {
    readFailed: "Couldn't read the local page. The original data was kept.",
    saveFailed: "Couldn't save. Download the source file as a backup.",
    blockedNotice:
      "To protect the original data, your changes aren't saved automatically.",
    downloadCurrent: "Download current content",
    exported: "Exported",
    exportFailed: "Export failed: {reason}",
    tryAgain: "Please try again.",
    fileTooLarge: "The file is {size}; the limit is {limit}.",
    openFailed: "Couldn't open: {reason}",
    checkFormat: "Check the page format.",
    exportPage: "Export page",
    openPage: "Open page…",
    exportMarkdown: "Export Markdown",
    pageTitle: "Page title",
  },
});
