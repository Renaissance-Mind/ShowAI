import { defineMessages } from "../index";

// Workbench shell: the root error page, menu fallbacks and the browser connection.
export default defineMessages("appShell", {
  "zh-CN": {
    "crash.title": "ShowAI 界面出错了",
    "crash.detail":
      "界面遇到了无法继续的错误。已输入的内容保留在本机草稿中，重新加载窗口后可以继续编辑。",
    "crash.chunkTitle": "ShowAI 界面文件加载失败",
    "crash.chunkDetail":
      "部分界面文件没有加载成功，可能是应用刚刚更新或本机服务已重启。已输入的内容保留在本机草稿中，重新加载窗口即可继续。",
    "crash.reload": "重新加载窗口",
    "crash.copy": "复制错误详情",
    "crash.copied": "已复制错误详情",
    "crash.report": "报告问题",
    "diagnostics.copied": "已复制诊断信息",
    "connection.unreachable":
      "无法连接本机 ShowAI 服务。请确认启动 ShowAI 的终端仍在运行，然后重试。",
    "connection.lost":
      "与本机 ShowAI 服务的连接已断开。正在自动重连，重连前的修改会保留在本页中。",
    "connection.restarted": "本机 ShowAI 服务已重启，请刷新页面后继续。",
    "connection.refresh": "刷新",
  },
  en: {
    "crash.title": "Something went wrong in ShowAI",
    "crash.detail":
      "The interface hit an error it can't recover from. Your typing is kept in local drafts; reload the window to continue editing.",
    "crash.chunkTitle": "ShowAI couldn't load part of its interface",
    "crash.chunkDetail":
      "Some interface files didn't load, possibly because the App was just updated or the local service restarted. Your typing is kept in local drafts; reload the window to continue.",
    "crash.reload": "Reload Window",
    "crash.copy": "Copy Error Details",
    "crash.copied": "Error details copied",
    "crash.report": "Report a Problem",
    "diagnostics.copied": "Diagnostic information copied",
    "connection.unreachable":
      "Can't reach the local ShowAI service. Make sure the terminal running ShowAI is still open, then try again.",
    "connection.lost":
      "Lost the connection to the local ShowAI service. Reconnecting automatically; changes made meanwhile stay on this page.",
    "connection.restarted":
      "The local ShowAI service restarted. Refresh the page to continue.",
    "connection.refresh": "Refresh",
  },
});
