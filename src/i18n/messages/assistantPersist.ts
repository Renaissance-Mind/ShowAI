import { defineMessages } from "../index";

// Agent panel only; kept apart from the assistant catalogue that readers load.
export default defineMessages("assistantPersist", {
  "zh-CN": {
    persistFailed:
      "这段对话没有写入磁盘，刷新或重启后最近的内容可能丢失。原因：{error}",
    draftCloseBlocked: "Agent 消息框中尚未发送的内容无法保存到本机：{error}",
  },
  en: {
    persistFailed:
      "This conversation could not be written to disk; its latest part may be lost after a refresh or restart. Reason: {error}",
    draftCloseBlocked:
      "The unsent text in the Agent message box couldn't be saved on this device: {error}",
  },
});
