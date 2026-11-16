import type { ComponentSource } from "../contract/types";

export function runtimeComponent(): ComponentSource {
  const source: ComponentSource = {
    manifest: {
      id: "experiment-inspector",
      name: "契约验证组件",
      version: "1.0.0",
      entry: "index.jsx",
      description: "真实编译的组件契约验证材料",
      scenarios: ["组件对象、子内容和事件联动"],
      contract: {
        version: 1,
        requires: { data: 1, events: 1, content: 1 },
        entities: [
          {
            name: "experiment",
            path: "/choices/*",
            id: "/id",
            scopeValue: "experiments",
          },
        ],
        events: [
          {
            name: "inspect",
            entity: "experiment",
            intent: "request",
            payload: { type: "null" },
          },
        ],
        actions: [
          {
            name: "reveal",
            effect: "view",
            input: { type: "null" },
            output: { type: "string" },
          },
        ],
        slots: [
          {
            name: "body",
            path: "/body",
            format: "richtext",
            accepts: ["chart"],
          },
        ],
        references: [{ path: "/focusBlock", slot: "body" }],
        view: {
          version: 1,
          schema: {
            type: "object",
            properties: { selected: { type: "string" } },
            required: ["selected"],
            additionalProperties: false,
          },
        },
      },
      defaultData: {
        title: "协议示例",
        choices: [
          { id: "open", label: "绑定对象" },
          { id: "other", label: "普通对象" },
        ],
        focusBlock: "child-chart",
        body: {
          type: "doc",
          content: [
            {
              type: "widget",
              attrs: {
                id: "child-chart",
                kind: "chart",
                data: {
                  title: "示例曲线",
                  labels: ["A", "B"],
                  series: [{ name: "示例值", values: [1, 2] }],
                },
              },
            },
          ],
        },
        business: {
          type: "doc",
          content: [
            {
              type: "widget",
              attrs: {
                id: "opaque-business-id",
                kind: "custom",
                data: {
                  componentId: "not-a-package",
                  version: "9.9.9",
                  props: {},
                },
              },
            },
          ],
        },
      },
      examples: [{ name: "真实协议验证", data: {} }],
      documentation: {
        version: 2,
        reuse: {
          kind: "content-specific",
          owner: "component-contract-tests",
          boundaries: ["自动化验证材料"],
        },
        usage: {
          purpose: "验证组件通过声明接入系统",
          structure: ["对象按钮与原生图表子内容"],
          inputs: [
            { path: "title", meaning: "组件标题" },
            { path: "choices", meaning: "可操作对象" },
            { path: "body", meaning: "原生子内容", opaque: true },
            { path: "focusBlock", meaning: "子内容中的块引用" },
            {
              path: "business",
              meaning: "普通业务 JSON，不属于子内容",
              opaque: true,
            },
          ],
          interactions: [
            {
              action: "点击对象",
              effect: "请求外层检查对象，未处理时显示普通反馈",
              persistence: "view",
            },
          ],
          recipes: [
            {
              title: "绑定检查",
              steps: ["绑定 open 对象，点击两个对象验证处理与回退"],
            },
          ],
          constraints: ["读者操作不修改源数据"],
          editing: {
            data: ["修改标题和对象"],
            implementation: ["遵循版本化契约"],
          },
        },
        development: {
          entryPoints: [{ path: "index.jsx", purpose: "React 验证组件" }],
          architecture: ["统一运行时"],
          extensionPoints: ["声明新的对象和事件"],
          invariants: ["保留稳定 ID"],
          verification: ["真实沙箱和 inline 点击"],
        },
      },
    },
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "choices", "body", "focusBlock", "business"],
      properties: {
        title: { type: "string" },
        choices: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", description: "稳定对象 ID" },
              label: { type: "string", description: "按钮文字" },
            },
            required: ["id", "label"],
          },
        },
        body: { type: "object", additionalProperties: true },
        focusBlock: { type: "string" },
        business: { type: "object", additionalProperties: true },
      },
    },
    source: `import React,{useState,useCallback}from'react';import{useComponentRuntime,useComponentAction,ComponentContent}from'showai:components';
export default function Inspector({data,runtime:provided}){const runtime=useComponentRuntime();if(runtime!==provided)throw Error('runtime context mismatch');const[message,setMessage]=useState('');const reveal=useCallback(()=>{setMessage('局部动作已执行');return 'revealed';},[]);useComponentAction('reveal',reveal);const inspect=async item=>{const result=await runtime.events.emit('inspect',{type:'experiment',scope:'experiments',id:item.id});if(result.status!=='handled')setMessage('普通反馈 '+result.status);};return <section><h3>{data.title}</h3>{data.choices.map(item=><button key={item.id} onClick={()=>inspect(item)}>{item.label}</button>)}<button onClick={()=>runtime.actions.invoke('reveal')}>局部动作</button><button onClick={async()=>{const result=await runtime.update({...data,title:'已修改'});setMessage('保存结果 '+result.status+(result.reason?' '+result.reason:''));}}>修改内容</button><p role='status'>{message}</p><ComponentContent slot='body'/><span>{data.business.content[0].attrs.id}</span></section>;}`,
    files: {},
  };
  source.manifest.examples[0].data = structuredClone(
    source.manifest.defaultData,
  );
  return source;
}
