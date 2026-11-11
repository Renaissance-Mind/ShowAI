import { defineMessages } from "../index";

// The @ mention menu and the page heading's backlink count.
export default defineMessages("mentions", {
  "zh-CN": {
    backlinkCount: "{count} 个页面引用了这里",
    menu: "提及",
    sources: "提及来源",
    pages: "页面",
    noResults: "没有匹配的结果",
    today: "今天",
    tomorrow: "明天",
    yesterday: "昨天",
    typed: "输入的内容",
  },
  en: {
    backlinkCount: {
      one: "{count} page links here",
      other: "{count} pages link here",
    },
    menu: "Mention",
    sources: "Mention sources",
    pages: "Pages",
    noResults: "No matches",
    today: "Today",
    tomorrow: "Tomorrow",
    yesterday: "Yesterday",
    typed: "Typed text",
  },
});
