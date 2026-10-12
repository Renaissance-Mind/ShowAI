import type { ComponentSource } from "../components/custom/types";
export function parameterComponent(id = "region-reader"): ComponentSource {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "slides"],
    properties: {
      title: { type: "string", minLength: 1 },
      selected: { type: "string" },
      slides: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "regions", "target"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            regions: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "box"],
                properties: {
                  id: { type: "string" },
                  box: {
                    type: "object",
                    additionalProperties: false,
                    required: ["x", "y", "w", "h"],
                    properties: {
                      x: { type: "number", minimum: 0, maximum: 100 },
                      y: { type: "number", minimum: 0, maximum: 100 },
                      w: { type: "number", minimum: 0, maximum: 100 },
                      h: { type: "number", minimum: 0, maximum: 100 },
                    },
                  },
                },
              },
            },
            target: {
              type: "object",
              additionalProperties: false,
              required: ["regionId", "index"],
              properties: {
                regionId: { type: "string" },
                index: { type: "integer", minimum: 0 },
              },
            },
          },
        },
      },
    },
  };
  const data = {
    title: "区域与定位",
    selected: "s1",
    slides: [
      {
        id: "s1",
        label: "左侧区域",
        regions: [{ id: "r1", box: { x: 5, y: 10, w: 35, h: 60 } }],
        target: { regionId: "r1", index: 0 },
      },
      {
        id: "s2",
        label: "右侧区域",
        regions: [{ id: "r2", box: { x: 60, y: 10, w: 35, h: 60 } }],
        target: { regionId: "r2", index: 0 },
      },
    ],
  };
  const inputs = [
    { path: "title", meaning: "图解的标题。" },
    {
      path: "selected",
      meaning: "初始选中的讲解页ID。",
      omission: {
        behavior: "fallback" as const,
        description: "未提供时选择第一张实际讲解页。",
        from: { path: "slides[].id", selection: "first" as const },
      },
    },
    { path: "slides", meaning: "按阅读顺序排列的实际讲解页。" },
    { path: "slides[].id", meaning: "讲解页在本作品中的唯一ID。" },
    { path: "slides[].label", meaning: "当前页解释的区域名称。" },
    {
      path: "slides[].regions",
      meaning: "在该页的100×100坐标空间内显示的区域。",
    },
    { path: "slides[].regions[].id", meaning: "该页内唯一的区域ID。" },
    {
      path: "slides[].regions[].box",
      meaning: "区域左上角与尺寸；横纵方向分别不越过100。",
      units: "%",
      coordinateSystem: "左上角为(0,0)，x向右、y向下；整个画面为100×100。",
    },
    ...["x", "y", "w", "h"].map((key, index) => ({
      path: "slides[].regions[].box." + key,
      meaning: ["左上角横坐标", "左上角纵坐标", "宽度", "高度"][index],
      units: "%",
    })),
    { path: "slides[].target", meaning: "当前页的有效区域定位目标。" },
    {
      path: "slides[].target.regionId",
      meaning: "目标区域ID，必须存在于同一页。",
    },
    {
      path: "slides[].target.index",
      meaning: "同一页区域数组中的零起始索引。",
    },
  ];
  return {
    files: {},
    manifest: {
      id,
      name: "区域阅读器",
      version: "1.0.0",
      entry: "index.tsx",
      description: "保持坐标与对象身份的区域阅读器。",
      scenarios: ["观察选择改变图形区域，并校验定位关系。"],
      defaultData: data,
      examples: [{ name: "两个实际定义的区域", data }],
      documentation: {
        version: 2,
        reuse: { kind: "general", boundaries: ["二维百分比区域的逐页阅读。"] },
        usage: {
          purpose: "通过切换解释区域位置。",
          structure: ["标题、区域图、页选择与当前状态。"],
          inputs,
          rules: [
            { kind: "unique", path: "slides[].id" },
            { kind: "unique", path: "slides[].regions[].id" },
            { kind: "reference", path: "selected", target: "slides[].id" },
            {
              kind: "reference",
              path: "slides[].target.regionId",
              target: "slides[].regions[].id",
            },
            {
              kind: "index",
              path: "slides[].target.index",
              target: "slides[].regions",
            },
            {
              kind: "sumMaximum",
              paths: ["slides[].regions[].box.x", "slides[].regions[].box.w"],
              maximum: 100,
            },
            {
              kind: "sumMaximum",
              paths: ["slides[].regions[].box.y", "slides[].regions[].box.h"],
              maximum: 100,
            },
          ],
          recipes: [
            {
              title: "区域选择",
              steps: ["提供区域和定位关系。", "切换页并观察图形变化。"],
              exampleIndex: 0,
            },
          ],
          interactions: [
            {
              action: "选择讲解页",
              effect: "切换实际区域图与其名称。",
              persistence: "view",
            },
            {
              action: "测试非法编辑",
              effect: "宿主拒绝越界坐标，源数据保持有效。",
              persistence: "none",
            },
          ],
          constraints: ["百分比坐标和零起始索引分别使用，不混用。"],
          editing: {
            data: ["通过onChange提交合法数据。"],
            implementation: ["保持读者探索的临时状态。"],
          },
        },
        development: {
          entryPoints: [
            { path: "index.tsx", purpose: "原生SVG区域与选择按钮。" },
          ],
          architecture: ["区域几何由实际参数计算。"],
          extensionPoints: ["增加区域的解释内容。"],
          invariants: ["读者操作不保存正文；编辑结果必须合法。"],
          verification: [
            "选择下一页，检查位置和名称。",
            "尝试提交非法坐标，检查错误与源数据。",
          ],
        },
      },
    },
    schema,
    source: `import React,{useState} from 'react';export default function RegionReader({data,onChange,readOnly}){const [selected,setSelected]=useState(data.selected??data.slides[0].id);const slide=data.slides.find(s=>s.id===selected)??data.slides[0];return <section style={{fontSize:18,padding:24}}><h2>{data.title}</h2><svg viewBox="0 0 100 100" aria-label={slide.label} style={{width:300,maxWidth:'100%',background:'#eef2f3'}}>{slide.regions.map(r=><rect key={r.id} x={r.box.x} y={r.box.y} width={r.box.w} height={r.box.h} fill="#547c63"/>)}</svg><p aria-live="polite">{slide.label}</p>{data.slides.map(s=><button key={s.id} onClick={()=>setSelected(s.id)}>{s.label}</button>)}{!readOnly&&<button onClick={()=>onChange?.({...data,slides:data.slides.map((s,i)=>i? s:{...s,regions:s.regions.map(r=>({...r,box:{...r.box,x:90,w:40}}))})})}>测试非法编辑</button>}</section>}`,
  };
}
