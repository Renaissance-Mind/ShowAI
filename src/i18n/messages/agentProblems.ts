import { defineMessages } from "../index";
// Built-in Agent failures by code: what happened (summary), why or what it
// means (cause) and the actions offered. Shared by the Agent host and the UI.
export default defineMessages("agentProblems", {
  "zh-CN": {
    "summary.no_model_source": "还没有可用的模型",
    "summary.source_removed": "这个对话使用的模型来源已移除",
    "summary.credentials_missing": "「{name}」还没有可用的凭据",
    "summary.invalid_credentials": "模型服务拒绝了凭据",
    "summary.rate_limited": "模型服务暂时限制了请求",
    "summary.model_missing": "还没有选择模型",
    "summary.model_not_found": "模型服务找不到所选模型",
    "summary.runtime_missing": "还没有安装 Codex SDK",
    "summary.agent_missing": "没有找到所选的本机 Agent",
    "summary.sign_in_required": "本机 Agent 需要重新登录",
    "summary.network": "无法连接模型服务",
    "summary.sandbox": "Agent 的操作被沙盒拦截",
    "summary.process_exited": "{name} 意外退出",
    "summary.process_exited_code": "{name} 意外退出（退出码 {code}）",
    "summary.timeout": "Agent 运行超时",
    "summary.provider_error": "模型服务返回错误",
    "summary.unknown": "Agent 运行失败",
    "cause.no_model_source":
      "内置 Agent 需要一个模型来源：用 ChatGPT 套餐登录，或填写 API Key；也可以改用本机已安装的 Codex。",
    "cause.source_removed":
      "对话创建时使用的模型来源已从设置中移除。新建对话会使用当前的模型来源。",
    "cause.credentials_missing.chatgpt":
      "连接 ChatGPT 账号后即可使用这个来源。",
    "cause.credentials_missing.apiKey":
      "填写并保存这个来源的 API Key 后即可使用。",
    "cause.invalid_credentials.chatgpt":
      "ChatGPT 登录已失效或套餐不支持此模型（HTTP {status}）。重新连接 ChatGPT 后再试。",
    "cause.invalid_credentials.apiKey":
      "API Key 无效、已过期或没有调用此模型的权限（HTTP {status}）。请在 Agent 设置中更新 API Key。",
    "cause.rate_limited":
      "额度已用完或请求过于频繁（HTTP 429）。稍后重试，或检查服务商的用量与账单。",
    "cause.model_missing": "在 Agent 设置中为当前来源选择一个模型。",
    "cause.model_not_found":
      "所选模型不存在或当前账号无权使用。在 Agent 设置中换一个模型。",
    "cause.runtime_missing":
      "使用模型 API 前，需要先在 Agent 设置中安装 Codex SDK。",
    "cause.agent_missing": "安装并登录本机 Agent 后重新检测，或改用模型 API。",
    "cause.sign_in_required": "在本机 Agent 中重新登录后重新检测。",
    "cause.network": "检查网络、代理设置和来源地址是否正确，然后重试。",
    "cause.sandbox":
      "Agent 只能在自己的工作目录中写文件，所需的操作超出了这个范围。",
    "cause.process_exited":
      "Agent 进程没有完成本轮就退出了。查看日志了解原因后重试。",
    "cause.timeout": "Agent 长时间没有完成。检查网络或模型服务后重试。",
    "cause.provider_error":
      "服务商暂时无法处理请求（HTTP {status}）。稍后重试。",
    "cause.unknown": "重试一次；如果仍然失败，请报告问题并附上技术详情。",
    "safety.inputKept": "你的输入已保留，处理后可以直接发送。",
    "safety.pageUnchanged": "页面没有被这一轮修改，你的请求保留在对话中。",
    "action.connectChatgpt": "连接 ChatGPT",
    "action.apiKey": "填写 API Key",
    "action.useLocalCodex": "改用本机 Codex",
    "action.retry": "重试",
    "action.viewLog": "查看日志",
    "action.openSettings": "打开 Agent 设置",
    "action.chooseModel": "选择模型",
    "action.installSdk": "安装 Codex SDK",
    "action.newConversation": "新建对话",
    "action.guide": "安装说明",
    "action.recheck": "重新检测",
    "action.report": "报告问题",
    troubleshooting: "故障排查说明",
    "detail.truncated": "（只保留最后 {count} 个字符）",
    "detail.exitCode": "退出码",
  },
  en: {
    "summary.no_model_source": "No model is available yet",
    "summary.source_removed": "This conversation’s model source was removed",
    "summary.credentials_missing": "“{name}” has no usable credential yet",
    "summary.invalid_credentials": "The model service rejected the credential",
    "summary.rate_limited": "The model service is limiting requests",
    "summary.model_missing": "No model is selected yet",
    "summary.model_not_found":
      "The model service can’t find the selected model",
    "summary.runtime_missing": "The Codex SDK isn’t installed yet",
    "summary.agent_missing": "The selected local agent wasn’t found",
    "summary.sign_in_required": "The local agent needs you to sign in again",
    "summary.network": "Couldn’t reach the model service",
    "summary.sandbox": "The agent’s sandbox blocked an operation",
    "summary.process_exited": "{name} quit unexpectedly",
    "summary.process_exited_code":
      "{name} quit unexpectedly (exit code {code})",
    "summary.timeout": "The agent timed out",
    "summary.provider_error": "The model service returned an error",
    "summary.unknown": "The agent run failed",
    "cause.no_model_source":
      "The built-in agent needs a model source: sign in with a ChatGPT plan or add an API key. You can also switch to Codex installed on this Mac.",
    "cause.source_removed":
      "The model source this conversation started with was removed from settings. A new conversation uses the current source.",
    "cause.credentials_missing.chatgpt":
      "Connect your ChatGPT account to use this source.",
    "cause.credentials_missing.apiKey":
      "Add and save an API key for this source.",
    "cause.invalid_credentials.chatgpt":
      "The ChatGPT sign-in expired or the plan can’t use this model (HTTP {status}). Connect ChatGPT again and retry.",
    "cause.invalid_credentials.apiKey":
      "The API key is invalid, expired or not allowed to use this model (HTTP {status}). Update it in Agent settings.",
    "cause.rate_limited":
      "The quota is used up or requests are too frequent (HTTP 429). Retry later, or check usage and billing with the provider.",
    "cause.model_missing":
      "Choose a model for the current source in Agent settings.",
    "cause.model_not_found":
      "The selected model doesn’t exist or this account can’t use it. Choose another model in Agent settings.",
    "cause.runtime_missing":
      "Install the Codex SDK in Agent settings before using a model API.",
    "cause.agent_missing":
      "Install and sign in to the local agent, then check again, or use a model API instead.",
    "cause.sign_in_required":
      "Sign in again in the local agent, then check again.",
    "cause.network":
      "Check the network, proxy settings and the source address, then retry.",
    "cause.sandbox":
      "The agent can only write inside its own work folder, and the operation went beyond it.",
    "cause.process_exited":
      "The agent process quit before finishing this turn. Check the log, then retry.",
    "cause.timeout":
      "The agent didn’t finish in time. Check the network or model service, then retry.",
    "cause.provider_error":
      "The provider couldn’t handle the request right now (HTTP {status}). Retry later.",
    "cause.unknown":
      "Retry once. If it still fails, report the problem with the technical details.",
    "safety.inputKept":
      "Your input is kept; send it again once this is resolved.",
    "safety.pageUnchanged":
      "This turn didn’t change the page; your request stays in the conversation.",
    "action.connectChatgpt": "Connect ChatGPT",
    "action.apiKey": "Add API key",
    "action.useLocalCodex": "Use local Codex",
    "action.retry": "Retry",
    "action.viewLog": "View log",
    "action.openSettings": "Open Agent settings",
    "action.chooseModel": "Choose model",
    "action.installSdk": "Install Codex SDK",
    "action.newConversation": "New conversation",
    "action.guide": "Setup guide",
    "action.recheck": "Check again",
    "action.report": "Report problem",
    troubleshooting: "Troubleshooting guide",
    "detail.truncated": "(only the last {count} characters are kept)",
    "detail.exitCode": "Exit code",
  },
});
