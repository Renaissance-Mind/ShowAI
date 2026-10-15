# Use ShowAI in ChatGPT on the web

**Language:** English | [简体中文](i18n/chatgpt.zh-CN.md) · [Documentation](README.md)

Connect ShowAI's hosted MCP server to create, save, edit and present interactive pages in a chat on [chatgpt.com](https://chatgpt.com). After account setup, everyday web use does not require a local ShowAI process or a separate Skill installation. Your account/workspace must permit custom MCP servers.

## 1. Prepare a ShowAI account

The account/sync base URL is `https://showai.renaissancemind.ai/cloud`.

Registration is controlled. Ask the operator for a registration key, or a project administrator for an invitation. In the desktop/local browser workbench, choose **Settings → Servers and sync → Server accounts → Add server account**, enter that base URL, and register with an account name, password of at least 12 characters and the key.

For an invitation, paste its link into **Project sync → Join shared project** and register through the invitation card; this route needs no registration key. Existing accounts can skip registration. Projects stored only on your computer must synchronize to this account before the remote MCP server can see them.

## 2. Add the MCP connection

Open [ChatGPT Plugins](https://chatgpt.com/plugins), choose **+ → Add custom MCP server**, create the plugin and install it. Labels and availability can vary by account/workspace; see [OpenAI's custom MCP instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use).

| Setting                                | Value                                         |
| -------------------------------------- | --------------------------------------------- |
| Name                                   | `ShowAI`                                      |
| Server URL                             | `https://agent.showai.renaissancemind.ai/mcp` |
| Authentication                         | **OAuth or no authentication**                |
| OAuth client registration, if prompted | **Dynamic Client Registration (DCR)**         |
| Client ID / Client Secret              | Leave blank for DCR                           |

Use `/mcp` for the agent connection and `/cloud` for accounts/synchronization.

## 3. Sign in and authorize

Sign in with your ShowAI account/password or GitHub/Google already linked to that account. Provider sign-in opens another tab. Copy its eight-character completion code back into the original ShowAI authorization tab, then continue to consent. The provider must be linked to the intended existing ShowAI account.

Choose either one existing project or **all projects this account can access now and in the future**. Project creation requires the account-wide choice and **project creation** (`projects.create`) consent, alongside reading/editing. Member roles still apply: viewers cannot write.

Public components, starter templates and temporary rendering work without sign-in. Private project operations require authorization. Each server account has its own connection.

## 4. Create and continue a Page

Start a new chat, type `@`, choose **ShowAI**, then ask:

> List my ShowAI projects. Create a project called My Interactive Notes, make a page explaining opportunity cost with an adjustable example, save it, confirm synchronization and present it here.

Review writes when ChatGPT prompts. Continue by naming the saved project/Page or its ID. The agent reads the current source, saves with its hash/revision, checks the sync receipt and presents the saved Page. `page_present` keeps complete HTML/source even when only selected blocks fit the chat preview.

Guidance comes from the server's `guide` tool, using the same seven workflow sources as the local plugin. This does not register native Skills in ChatGPT. A host may initially show only some tools; discover additional tools on the selected connection when the guide lists them.

## Updates and troubleshooting

| Situation                                                     | Action                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Server/guidance updated                                       | Start a new chat; subsequent calls use the deployed server                           |
| Tools, parameters, auth metadata or preview resources changed | Refresh the ShowAI connection in Plugins, then start a new chat and select `@ShowAI` |
| Expired login or broader project access needed                | Reauthorize the connection                                                           |
| Local project missing                                         | Sync it to the same server account; confirm project membership                       |
| Cannot create a project                                       | Check account-wide consent, `projects.create` and server policy                      |
| Provider login fails                                          | Check account binding and return the completion code to the original tab             |
| Preview fails or expires                                      | Present the saved Page again; retain/download full HTML/source                       |
| Tool name appears in guide but is not loaded                  | Use host tool discovery scoped to this connection                                    |

HTTP preview/download capability URLs expire after one hour. The saved project remains the durable source. A successful save and a successful sync have separate receipts; inspect synchronization errors before claiming server publication.

No ZIP download is needed for this connection. Share this guide and endpoint; each person adds and authorizes their own connection. For a self-hosted endpoint see [MCP deployment](cloud-mcp-deployment.md); for transport and permissions see [Agent integration](agent-integration.md).
