import { defineMessages } from "../index";

// Custom (sandboxed or inline) component blocks inside pages and readers.
export default defineMessages("customComponents", {
  "zh-CN": {
    notInstalled: "组件尚未安装",
    notInstalledError: "组件尚未安装。",
    installRequired: "需要安装组件 {component}。页面数据已保留。",
    installRequiredIntegrity:
      "需要安装组件 {component}（{integrity}）。页面数据已保留。",
    ambiguousVersion: "组件 {component} 有多个不同内容版本，请指定完整性指纹。",
    invalidJson: "JSON 格式不正确。",
    notJsonObject: "组件数据必须是有效的 JSON 对象。",
    dataTooLarge: "组件数据超限。",
    dataChanged: "组件数据已更新，请重新打开编辑后再修改。",
    validationTimeout: "组件未响应数据校验，请重新加载组件后再试。",
    cannotDisplay: "组件无法显示。",
    viewportLockFailed: "无法保存阅读锁状态：{error}",
    invalidProps: "数据不符合组件的属性要求。",
    editData: "编辑组件数据",
    data: "组件数据",
    propsJson: "组件属性 JSON",
    validating: "校验中…",
    apply: "应用",
    inlineOnlyInConversation: "此运行方式仅用于对话内的独立页面。",
    inlineUnavailable:
      "组件 {component} 尚无对话内运行版本，请从源码导入新版本后重新导出。",
    inlineBlocked: "宿主未允许此组件运行。",
  },
  en: {
    notInstalled: "Component not installed",
    notInstalledError: "This component isn't installed.",
    installRequired:
      "Install component {component} to show this block. The page data is kept.",
    installRequiredIntegrity:
      "Install component {component} ({integrity}) to show this block. The page data is kept.",
    ambiguousVersion:
      "Component {component} has several versions with different content. Specify its integrity fingerprint.",
    invalidJson: "The JSON is malformed.",
    notJsonObject: "Component data must be a valid JSON object.",
    dataTooLarge: "The component data is too large.",
    dataChanged:
      "The component data has changed. Reopen the editor before making changes.",
    validationTimeout:
      "The component didn't respond to data validation. Reload the component and try again.",
    cannotDisplay: "This component can't be displayed.",
    viewportLockFailed: "Couldn't save the reading lock state: {error}",
    invalidProps: "The data doesn't match the component's property rules.",
    editData: "Edit component data",
    data: "Component data",
    propsJson: "Component properties JSON",
    validating: "Validating…",
    apply: "Apply",
    inlineOnlyInConversation:
      "This mode only runs in standalone pages inside a conversation.",
    inlineUnavailable:
      "Component {component} has no in-conversation build yet. Import a new version from source and export again.",
    inlineBlocked: "The host didn't allow this component to run.",
  },
});
