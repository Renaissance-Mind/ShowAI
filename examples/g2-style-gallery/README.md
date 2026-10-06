# G2 图表样式图谱

用 G2 5.4.8 实际绘制官方目录中的 43 类代表图表。支持 ShowAI 靛蓝、G2 经典和深色主题，以及分类、搜索、大图查看和 SVG 下载。

## 运行

在仓库目录执行：

```sh
npm ci --prefix examples/g2-style-gallery
npm run dev --prefix examples/g2-style-gallery
```

打开 <http://127.0.0.1:5175/>。端口固定且启用 strictPort，端口被占用时会报错。

构建静态网站：

```sh
npm run build --prefix examples/g2-style-gallery
```

构建结果位于 `dist/`，需要通过静态 HTTP 服务打开。示例数据与图像均打包进本地资源，运行图表不请求外部数据。

## 实现与来源

- `src/samples/`：改编自 G2 官方图表文档中的代表示例，每个文件保留上游源码链接。布局适配由 `src/runtime.js` 统一处理。
- `src/kagi.js`：官方 Kagi 页面没有提供绘图示例；此处依据其转向规则，用 G2 线图组合实现，复用官方 K 线示例的收盘数据，反转阈值为 2%。
- 旭日图使用官方 `@antv/g2-extension-plot` 扩展。
- `data-cache.json`：官方示例引用的 JSON、CSV 和图像资源，保留原始 URL。包含真实公开数据和上游演示数据，用于样式展示。
- 主题切换使用固定的示例随机种子，使演示输入保持一致。词云的内部排布仍由 G2 布局算法决定。
- 小图隐藏密集标签和图例；大图保留上游示例的标签与图例。

官方目录：<https://g2.antv.antgroup.com/en/charts/overview>。上游示例代码许可证见 `UPSTREAM-LICENSE.txt`。

该示例独立运行于 ShowAI 主应用，不向主应用运行时添加第三方库。
