## Antigravity 工作台与页面卡片

临时看图表或试组件，用 `show_component` 直接在 MCP Apps 原生视图展示。新建页面、编辑已有页或把临时组件存成页面，确认本轮保存成功后，默认在最终回复中用 `card_present` 交付原页卡片；用户要求在右侧/侧栏打开某页或跳转到指定组件时，用 `card_navigate` 定位右侧 **ShowAI 工作台**（`sidecar://showai/workbench/`），详见 show-visual 与 show-document 的「当前宿主交付」及[当前宿主适配](references/host-adapter.md)。收到侧栏工作台传来的页面或组件引用（`showai.reference`）时，按[用户引用](references/user-references.md)核对原页和选区。
