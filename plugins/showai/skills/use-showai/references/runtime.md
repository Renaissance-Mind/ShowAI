# 运行入口与内容库

决定使用本地 ShowAI，但缺少可信运行入口或内容库时读取本文件。CLI、阅读器和编译器由独立软件提供。已有远程 MCP 时按 [跨宿主接入](integration.md) 查询能力，不查本机路径。已有可信本地入口时直接复用。

## 取得配置

配置来源依次为：用户或宿主已提供的连接配置；`SHOWAI_HOME` 指向内容库内的 `agent-runtime.json`；默认内容库 `~/.showai/agent-runtime.json`。先采用已知的明确配置；仅缺少入口时查后续来源。不要为了遵循顺序覆盖用户选定的内容库。

需要查看本机环境和默认文件时，可使用文件读取工具或以下命令：

```sh
printenv SHOWAI_HOME
cat "$SHOWAI_HOME/agent-runtime.json"
cat "$HOME/.showai/agent-runtime.json"
```

第二条仅在 SHOWAI_HOME 非空且对应文件存在时执行；第三条仅在尚无明确配置且默认文件存在时执行。环境变量未设置、文件不存在，均表示该来源未提供配置。`~` 和 HOME 指当前运行宿主用户的主目录；本机路径不能直接用于另一台机器。

配置由软件 `runtime register` 或桌面启动登记，结构如下。路径为字段示例，执行时使用读到的真实值：

```json
{
  "format": "showai-agent-runtime",
  "protocol": 1,
  "version": "0.8.0",
  "home": "/absolute/library",
  "launch": {
    "command": "/absolute/node-or-electron",
    "args": ["/absolute/runtime/scripts/cli.mjs"],
    "env": {"SHOWAI_HOME": "/absolute/library"}
  }
}
```

`home` 是实际内容库，`launch.command` 是可执行文件，args 是已有参数数组，env 是调用时合并进当前环境的变量。Electron 入口还可能包含 `ELECTRON_RUN_AS_NODE: "1"`，须保留。插件目录不是可执行软件位置。

如果用户选择了自定义内容库，但没有提供它的位置或连接配置，默认文件不能证明自定义库的位置。说明缺少的连接信息，请用户提供所选库的配置。桌面软件的“设置 → 连接 Agent”可供用户取得配置；这个来源不是要求 Agent 自动操作桌面的步骤。没有可执行软件或环境不能访问它时说明实际缺项。

## 执行配置中的命令

以参数数组执行：可执行文件取 `launch.command`，参数取 `launch.args` 追加本次 CLI 参数，环境合并当前环境与 `launch.env`；以任务目录作为 cwd。`runtime info --json` 对应追加 `["runtime", "info", "--json"]`。不要将配置字符串交给 shell eval。

外部 Node 可用时，以下示例可直接调用配置中的入口。替换配置绝对路径，保留代码，再改变配置路径后面的 CLI 参数即可执行其他命令：

```sh
node --input-type=module - /absolute/library/agent-runtime.json runtime info --json <<'JS'
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [configPath, ...cliArgs] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
execFileSync(config.launch.command, [...config.launch.args, ...cliArgs], {
  env: { ...process.env, ...config.launch.env },
  stdio: 'inherit'
});
JS
```

独立 Node 运行 ShowAI 要求 Node.js 22.12+。桌面登记的入口使用软件自带运行时，Agent 可以通过宿主进程执行工具直接传 command、args、env，无需另装 Node 来执行上面的辅助示例。

后续文档中的 `showai` 是这组已核实调用的简写，不保证机器上有名为 showai 的全局命令。例如：`showai pages list --project PROJECT --json` 就是给同一入口追加 `["pages", "list", "--project", "实际项目ID", "--json"]`。

## 核对实际能力

首次取得入口后执行 `runtime info --json`，读取成功结果的 data：

| 返回字段 | 核对目的与后续动作 |
| --- | --- |
| protocol、version | 确认当前软件的协议与版本；现有目录项目流程要求 protocol 1、软件至少 0.7.2。具体操作再按指南与能力核对。 |
| capabilities | 新版分别列出独立展示、公共目录、输出格式、项目同步和 CLI/stdio/HTTP 入口。对应能力存在才能使用；插件版本不证明运行时已升级。 |
| home | 确认实际读写位置与用户选定内容库一致。不同位置时先修正连接或明确的 `--home /absolute/library`，再查询对象。 |
| projectResolution | `mode: directory`、`command: projects current` 表示支持宿主目录定位。项目不明确时回主指南定位；纯阅读查找不会因此自动创建项目。 |
| storage | versioned 包含 libraryId，支持版本历史等能力；legacy 的操作约定以当前指南为准。缺少能力时说明差异，更新 Skills 不会迁移内容库。 |
| guideTopics | 列出当前软件能提供的指南。按本次任务读取 `guide TOPIC --json`，不加载全部指南。 |
| readerCompilation | page-dependencies 表示支持按页面依赖编译阅读器；prebuilt 或缺失表示预构建模式。需要确认导出方式时检查它。 |
| launch | 当前运行入口，可与取得的配置一并保留。 |

确认归属与所需能力后再进入具体任务。启动路径或内容库变更、执行失败、或需要尚未核实的新能力时重新查询；已核实信息可在当前任务中复用。缺少指南或参数时报告当前软件实际支持范围，必要时更新软件，不能把新文档命令当已实现能力。

入口已知但连接文件缺失时，软件的 `runtime register --json` 可以登记配置；只有建立或修复连接时使用，普通读取不需要重复登记。CLI 单次调用后退出；阅读器渲染可能需要可用浏览器，参数与前提由 `guide reading` 说明，通常无需打开完整工作台。
