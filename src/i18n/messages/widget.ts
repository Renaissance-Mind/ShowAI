import { defineMessages } from "../index";

// Fallback shown when a block cannot be rendered.
export default defineMessages("widget", {
  "zh-CN": {
    unavailable: "区块暂时无法显示",
    needsCheck: "区块数据需要检查",
    notRegistered: "尚未注册「{kind}」区块",
    dataKept: "原始数据已保留。注册对应的 React 组件后即可显示。",
    viewData: "查看区块数据",
    downloadData: "下载区块数据",
    renderFailed: "组件渲染失败。",
    invalidData: "区块数据格式不正确。",
    loading: "正在加载组件…",
    sharedDataUnavailable: "此组件的数据来自共享数据，在当前位置无法读取。",
  },
  en: {
    unavailable: "Block can't be displayed right now",
    needsCheck: "Block data needs checking",
    notRegistered: "The “{kind}” block isn't registered",
    dataKept:
      "The original data is kept. It will display once the matching React component is registered.",
    viewData: "View block data",
    downloadData: "Download block data",
    renderFailed: "The component failed to render.",
    invalidData: "The block data format is invalid.",
    loading: "Loading component…",
    sharedDataUnavailable: "This component's data comes from shared data, which can't be read here.",
  },
});
