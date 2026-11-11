import { defineMessages } from "../index";

// Find and replace inside the open page.
export default defineMessages("find", {
  "zh-CN": {
    bar: "查找和替换",
    query: "查找",
    replacement: "替换为",
    count: "{current}/{total}",
    none: "无结果",
    previous: "上一个",
    next: "下一个",
    caseSensitive: "区分大小写",
    showReplace: "显示替换",
    hideReplace: "隐藏替换",
    replace: "替换",
    replaceAll: "全部替换",
    close: "关闭",
    replaced: { other: "已替换 {count} 处" },
  },
  en: {
    bar: "Find and replace",
    query: "Find",
    replacement: "Replace with",
    count: "{current}/{total}",
    none: "No results",
    previous: "Previous match",
    next: "Next match",
    caseSensitive: "Match case",
    showReplace: "Show replace",
    hideReplace: "Hide replace",
    replace: "Replace",
    replaceAll: "Replace all",
    close: "Close",
    replaced: { one: "Replaced 1 match", other: "Replaced {count} matches" },
  },
});
