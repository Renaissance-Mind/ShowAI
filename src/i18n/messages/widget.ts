import { defineMessages } from "../index";

// Fallback shown when a block cannot be rendered: the component status card.
export default defineMessages("widget", {
  "zh-CN": {
    unavailable: "区块暂时无法显示",
    viewData: "查看组件数据",
    downloadData: "下载组件数据",
    renderFailed: "组件渲染失败。",
    invalidData: "区块数据格式不正确。",
    loading: "正在加载组件…",
    sharedDataUnavailable: "此组件的数据来自共享数据，在当前位置无法读取。",
    "status.crashed": "「{name}」组件运行出错",
    "status.invalid": "「{name}」组件的参数不符合要求",
    "status.missing": "缺少组件「{name}」",
    "status.unavailable": "「{name}」组件暂时无法显示",
    "status.safety": "页面其他内容不受影响，组件数据已保留。",
    "status.crashedCause":
      "组件代码在显示时出错。可能是代码问题，也可能是数据缺少它需要的内容。",
    "status.rejectionCause": "组件在后台执行的操作出错，显示的内容可能不完整。",
    "status.missingCause": "页面使用的组件 {component} 不在当前内容库中。",
    "status.missingBuiltinCause": "当前版本的 ShowAI 没有「{kind}」组件。",
    "status.moreIssues": "还有 {count} 项",
    "status.retry": "重试",
    "status.askAgent": "让 Agent 修复",
    "status.askAgentInstall": "让 Agent 安装或重建",
    "status.copyDetails": "复制错误详情",
    "status.copyId": "复制组件标识",
    "status.copied": "已复制",
    "status.copyFailed": "无法复制，请在技术详情中手动选择文字。",
    "status.findInLibrary": "在组件库中查找",
    "status.details": "技术详情",
    "status.reportProblem": "报告问题",
    "status.promptCrashed":
      "页面中的「{name}」组件（{component}）运行出错：{error}\n请修复这个组件，保留它现有的数据。",
    "status.promptInvalid":
      "页面中的「{name}」组件（{component}）的参数不符合要求：{error}\n请修正这个组件的数据，使它符合组件的参数说明。",
    "status.promptMissing":
      "页面使用的组件 {component} 不在当前内容库中。请安装它；如果找不到，请按页面中保留的数据重建一个兼容的组件。",
  },
  en: {
    unavailable: "Block can't be displayed right now",
    viewData: "View component data",
    downloadData: "Download component data",
    renderFailed: "The component failed to render.",
    invalidData: "The block data format is invalid.",
    loading: "Loading component…",
    sharedDataUnavailable:
      "This component's data comes from shared data, which can't be read here.",
    "status.crashed": "The “{name}” component ran into an error",
    "status.invalid":
      "The “{name}” component's parameters don't match its rules",
    "status.missing": "Component “{name}” is missing",
    "status.unavailable": "The “{name}” component can't be displayed here",
    "status.safety":
      "The rest of the page isn't affected, and the component data is kept.",
    "status.crashedCause":
      "The component's code failed while displaying. This may be a code problem, or the data may lack something the component needs.",
    "status.rejectionCause":
      "Something the component was doing in the background failed. What it shows may be incomplete.",
    "status.missingCause":
      "This page uses component {component}, which isn't in the current library.",
    "status.missingBuiltinCause":
      "This version of ShowAI has no “{kind}” component.",
    "status.moreIssues": "{count} more",
    "status.retry": "Try again",
    "status.askAgent": "Ask the Agent to fix it",
    "status.askAgentInstall": "Ask the Agent to install or rebuild it",
    "status.copyDetails": "Copy error details",
    "status.copyId": "Copy component ID",
    "status.copied": "Copied",
    "status.copyFailed":
      "Couldn't copy. Select the text in the technical details instead.",
    "status.findInLibrary": "Find in component library",
    "status.details": "Technical details",
    "status.reportProblem": "Report a problem",
    "status.promptCrashed":
      "The “{name}” component ({component}) on this page ran into an error: {error}\nPlease fix the component and keep its existing data.",
    "status.promptInvalid":
      "The parameters of the “{name}” component ({component}) on this page don't match its rules: {error}\nPlease correct the component's data so it follows the component's parameter documentation.",
    "status.promptMissing":
      "This page uses component {component}, which isn't in the current library. Please install it, or rebuild a compatible component from the data kept on the page.",
  },
});
