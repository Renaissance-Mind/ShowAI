export type AgentMode = "local" | "api";
export type AgentId = "codex" | "kimi" | "claude" | "gemini" | "opencode";
export interface ModelSource {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  protocol: "responses" | "chat";
  credential: "api-key" | "chatgpt";
  apiKeyPresent?: boolean;
  account?: string;
  connected?: boolean;
  planEnabled?: boolean;
  refreshOwner?: "local" | "server";
  hosted?: {
    connectionId: string;
    resourceId: string;
    serverName: string;
    url: string;
  };
}
export interface AgentSettings {
  mode: AgentMode;
  localAgent: AgentId;
  sourceId: string;
  sources: ModelSource[];
}
export interface LocalAgent {
  id: AgentId;
  name: string;
  path: string | null;
  version: string;
  auth: "ready" | "missing" | "unknown";
  detail: string;
  callable: boolean | null;
  testedAt?: string;
}
export interface RuntimeStatus {
  state: "absent" | "installing" | "ready" | "failed";
  version?: string;
  progress: string;
  root: string;
  error?: string;
}
export interface AgentEvent {
  sequence: number;
  type: "message" | "tool" | "status" | "error";
  text: string;
}
export interface AgentTask {
  id: string;
  projectId: string;
  pageId?: string;
  label: string;
  mode: AgentMode;
  sourceId?: string;
  localAgent?: AgentId;
  state: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  workspace: string;
  threadId?: string;
  events: AgentEvent[];
  approvals?: {
    id: string;
    title: string;
    options: { id: string; name: string; kind: string }[];
  }[];
  error?: string;
}
export interface AgentHostStatus {
  settings: AgentSettings;
  agents: LocalAgent[];
  runtime: RuntimeStatus;
  workspaceRoot: string;
  credentialRoot: string;
  tasks: AgentTask[];
  authorization: {
    state: "idle" | "pending" | "completed" | "failed";
    error?: string;
  };
}
export const sourcePresets = [
  {
    provider: "chatgpt",
    name: "ChatGPT 套餐",
    baseUrl: "https://api.openai.com/v1",
    credential: "chatgpt",
    protocol: "responses",
  },
  {
    provider: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    credential: "api-key",
    protocol: "responses",
  },
  {
    provider: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    credential: "api-key",
    protocol: "responses",
  },
  {
    provider: "openai",
    name: "OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    credential: "api-key",
    protocol: "responses",
  },
  {
    provider: "moonshot",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    credential: "api-key",
    protocol: "chat",
  },
  {
    provider: "custom",
    name: "自定义服务",
    baseUrl: "",
    credential: "api-key",
    protocol: "responses",
  },
] as const;
