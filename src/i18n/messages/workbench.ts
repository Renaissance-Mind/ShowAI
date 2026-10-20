import { defineMessages } from "../index";

// Errors and generated names from shared workbench actions (desktop main and browser server).
export default defineMessages("workbench", {
  "zh-CN": {
    chooseProjectVisibility: "请选择项目是否在本设备显示。",
    invalidProjectAction: "无效的项目管理操作。",
    librarySwitched: "内容库已切换，请重新载入。",
    pageCopyTitle: "{title} 副本",
    referenceChanged: "页面在保存后又有了新的修改，请重新引用。",
    serveReady:
      "ShowAI 本地工作台：{url}\n内容库：{home}\n按 Ctrl+C 停止服务。CLI 可以独立运行。",
    openBrowserFailed: "无法自动打开浏览器：{message}\n请手动打开 {url}",
  },
  en: {
    chooseProjectVisibility: "Choose whether the project is shown on this device.",
    invalidProjectAction: "Invalid project action.",
    librarySwitched: "The content library changed. Reload to continue.",
    pageCopyTitle: "{title} copy",
    referenceChanged:
      "The page changed again after it was saved. Reference it again.",
    serveReady:
      "ShowAI local workbench: {url}\nContent library: {home}\nPress Ctrl+C to stop the service. The CLI can run on its own.",
    openBrowserFailed: "Couldn't open the browser automatically: {message}\nOpen {url} manually.",
  },
});
