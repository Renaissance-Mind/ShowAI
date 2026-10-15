# 服务器备份与迁移

**语言：** [English](../server-operations.md) | 简体中文 · [文档目录](index.zh-CN.md)

Linux 与 Cloudflare 共用运维协议。一致备份包括账号/密码格式、会话摘要与撤销状态、绑定关系、加密模型资源、第三方身份与待完成流程、成员/邀请、配额预留、上传任务、完整版本图与私有对象清单。基础设施密钥单独管理；恢复保留服务器身份。

设置 SHOWAI_OPERATIONS_KEY 为 32 随机字节的 64 位小写十六进制表示。它独立于用户认证；未设置时运维 endpoint 返回 404。远程使用 HTTPS 或 SSH loopback。Cloudflare 环境分别配置密钥。备份目录权限 0700，文件 0600。

备份含密码摘要、会话元数据和加密凭据。还需单独保护原 Linux vault.key 或 Cloudflare SHOWAI_VAULT_KEY；更换密钥无法解密原凭据。恢复使用与 Node 服务相同的文件所有者。

## 一致导出

```sh
npm run build:server
node scripts/server-backup.mjs export --url https://showai.example.com/cloud --key-file /secure/source-operations.key --destination /secure/backups/showai-backup
node scripts/server-backup.mjs verify --backup /secure/backups/showai-backup
```

导出先冻结并等待已允许的对象/清单写入排空，数据库触发器阻止后续写入。物理写入有持久 admission 记录，排空后才复制。无论完成或失败，源服务都保持冻结。backup.json 记录完整代次与文件摘要，JSON 回执报告 serverId、数量与校验字节。

分页导出使用稳定游标，大型旧内嵌清单单独保存。对象流式复制并计算 SHA-256；远程对象超时十分钟，元数据/控制请求两分钟。核验物理对象、元数据、就绪引用、上传分片、清单、父序列、阅读器与依赖闭包，恢复另查账号/来源身份与外键。版本 6/7 备份可验证并离线升级到当前 schema。

中断后可以复用同一冻结代次和已校验文件：

```sh
node scripts/server-backup.mjs export --url https://showai.example.com/cloud --key-file /secure/source-operations.key --destination /secure/backups/showai-backup --resume
```

源已开放、schema 或代次改变会拒绝续做。活跃 admission 不按年龄过期。Cloudflare 新实例可清除旧实例遗留记录，因为重置结束了原请求；Linux 超时不能证明写入已停止，需检查实际进程与记录。请求正文传输两分钟；对象 admission 64、元数据 256，独占维护前均需排空。

## 恢复与切换

```sh
node scripts/server-backup.mjs restore --backup /secure/backups/showai-backup --home /srv/showai/restored-data
```

目标必须是新目录。工具核验后复制，完成才发布。恢复库保持冻结；用 SHOWAI_SERVER_HOME 指向它，配置保留基址前缀的 SHOWAI_SERVER_URL、原 vault key 和目标 operations key。

确认源保持冻结，目标 /api/info、有效会话、权限、历史与对象数量正确，然后只开放目标：

```sh
node scripts/server-backup.mjs state --url https://target.example/cloud --key-file /secure/target-operations.key
node scripts/server-backup.mjs unfreeze --url https://target.example/cloud --key-file /secure/target-operations.key --epoch CURRENT_FROZEN_GENERATION
```

相同 serverId/用户身份保留连接、项目绑定、默认连接与缓存；有效会话继续有效，过期/撤销状态也保留。切换公共路由前，用两份独立客户端验证同步和查看者限制。

回滚前先冻结并导出目标的新写入，将最新完整备份恢复到新目录、核验，再开放所选源。一个服务器身份只能有一份可写副本；直接重开旧源会丢失目标之后的新内容。

## D1 迁移到 Durable Object

