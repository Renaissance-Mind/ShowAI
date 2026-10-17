# 系统呈现规则：制作与保存页面

沿当前授权 MCP 与真实 projectId 保存 Page。使用 template_context 的固定模板与组件引用；catalog/template_guide 按需读取当前阶段。保存前读取完整源与 hash/revision，保持稳定节点与无关修改；冲突保留尝试稿并比较，不仅刷新版本强行覆盖。用 template_apply 或明确的空白路径创建；必要时扩展组件。正式内容按用户用途保存，独立文件遵循用户明确选择。
