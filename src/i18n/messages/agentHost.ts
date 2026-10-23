import { defineMessages } from "../index";

// Agent host status, progress and errors (Electron main / browser server).
export default defineMessages("agentHost", {
  "zh-CN": {
    "gateway.unsupportedTool": "Chat Completions 来源不支持工具 {type}。",
    "gateway.unknownToolCall": "无法恢复工具调用 {name}。",
    "gateway.unsupportedInput": "Chat Completions 来源不支持输入 {type}。",
    "gateway.unsupportedContext": "Chat Completions 来源不支持上下文 {type}。",
    "gateway.streamIncomplete": "模型响应流未完整结束。",
    "gateway.callFailed": "模型调用失败",
    "gateway.responseIncomplete": "模型未完成响应：{reason}",
    "gateway.streamInterrupted": "模型响应流中断，未收到完成事件。",
    "gateway.unknownTool": "模型调用了未知工具 {name}。",
    "gateway.rejected": "模型服务拒绝调用：HTTP {status}",
    "source.duplicateId": "来源 ID 重复。",
    "source.selectExisting": "请选择已有的模型来源。",
    "source.insecureUrl":
      "模型地址需使用 HTTPS；本机服务可以使用 HTTP。地址中不能包含凭据。",
    "source.chatgptOfficialOnly": "ChatGPT 授权只能用于官方 Responses API。",
    "source.hostedCredential": "这份凭据由来源服务器管理，请在来源服务器更新。",
    "source.credentialTypeChanged": "请先移除原来源，再添加不同类型的连接。",
    "source.inUse": "请先停止使用此来源的任务，再修改连接。",
    "source.stopTasksFirst": "请先停止正在使用模型来源的任务。",
    "source.select": "请选择模型来源。",
    "source.saveApiKey": "请保存此来源的 API Key。",
    "source.modelsFailed":
      "无法获取模型列表：HTTP {status}。可在来源中填写模型名称。",
    "source.reauthorizeOnOrigin":
      "请在资源来源设备重新授权，再保存到来源服务器。",
    "source.usesApiKey": "此来源使用 API Key。",
    "resources.notConnected": "服务器资源管理尚未连接。",
    "resources.unavailable": "这份服务器资源尚不可用，请刷新来源列表。",
    "publish.finishFirst": "请先完成账号授权或停止使用这份来源的任务。",
    "publish.alreadyHosted": "这份来源已经由服务器管理。",
    "publish.pendingElsewhere":
      "这份授权仍在保存到另一台服务器，请先完成原来的保存。",
    "publish.authorizeLocally": "请先在本设备完成来源授权。",
    "publish.authorizeChatgptPlan":
      "请先授权使用 ChatGPT 套餐，再保存到服务器。",
    "agent.notFound": "未找到程序",
    "agent.found": "已找到程序，运行连接测试可确认调用能力",
    "agent.codexReady": "已有 Codex 登录",
    "agent.codexSignIn": "请先在本机 Codex 中登录",
    "agent.kimiConfigured": "已配置 Kimi 模型来源，调用测试会确认登录是否有效",
    "agent.testToConfirm": "需要运行连接测试确认登录",
    "agent.signInExpired": "本机登录已失效，请先在此 Agent 中登录",
    "isolation.pluginInstallFailed": "ShowAI 插件安装失败：{detail}",
    "isolation.verifyPluginFailed": "无法验证独立插件安装。",
    "isolation.onlyShowai": "独立运行时必须仅启用 ShowAI 插件。",
    "isolation.pluginOutside": "ShowAI 插件不在独立运行目录内。",
    "isolation.skillsFailed": "独立运行时 Skill 隔离验证失败。",
    "isolation.configFailed": "独立运行时配置失败",
    "task.interrupted": "上次运行已中断，可以继续会话或重新执行。",
    "conversation.notFound": "对话记录不存在。",
    "conversation.stopFirst": "请先停止正在执行的一轮。",
    "conversation.busy": "这个对话正在执行，请等它完成或停止后再发送。",
    "conversation.sourceMissing": "这个对话使用的模型来源已移除，请新建对话。",
    "conversation.recapped":
      "这个 Agent 不支持续接会话，已把前几轮摘要附在请求中。",
    "turn.undoUnavailable": "这一轮没有可撤销的页面修改。",
    "turn.undoChanged": "页面包含本轮之外的修改，不能直接撤销。",
    "turn.undoRunning": "这一轮仍在执行，停止后才能撤销。",
    "task.connectionTest": "连接测试",
    "task.checkingModel": "正在检验真实模型调用…",
    "task.connecting": "正在连接 Agent…",
    "task.stopped": "任务已停止",
    "task.unexpectedTestResult": "模型未返回预期的测试结果。",
    "task.testPassed": "真实调用已通过",
    "task.completed": "任务已完成",
    "task.signInRequired":
      "本机 Agent 需要登录。请在原来的 Agent 中登录后重试。",
    "task.chooseModel": "请先选择或填写模型。",
    "task.agentFailed": "Agent 执行失败",
    "task.turnIncomplete": "Agent 未完成本轮任务。",
    "task.filesUpdated": "工作文件已更新",
    "task.agentMissing": "未找到所选本机 Agent，请先安装并登录。",
    "task.codexIncomplete": "本机 Codex 未完成调用。",
    "task.claudeIncomplete": "Claude Code 未完成调用。",
    "task.toolRunning": "工具执行中",
    "task.toolPermission": "Agent 请求执行工具",
    "task.stopReason": "Agent 未完成任务：{reason}",
    "task.notFound": "任务记录不存在。",
    "task.fileOutsideWorkspace": "只能下载此任务工作区内的文件。",
    "task.filesOnly": "只能下载文件。",
    "task.approvalExpired": "此操作确认已失效。",
    "task.timeout": "Agent 调用超时，请检查网络或模型服务。",
    "runtime.notInstalled": "尚未安装",
    "runtime.installed": "Codex SDK 已安装",
    "runtime.installFirst": "请先在设置中安装 Codex SDK。",
    "runtime.fetching": "正在获取官方安装包…",
    "runtime.installFailed": "安装失败",
    "runtime.upToDate": "Codex SDK 已是当前版本",
    "runtime.downloading": "正在下载 Codex SDK {version} 与独立运行时…",
    "runtime.verifying": "正在验证安装…",
    "chatgpt.authFailed": "ChatGPT 授权失败：{reason}",
    "chatgpt.inProgress": "已有 ChatGPT 授权正在进行，请完成或取消后重试。",
    "chatgpt.serverManaged": "这份授权由服务器管理，请在服务器连接中重新授权。",
    "chatgpt.cancelled": "已取消 ChatGPT 授权。",
    "chatgpt.authorizationFailed": "ChatGPT 授权失败（{error}）。",
    "chatgpt.accountMismatch": "授权账号与已选择的连接不一致。",
    "chatgpt.connectedTitle": "已连接 ChatGPT",
    "chatgpt.connectedBody": "可以关闭此页面，返回 ShowAI。",
    "chatgpt.callbackFailed": "授权未完成，请返回 ShowAI 查看原因并重试。",
    "chatgpt.timedOut": "授权等待已超时，请重新连接。",
    "chatgpt.connectFirst": "请先连接 ChatGPT 账号。",
    "chatgpt.reauthorizePlan": "请重新连接 ChatGPT 并授权使用套餐。",
    "chatgpt.disconnected": "ChatGPT 连接已断开。",
    "chatgpt.expired": "ChatGPT 授权已过期，请重新连接。",
    "chatgpt.revocationUnavailable": "无法获取 ChatGPT 撤销入口，请稍后重试。",
    "chatgpt.revokeFailed": "ChatGPT 撤销授权失败：HTTP {status}",
    "credentials.notConnected": "服务器凭据管理尚未连接。",
  },
  en: {
    "gateway.unsupportedTool":
      "This Chat Completions source doesn't support the {type} tool.",
    "gateway.unknownToolCall": "Couldn't restore the tool call {name}.",
    "gateway.unsupportedInput":
      "This Chat Completions source doesn't support {type} input.",
    "gateway.unsupportedContext":
      "This Chat Completions source doesn't support {type} context items.",
    "gateway.streamIncomplete":
      "The model response stream ended before it was complete.",
    "gateway.callFailed": "Model call failed",
    "gateway.responseIncomplete":
      "The model didn't finish its response: {reason}",
    "gateway.streamInterrupted":
      "The model response stream was interrupted before it finished.",
    "gateway.unknownTool": "The model called an unknown tool: {name}.",
    "gateway.rejected": "The model service rejected the request: HTTP {status}",
    "source.duplicateId": "Duplicate source ID.",
    "source.selectExisting": "Choose an existing model source.",
    "source.insecureUrl":
      "Model URLs must use HTTPS (local services can use HTTP), and they can't contain credentials.",
    "source.chatgptOfficialOnly":
      "ChatGPT authorization only works with the official Responses API.",
    "source.hostedCredential":
      "This credential is managed by its source server. Update it there.",
    "source.credentialTypeChanged":
      "Remove the existing source before adding a different type of connection.",
    "source.inUse":
      "Stop tasks that use this source before changing its connection.",
    "source.stopTasksFirst": "Stop tasks that are using a model source first.",
    "source.select": "Choose a model source.",
    "source.saveApiKey": "Save an API key for this source.",
    "source.modelsFailed":
      "Couldn't load the model list: HTTP {status}. You can enter a model name in the source instead.",
    "source.reauthorizeOnOrigin":
      "Reauthorize on the device that shared this resource, then save it to the source server again.",
    "source.usesApiKey": "This source uses an API key.",
    "resources.notConnected": "Server resource management isn't connected yet.",
    "resources.unavailable":
      "This server resource isn't available yet. Refresh the source list.",
    "publish.finishFirst":
      "Finish account authorization or stop tasks that use this source first.",
    "publish.alreadyHosted": "This source is already managed by a server.",
    "publish.pendingElsewhere":
      "This authorization is still being saved to another server. Finish that save first.",
    "publish.authorizeLocally": "Authorize this source on this device first.",
    "publish.authorizeChatgptPlan":
      "Authorize use of your ChatGPT plan before saving it to a server.",
    "agent.notFound": "Program not found",
    "agent.found": "Program found. Run a connection test to confirm it works",
    "agent.codexReady": "Signed in to Codex",
    "agent.codexSignIn": "Sign in to Codex on this computer first",
    "agent.kimiConfigured":
      "Kimi model source configured. A test call will confirm the sign-in works",
    "agent.testToConfirm": "Run a connection test to confirm the sign-in",
    "agent.signInExpired": "Local sign-in expired. Sign in to this Agent first",
    "isolation.pluginInstallFailed":
      "Couldn't install the ShowAI plugin: {detail}",
    "isolation.verifyPluginFailed":
      "Couldn't verify the isolated plugin installation.",
    "isolation.onlyShowai":
      "The isolated runtime must have only the ShowAI plugin enabled.",
    "isolation.pluginOutside":
      "The ShowAI plugin isn't inside the isolated runtime directory.",
    "isolation.skillsFailed":
      "Couldn't verify Skill isolation in the isolated runtime.",
    "isolation.configFailed": "Couldn't set up the isolated runtime",
    "task.interrupted":
      "The last run was interrupted. You can continue the session or run it again.",
    "conversation.notFound": "Conversation not found.",
    "conversation.stopFirst": "Stop the running turn first.",
    "conversation.busy":
      "This conversation is still running. Wait for it to finish or stop it before sending.",
    "conversation.sourceMissing":
      "The model source used by this conversation was removed. Start a new conversation.",
    "conversation.recapped":
      "This Agent can't resume sessions, so a summary of earlier turns was included.",
    "turn.undoUnavailable": "This turn didn't change the page.",
    "turn.undoChanged":
      "The page contains changes from outside this turn, so it can't be undone directly.",
    "turn.undoRunning": "This turn is still running. Stop it before undoing.",
    "task.connectionTest": "Connection test",
    "task.checkingModel": "Testing a real model call…",
    "task.connecting": "Connecting to Agent…",
    "task.stopped": "Task stopped",
    "task.unexpectedTestResult":
      "The model didn't return the expected test result.",
    "task.testPassed": "Test call succeeded",
    "task.completed": "Task completed",
    "task.signInRequired":
      "The local Agent needs you to sign in. Sign in to that Agent and try again.",
    "task.chooseModel": "Choose or enter a model first.",
    "task.agentFailed": "Agent run failed",
    "task.turnIncomplete": "The Agent didn't finish this turn.",
    "task.filesUpdated": "Work files updated",
    "task.agentMissing":
      "The selected local Agent wasn't found. Install it and sign in first.",
    "task.codexIncomplete": "The local Codex call didn't finish.",
    "task.claudeIncomplete": "The Claude Code call didn't finish.",
    "task.toolRunning": "Running tool",
    "task.toolPermission": "Agent wants to run a tool",
    "task.stopReason": "The Agent didn't finish the task: {reason}",
    "task.notFound": "Task record not found.",
    "task.fileOutsideWorkspace":
      "Only files in this task's workspace can be downloaded.",
    "task.filesOnly": "Only files can be downloaded.",
    "task.approvalExpired": "This approval request is no longer valid.",
    "task.timeout":
      "The Agent call timed out. Check your network or model service.",
    "runtime.notInstalled": "Not installed",
    "runtime.installed": "Codex SDK installed",
    "runtime.installFirst": "Install the Codex SDK in Settings first.",
    "runtime.fetching": "Getting the official package…",
    "runtime.installFailed": "Installation failed",
    "runtime.upToDate": "Codex SDK is up to date",
    "runtime.downloading":
      "Downloading Codex SDK {version} and the isolated runtime…",
    "runtime.verifying": "Verifying the installation…",
    "chatgpt.authFailed": "ChatGPT authorization failed: {reason}",
    "chatgpt.inProgress":
      "A ChatGPT authorization is already in progress. Finish or cancel it, then try again.",
    "chatgpt.serverManaged":
      "This authorization is managed by a server. Reauthorize it from the server connection.",
    "chatgpt.cancelled": "ChatGPT authorization was cancelled.",
    "chatgpt.authorizationFailed": "ChatGPT authorization failed ({error}).",
    "chatgpt.accountMismatch":
      "The authorized account doesn't match the selected connection.",
    "chatgpt.connectedTitle": "Connected to ChatGPT",
    "chatgpt.connectedBody": "You can close this page and return to ShowAI.",
    "chatgpt.callbackFailed":
      "Authorization didn't finish. Return to ShowAI to see why, then try again.",
    "chatgpt.timedOut": "Authorization timed out. Connect again.",
    "chatgpt.connectFirst": "Connect a ChatGPT account first.",
    "chatgpt.reauthorizePlan":
      "Reconnect ChatGPT and authorize use of your plan.",
    "chatgpt.disconnected": "ChatGPT is disconnected.",
    "chatgpt.expired": "ChatGPT authorization expired. Connect again.",
    "chatgpt.revocationUnavailable":
      "Couldn't reach ChatGPT's revocation endpoint. Try again later.",
    "chatgpt.revokeFailed":
      "Couldn't revoke ChatGPT authorization: HTTP {status}",
    "credentials.notConnected":
      "Server credential management isn't connected yet.",
  },
});
