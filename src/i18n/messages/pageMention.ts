import { defineMessages } from "../index";

// The date and backlinks components.
export default defineMessages("pageMention", {
  "zh-CN": {
    "date.change": "更改日期",
    "backlinks.label": "反向链接",
    "backlinks.empty": "还没有页面引用这里",
    "backlinks.unavailable": "这里读不到页面之间的引用",
    "backlinks.untitled": "未命名页面",
  },
  en: {
    "date.change": "Change date",
    "backlinks.label": "Backlinks",
    "backlinks.empty": "No pages link here yet",
    "backlinks.unavailable": "References between pages are not available here",
    "backlinks.untitled": "Untitled page",
  },
});
