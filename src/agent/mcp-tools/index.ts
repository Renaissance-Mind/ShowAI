import { catalogTools, contextTools } from "./catalog";
import { datasetTools } from "./datasets";
import { organizationTools } from "./organization";
import { pagePresentTool, pageTools } from "./pages";
import type { ToolDeclaration } from "./tool";
import { workspaceTools } from "./workspace";

/** The project tools of an MCP connection, in the order tools/list shows them. */
export const PROJECT_TOOLS: readonly ToolDeclaration[] = [
  ...datasetTools,
  ...organizationTools,
  ...contextTools,
  ...pageTools,
  ...catalogTools,
  ...workspaceTools,
  pagePresentTool,
];
