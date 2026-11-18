import { defineMessages } from "../index";

export default defineMessages("codex-workbench", {
  "zh-CN": {
    loading: "正在打开 ShowAI…",
    failed: "无法打开 ShowAI 工作台",
    retry: "重试",
    connectionExpired: "工作台连接已更新，请重新打开 ShowAI 工作台",
    openInBrowser: "在浏览器中打开",
    reference: "引用到 Codex 对话",
    discuss: "在 Codex 中讨论",
    referenced: "已引用 · {version}",
    drafted: "已打开 Codex 草稿 · {version}",
    unavailable: "当前 Codex 宿主未提供对话引用接口",
    timedOut: "等待 Codex 对话回执超时",
  },
  en: {
    loading: "Opening ShowAI…",
    failed: "Could not open the ShowAI workbench",
    retry: "Retry",
    connectionExpired: "The workbench connection changed. Reopen ShowAI Workbench.",
    openInBrowser: "Open in browser",
    reference: "Reference in Codex chat",
    discuss: "Discuss in Codex",
    referenced: "Referenced · {version}",
    drafted: "Codex draft opened · {version}",
    unavailable: "This Codex host does not provide conversation references",
    timedOut: "Timed out waiting for Codex",
  },
});
