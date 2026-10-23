import { defineMessages } from "../index";

// Agent panel only; kept apart from the assistant catalogue that readers load.
export default defineMessages("assistantPersist", {
  "zh-CN": {
    persistFailed:
      "这段对话没有写入磁盘，刷新或重启后最近的内容可能丢失。原因：{error}",
  },
  en: {
    persistFailed:
      "This conversation could not be written to disk; its latest part may be lost after a refresh or restart. Reason: {error}",
  },
});
