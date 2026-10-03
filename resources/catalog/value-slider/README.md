# 数值滑块组件

这个目录是一个可直接导入 ShowAI 的 React 组件包。

- `manifest.json`：组件名称、固定版本、使用场景、默认数据和示例。
- `props.schema.json`：数据结构，使用 JSON Schema draft-07。
- `index.tsx`：默认导出的 React 组件。

组件接收 `{ data, onChange?, readOnly }`。编辑页面时，调用 `onChange(nextData)` 保存该区块的新数据。阅读页面时 `readOnly` 为 `true`，组件可用自己的 React state 提供临时交互。

组件也可以只显示 `data`。ShowAI 的区块设置允许编辑 JSON 属性，数据通过组件 schema 校验后才写入页面。

本地 JavaScript、TypeScript、CSS、图片和字体可通过相对路径导入。React 和 React DOM 由 ShowAI 编译时提供。组件在独立的浏览器沙箱中运行，无法读取 ShowAI 的文件系统或桌面接口；包中的安装脚本不会执行。

修改源码后递增 `manifest.json` 的版本号，再保存或导入。已导入版本保持不变，页面会引用具体版本。
