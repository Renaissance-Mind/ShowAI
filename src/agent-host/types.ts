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
export type RuntimeStage =
  | "absent"
  | "fetching"
  | "downloading"
  | "verifying"
  | "installed"
  | "upToDate"
  | "failed";
export type RuntimeFailureCode =
  | "network"
  | "registry"
  | "integrity"
  | "disk"
  | "verify"
  | "unknown";
export interface RuntimeStatus {
  state: "absent" | "installing" | "ready" | "failed";
  version?: string;
  progress: string;
  root: string;
  error?: string;
  stage?: RuntimeStage;
  received?: number;
  total?: number;
  failure?: RuntimeFailureCode;
}
export type AgentProblemCode =
  | "no_model_source"
  | "source_removed"
  | "credentials_missing"
  | "invalid_credentials"
  | "rate_limited"
  | "model_missing"
  | "model_not_found"
  | "runtime_missing"
  | "agent_missing"
  | "sign_in_required"
  | "network"
  | "sandbox"
  | "process_exited"
  | "timeout"
  | "provider_error"
  | "unknown";
export interface AgentProblem {
  code: AgentProblemCode;
  summary: string;
  detail?: string;
  exitCode?: number;
  status?: number;
  chatgpt?: boolean;
  name?: string;
}
export interface AgentEvent {
  sequence: number;
  type: "message" | "tool" | "status" | "error";
  text: string;
  itemId?: string;
  state?: "running" | "completed" | "failed";
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
  problem?: AgentProblem;
}
export interface AgentTarget {
  kind: "page" | "text" | "blocks" | "board";
  pageId?: string;
  surfaceId?: string;
  blockIds?: string[];
  text?: string;
  reference?: import("../surface/agent-reference").CanvasReference;
  components?: AgentComponentContext[];
}
export interface AgentComponentContext {
  blockId: string;
  componentId?: string;
  name: string;
  label?: string;
  model: unknown;
}
export interface AgentTurn extends AgentTask {
  conversationId: string;
  prompt: string;
  target: AgentTarget;
  pageTitle?: string;
  baseHash?: string;
  resultHash?: string;
  wrotePage?: boolean;
  changedBlockIds?: string[];
  undone?: boolean;
}
export interface AgentConversation {
  id: string;
  projectId: string;
  title: string;
  mode: AgentMode;
  sourceId?: string;
  localAgent?: AgentId;
  threadId?: string;
  catalogRevision?: string;
  workspace: string;
  createdAt: string;
  updatedAt: string;
  turns: AgentTurn[];
  persistError?: string;
}
export interface AgentConversationSummary {
  id: string;
  projectId: string;
  title: string;
  mode: AgentMode;
  sourceId?: string;
  localAgent?: AgentId;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  running: boolean;
}
export interface AgentHostStatus {
  executionKind?: "cloud" | "mac" | "device";
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
    name: "ChatGPT 套餐", // i18n-exempt: default source name saved into settings
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
    name: "自定义服务", // i18n-exempt: default source name saved into settings
    baseUrl: "",
    credential: "api-key",
    protocol: "responses",
  },
] as const;
