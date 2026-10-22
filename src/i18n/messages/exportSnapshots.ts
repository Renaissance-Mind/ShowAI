import { defineMessages } from "../index";

// Confirming an export that embeds data read from files outside the library.
export default defineMessages("exportSnapshots", {
  "zh-CN": {
    title: "导出外部数据的快照",
    intro:
      "这次导出的组件显示了来自内容库以外文件的数据。导出的页面不能读取这些文件，会把组件当前显示的数据作为快照写进导出文件。",
    dataset: "共享数据",
    file: "外部文件",
    fileSize: "文件大小",
    snapshotSize: "增加的快照",
    blocks: { one: "{count} 个组件", other: "{count} 个组件" },
    notLinked: "此设备未链接",
    unavailable: "现在无法读取",
    total: "快照合计",
    explain:
      "快照大小按写入导出文件的数据计算（同一份数据被多个组件使用时分别计入），导出文件中的内容不会随原文件更新，收到文件的人能看到这些数据。",
    unavailableHint: {
      one: "{count} 个外部文件现在无法读取，导出后使用它的组件不显示数据。",
      other: "{count} 个外部文件现在无法读取，导出后使用它们的组件不显示数据。",
    },
    export: "包含快照并导出",
  },
  en: {
    title: "Export a snapshot of external data",
    intro:
      "Components in this export show data from files outside the content library. The exported page can't read those files, so the data the components show now is written into the export as a snapshot.",
    dataset: "Shared data",
    file: "External file",
    fileSize: "File size",
    snapshotSize: "Snapshot added",
    blocks: { one: "{count} component", other: "{count} components" },
    notLinked: "Not linked on this device",
    unavailable: "Can't be read right now",
    total: "Snapshot total",
    explain:
      "Snapshot sizes count the data written into the export (data used by several components counts once per component). The export doesn't update with the original files, and anyone who receives it can see this data.",
    unavailableHint: {
      one: "{count} external file can't be read right now; components using it will show no data in the export.",
      other:
        "{count} external files can't be read right now; components using them will show no data in the export.",
    },
    export: "Export with snapshot",
  },
});