当前配置 SHOWAI_METADATA_DRIVER=durable。旧 D1 先应用生成的 schema 迁移，保留注册/运维/vault 密钥，暂用 --var SHOWAI_METADATA_DRIVER:d1 发布，以保持源运维入口。

导出、核验并冻结 D1。携带基础设施 Authorization 密钥反复 POST /api/ops/metadata-bootstrap，从冻结 D1 分页复制到 Durable Object。只有 schema、代次、身份和表计数核验后 complete:true。中断按持久检查点继续；源代次改变或目标已占用会拒绝。

切换默认 durable 配置后，核对 /api/info 的原 serverId 与 metadataDriver:durable-sqlite，验证账号、权限、历史与对象，再开放 Durable Object。D1 保持冻结。新热对象与旧 R2 档案都在完整备份清单内。接受新修改后的回滚必须先导出当前目标。

## 不可达对象清理

先从验证过的冻结备份生成只读计划：

```sh
node scripts/server-backup.mjs plan-cleanup --backup /secure/backups/showai-backup --destination /secure/backups/cleanup-plan.ndjson --retention-days 30
```

计划包含备份摘要和冻结代次，保护全部版本（含未发布/归档）、清单、配额预留、上传任务与分片。未知年龄对象保留，最短保留 30 天；此命令不删除数据。

服务器清理默认仍为 dry-run：

```sh
node scripts/server-backup.mjs cleanup --url https://target.example/cloud --key-file /secure/target-operations.key --backup /secure/backups/showai-backup --plan /secure/backups/cleanup-plan.ndjson --epoch CURRENT_FROZEN_GENERATION
```

显式 --apply 每次最多删除二十个合格对象/清单。服务器重新核对年龄、精确元数据、摘要与活跃引用。在线证明每项目最多检查 100 版本、16 MiB 清单，超预算保留。分片不由此命令删除。应用操作轮换冻结代次，后续批次需重新生成备份/计划。

## 中断上传协调

冻结且排空后：

```sh
node scripts/server-backup.mjs reconcile --url https://target.example/cloud --key-file /secure/target-operations.key --epoch CURRENT_FROZEN_GENERATION
```

--reservation ID 最多选择十条，--apply 执行恢复。运行态无未完成任务的预留在 15 分钟后释放；未完成 resumable 任务在 24 小时后放弃并清理分片/预留。冻结态协调处理剩余记录。

完整验证对象变为 ready，保留原上传者。完整清单核对身份、父级、文件、阅读器、依赖后保留为未发布版本，不推进 head。未完整任务保留分片/预留；无任务的缺失对象释放空间但保留每日上传消耗；损坏数据保留调查。回执包含新代次与 headsChanged:0，失败后先查询 state。

## 请求预算与观测

SHOWAI_REQUEST_POLICY 默认 serviceDailyRequests=2,000,000、accountDailyRequests=100,000、grantRequests=32（最大 64）。共享计数器原子预留并在本机消费，未使用 credit 保守计费，UTC 零点换日。/api/ops/budget 给出策略和全站信用；冻结读取不更改导出计数。

大对象/清单/旧完整历史读取还受 accountDailyReadBytes=2 GiB、serviceDailyReadBytes=64 GiB 限制。已知大小先原子预留，中断读取继续计入；账号拒绝不消耗全站预算。轻量摘要在字节耗尽后仍可用。流式摘要以 64 KiB 批次处理，Worker CPU 上限 5,000 ms。

Cloudflare 额外按 credential 6,000/分钟、来源 12,000/分钟限制，生产/staging 命名空间独立。绑定限流按地点计数，不能替代共享每日预算；应用预算限制后端工作，无法封顶供应商账单。

SHOWAI_OBSERVE=1 输出无密钥观测：D1 行数/时长、R2 尝试/字节、请求类别/状态/头延迟，省略 SQL、参数、身份、路径、凭据和正文。诊断操作数不等同账单；生产 CPU、时长与供应商用量需独立测量。
