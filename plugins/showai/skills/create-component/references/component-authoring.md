# 组件设计与验证

用 CLI 的 `guide component` 获取当前命令与结构；组件 schema 和示例由目录动态返回。

定义数据契约：输入字段、必填条件、数组上限、单位、默认值以及空数据状态。schema 与 defaultData、examples、React 入口一致。界面需要的计算与状态说明保持在组件内；正式数据通过 `onChange(nextData)` 返回，读取态保持页面源数据。每个组件接收 `{data, onChange, readOnly}`。

包包含 `manifest.json`、`props.schema.json` 和 manifest.entry 指定的本地文件。manifest 记录 id、name、version、description、scenarios、entry、defaultData、examples。输入与示例保留可用的最小实例；参考本次真实内容验证较复杂情况，不为未知事实生成示例测量。

组件有汇总或计算字段时，可在 manifest 声明 `reader: "readData"`，并从入口命名导出同步 `readData(props)`。返回不超过 64 KiB 的 JSON，以稳定 ID 对应源数据并标明派生字段。它与组件使用同一份计算逻辑，在浏览器沙箱中执行；数据读取不访问文件或服务。Agent 的 structured 视图保留原始 props 与 computed.data，image/html 使用同一固定版本。增加或修改读取模型后导入新版本，并验证原始字段与计算值一致。

先复用 `showai:components` 的基础元素与已提供控件，包括 Flowchart；自定义子组件通过 `showai:component/ID` 导入，并在 manifest.dependencies 声明目录返回的完整版本和指纹。允许 React、ShowAI SDK 与包内模块；任意 npm 包和远端脚本不是组件导入接口。需要新的外部库时，将依赖接入 ShowAI 软件运行时并完成离线验收，再向组件暴露明确能力。

测试实际结果：必填或非法数据应给出明确错误；编辑操作应产生有效的新数据；读取态交互可以探索但不保存正文；导出 HTML 和对话内模式都能呈现。颜色、字号、节点标签与控制项在实际容器中可读。自定义画布要提供可访问的文字描述与键盘操作。

验证 Page 的 structured、image 和 html 视图：计算结果按 ID 可追溯，图像包含真实组件，交互动作能找到目标并产生预期状态。临时 draft 预览不改写源 Page；正式编辑仍通过宿主的 onChange 保存。
