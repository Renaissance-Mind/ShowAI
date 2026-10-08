export const readerResourceUri = "ui://showai/reader-v1.html";

/** One sandboxed reader for MCP Apps hosts; all page dependencies travel with the result. */
export const mcpReaderHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;font-family:system-ui;color-scheme:light dark}#status{padding:18px;color:light-dark(#53616b,#b6c4ce)}#status:empty{display:none}#reader{min-width:0}a{color:inherit}</style></head>
<body><div id="status" role="status">正在载入 ShowAI 页面…</div><div id="reader"></div>
<script>
(() => {
 const root=document.getElementById('reader'),status=document.getElementById('status');
 let current='',sequence=1;
 const pending=new Map();
 function send(method,params){const id=sequence++;parent.postMessage({jsonrpc:'2.0',id,method,params},'*');return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});setTimeout(()=>{if(pending.delete(id))reject(new Error('Host request timed out'));},10000);});}
 function payload(result){const m=result?.mcp_tool_result||result?.call_tool_result||result;return m?._meta?.showai||m?.showai||result?.structuredContent?.showai;}
 function render(result){const data=payload(result);if(data&&!data.inline&&data.delivery?.html){status.replaceChildren(document.createTextNode(data.inlineError||'完整页面已生成。'));const link=document.createElement('a');link.href=data.delivery.html;link.textContent=' 打开完整 HTML';link.target='_blank';link.rel='noopener noreferrer';status.append(link);return;}if(!data?.inline||data.inline===current)return;current=data.inline;root.replaceChildren();const parsed=new DOMParser().parseFromString(data.inline,'text/html');for(const child of [...parsed.head.childNodes,...parsed.body.childNodes])root.append(document.importNode(child,true));for(const old of root.querySelectorAll('script')){if(old.src){status.textContent='页面包含未打包的脚本。';return;}const fresh=document.createElement('script');for(const attr of old.attributes)fresh.setAttribute(attr.name,attr.value);fresh.textContent=old.textContent;old.replaceWith(fresh);}status.textContent='';}
 window.addEventListener('message',event=>{if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;const msg=event.data;if(pending.has(msg.id)){const waiter=pending.get(msg.id);pending.delete(msg.id);msg.error?waiter.reject(new Error(msg.error.message)):waiter.resolve(msg.result);return;}if(msg.method==='ui/notifications/tool-result')render(msg.params);if(msg.method==='ui/notifications/host-context-changed'){const theme=msg.params?.theme;if(theme==='dark'||theme==='light')document.documentElement.style.colorScheme=theme;}});
 window.addEventListener('openai:set_globals',event=>{const globals=event.detail?.globals;render(globals?.toolResponseMetadata);});
 render(window.openai?.toolResponseMetadata);
 send('ui/initialize',{appInfo:{name:'ShowAI',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')).catch(error=>{if(!current)status.textContent='等待宿主提供页面。';console.warn(error.message);});
 const observer=new ResizeObserver(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:Math.ceil(document.documentElement.scrollHeight)}},'*'));observer.observe(root);
})();
</script></body></html>`;
