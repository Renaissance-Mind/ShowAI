// Hosts cache UI templates by URI; bump the version when the reader's behavior changes.
export const readerResourceUri = "ui://showai/reader-v3.html";

/** One sandboxed reader for MCP Apps hosts; all page dependencies travel with the result.
 * Reader control values, references the reader makes and component states handed
 * over are reported together as model context only. They never write the Page.
 */
export const mcpReaderHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;padding:0;font-family:system-ui;color-scheme:light dark}
#status{padding:18px;color:light-dark(#53616b,#b6c4ce);overflow-wrap:anywhere}
#status:empty{display:none}
#status[data-kind=busy]{display:flex;align-items:center;gap:8px}
#status[data-kind=error]{color:light-dark(#a33a2b,#f0a596)}
#status code{font:12px ui-monospace,monospace;user-select:all}
#status .spinner{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid light-dark(#d5dbe0,#3b4650);border-top-color:currentColor;animation:showai-spin .8s linear infinite}
#reader{min-width:0}
a{color:inherit}
[data-showai-reveal]{transition:opacity .36s ease}
[data-showai-reveal=pending]{opacity:0!important}
@keyframes showai-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#status .spinner{animation:none}}
@media print{[data-showai-reveal]{opacity:1!important}}
</style></head>
<body><div id="status" role="status">正在载入 ShowAI 页面…</div><div id="reader"></div>
<script>
(() => {
 const root=document.getElementById('reader'),status=document.getElementById('status');
 const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let current='',sequence=1,settled=false,hostTheme='',page={},lastResult=null,contextSupported=false;
 const pending=new Map();
 function send(method,params){const id=sequence++;parent.postMessage({jsonrpc:'2.0',id,method,params},'*');return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});setTimeout(()=>{if(pending.delete(id))reject(new Error('Host request timed out'));},10000);});}
 function notify(method,params){parent.postMessage({jsonrpc:'2.0',method,params},'*');}
 function openLink(url){send('ui/open-link',{url}).catch(()=>window.open(url,'_blank','noopener,noreferrer'));}

 function showStatus(text,kind){status.replaceChildren();status.dataset.kind=kind||'';if(kind==='busy'){const spinner=document.createElement('span');spinner.className='spinner';spinner.setAttribute('aria-hidden','true');status.append(spinner);}if(text)status.append(document.createTextNode(text));}
 // Local stdio deliveries are file paths, which a hosted conversation cannot open.
 function appendDelivery(href){if(!href)return;if(/^https?:\\/\\//i.test(href)){const link=document.createElement('a');link.href=href;link.textContent='打开完整 HTML';link.target='_blank';link.rel='noopener noreferrer';link.addEventListener('click',event=>{event.preventDefault();openLink(link.href);});status.append(document.createTextNode(' '),link);return;}const path=document.createElement('code');path.textContent=href;status.append(document.createTextNode(' 完整 HTML 已保存到：'),path);}

 function payload(result){const m=result?.mcp_tool_result||result?.call_tool_result||result;return m?._meta?.showai||m?.showai||result?.structuredContent?.showai;}
 function failure(result){const output=result?.structuredContent;if(!result?.isError&&output?.ok!==false)return '';if(output?.error?.message)return String(output.error.message);const text=(result.content||[]).find(item=>item?.type==='text')?.text;if(!text)return '工具调用失败。';try{return String(JSON.parse(text)?.error?.message||text);}catch{return text;}}
 function theme(value){if(value!=='dark'&&value!=='light')return;hostTheme=value;document.documentElement.style.colorScheme=value;for(const node of document.querySelectorAll('[data-showai-inline-root]'))node.dataset.theme=value;}
 // The portable reader reads its initial theme from these options before it mounts.
 // The conversation identity enables "reference in chat" only when the host accepts model context.
 function readOptions(){document.getElementById('showai-read-options')?.remove();const value={};if(hostTheme)value.theme=hostTheme;if(conversational())value.conversation=page;if(!Object.keys(value).length)return;const options=document.createElement('script');options.type='application/json';options.id='showai-read-options';options.textContent=JSON.stringify(value);document.head.append(options);}
 function conversational(){return contextSupported&&!!(page.projectId&&page.pageId&&page.hash);}
 function waiting(args){if(settled||current)return;const title=args?.title||args?.document?.title;showStatus(title?'正在生成《'+String(title).slice(0,120)+'》…':'正在生成 ShowAI 页面…','busy');}

 function render(result){
  if(!result)return;
  lastResult=result;
  const error=failure(result);
  if(error){settled=true;if(!current)showStatus('ShowAI 页面未能生成：'+error,'error');return;}
  const data=payload(result);if(!data)return;
  settled=true;
  const info=result.structuredContent?.data;
  if(info)page={title:info.title,pageId:info.pageId,projectId:info.projectId,hash:info.hash,revision:info.revision};
  if(!data.inline){showStatus(data.inlineError||'完整页面已生成。');appendDelivery(data.delivery?.html);return;}
  if(data.inline===current)return;
  current=data.inline;states.clear();handed.clear();referenced=null;if(lastContext)publishState();root.replaceChildren();root.toggleAttribute('data-showai-conversation',conversational());readOptions();
  const parsed=new DOMParser().parseFromString(data.inline,'text/html');
  for(const child of [...parsed.head.childNodes,...parsed.body.childNodes])root.append(document.importNode(child,true));
  for(const old of root.querySelectorAll('script')){if(old.src){showStatus('页面包含未打包的脚本。','error');return;}const fresh=document.createElement('script');for(const attr of old.attributes)fresh.setAttribute(attr.name,attr.value);fresh.textContent=old.textContent;old.replaceWith(fresh);}
  showStatus('');theme(hostTheme);reveal();
 }

 // Blocks fade in once as they enter view. The reader owns scrolling; nothing here scrolls.
 let revealer,mutations,scanQueued=false;
 function reveal(){
  revealer?.disconnect();mutations?.disconnect();
  if(reduceMotion||typeof IntersectionObserver==='undefined')return;
  const seen=new WeakSet();
  revealer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const node=entry.target;revealer.unobserve(node);node.dataset.showaiReveal='visible';setTimeout(()=>delete node.dataset.showaiReveal,450);}});
  const scan=()=>{scanQueued=false;for(const node of root.querySelectorAll('[data-block-id]')){if(seen.has(node))continue;seen.add(node);if(node.parentElement?.closest('[data-block-id]'))continue;node.dataset.showaiReveal='pending';revealer.observe(node);}};
  scan();
  mutations=new MutationObserver(()=>{if(!scanQueued){scanQueued=true;requestAnimationFrame(scan);}});
  mutations.observe(root,{childList:true,subtree:true});
 }

 // Reader exploration stays local to the preview. The latest control values reach
 // the model through ui/update-model-context so a follow-up can refer to them.
 const states=new Map(),skipped=new Set(['password','hidden','file','submit','reset','button','image']),choiceRoles=['tab','option','radio','menuitemradio'];
 let stateTimer=0,lastContext='';
 const clean=(text,max)=>String(text??'').replace(/\\s+/g,' ').trim().slice(0,max);
 function labelOf(element){const scope=element.getRootNode();const named=(element.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean).map(id=>scope.getElementById?.(id)?.textContent||'').join(' ');return clean(named||element.getAttribute('aria-label')||element.labels?.[0]?.textContent||element.closest('label')?.textContent||element.getAttribute('title')||element.getAttribute('placeholder')||element.getAttribute('name')||(element.matches('button,[role]')?element.textContent:''),80);}
 function groupLabel(group,fallback){return clean(group&&(group.getAttribute('aria-label')||group.querySelector('legend')?.textContent||labelOf(group))||fallback,80);}
 function valueOf(element){
  if(element instanceof HTMLInputElement){if(element.type==='checkbox')return element.checked?'on':'off';if(element.type==='radio'){const scope=element.getRootNode();const checked=element.name?scope.querySelector?.('input[type=radio][name="'+CSS.escape(element.name)+'"]:checked'):element.checked?element:null;return checked?labelOf(checked)||clean(checked.value,200):'';}return clean(element.value,200);}
  if(element instanceof HTMLSelectElement)return clean([...element.selectedOptions].map(option=>option.textContent).join(', '),200);
  if(element instanceof HTMLTextAreaElement)return clean(element.value,200);
  if(choiceRoles.includes(element.getAttribute('role')))return labelOf(element);
  const state=element.getAttribute('aria-pressed')??element.getAttribute('aria-checked');
  if(state!==null)return state==='true'?'on':'off';
  return labelOf(element);
 }
 function track(event){
  if(!event.isTrusted||!current)return;
  const path=event.composedPath(),target=path[0];
  if(!(target instanceof Element))return;
  let control=target,label,group;
  if(event.type==='click'){control=target.closest('[role=tab],[role=option],[role=radio],[role=switch],[role=menuitemradio],[role=menuitemcheckbox],[aria-pressed]');if(!control)return;}
  else if(!control.matches('input,select,textarea'))return;
  if(control instanceof HTMLInputElement&&skipped.has(control.type))return;
  if(/cc-|one-time-code|password/.test(control.getAttribute('autocomplete')||''))return;
  const role=control.getAttribute('role');
  if(control instanceof HTMLInputElement&&control.type==='radio'){group=control.closest('fieldset,[role=radiogroup]');label=groupLabel(group,control.name);}
  else if(choiceRoles.includes(role)){group=control.closest('[role=tablist],[role=listbox],[role=radiogroup],[role=menu]');label=groupLabel(group,role);}
  else label=labelOf(control);
  if(!label)return;
  const block=path.find(node=>node instanceof Element&&node.hasAttribute('data-block-id'));
  const named=path.find(node=>node instanceof Element&&node.hasAttribute('data-component-kind'));
  const blockId=block?.getAttribute('data-block-id')||'';
  const key=blockId+'\\u0000'+label;
  states.delete(key);
  states.set(key,{blockId,kind:named?.getAttribute('data-component-kind')||'',label,control,value:valueOf(control)});
  while(states.size>40)states.delete(states.keys().next().value);
  clearTimeout(stateTimer);stateTimer=setTimeout(publishState,700);
 }
 function controlLines(){
  const blocks=new Map();
  for(const item of states.values()){
   const value=item.control.isConnected?valueOf(item.control):item.value;
   if(!value)continue;
   if(!blocks.has(item.blockId))blocks.set(item.blockId,{blockId:item.blockId||undefined,kind:item.kind||undefined,controls:[]});
   blocks.get(item.blockId).controls.push({label:item.label,value});
  }
  if(!blocks.size)return null;
  const lines=['The reader is exploring this ShowAI page in the conversation preview. These are the latest control values; they are local to the preview and have not been saved to the Page.'];
  if(page.title||page.pageId)lines.push('Page: '+[page.title,page.pageId&&'pageId '+page.pageId,page.projectId&&'projectId '+page.projectId].filter(Boolean).join(' · '));
  for(const block of blocks.values())lines.push('- '+(block.blockId?'block '+block.blockId+(block.kind?' ('+block.kind+')':''):'page')+': '+block.controls.map(control=>control.label+' = '+control.value).join('; '));
  return {text:lines.join('\\n').slice(0,4000),state:{...page,savedToPage:false,blocks:[...blocks.values()]}};
 }
 // Each update replaces the previous one, so the reference, handed-over component
 // states and control values always travel together, newest components kept first.
 const handed=new Map();let referenced=null;
 function publishContext(){
  const controls=controlLines(),components=[...handed.values()];
  const compose=()=>{const parts=[],showai={};
   if(referenced){parts.push(referenced.text);showai.reference=referenced.reference;}
   if(components.length){parts.push(['The reader handed over the current exploration state of these components in the conversation preview. It is local to the preview and has not been saved to the Page:',...components.map(item=>'- block '+item.blockId+' ('+JSON.stringify(item.name)+(item.componentId?', '+item.componentId:'')+')'+(item.label?' '+JSON.stringify(item.label):'')+': '+JSON.stringify(item.model))].join('\\n'));showai.components=components;}
   if(controls){parts.push(controls.text);showai.readerState=controls.state;}
   return {text:parts.join('\\n\\n'),showai};};
  let context=compose();
  while(context.text.length>24000&&components.length>1){components.shift();context=compose();}
  if(context.text===lastContext)return Promise.resolve();
  lastContext=context.text;
  return send('ui/update-model-context',{content:context.text?[{type:'text',text:context.text}]:[],structuredContent:{showai:context.showai}});
 }
 function publishState(){publishContext().catch(error=>console.warn('ShowAI reader state:',error.message));}
 root.addEventListener('showai:conversation-reference',event=>{if(!conversational()||!event.detail)return;const detail=event.detail;referenced=detail.reference?{reference:detail.reference,text:String(detail.text||'')}:null;detail.result=publishContext();});
 root.addEventListener('showai:conversation-context',event=>{const detail=event.detail;if(!conversational()||!detail?.blockId||!detail.snapshot)return;handed.delete(detail.blockId);handed.set(detail.blockId,{blockId:detail.blockId,componentId:detail.componentId||undefined,name:String(detail.name||''),label:detail.snapshot.label,model:detail.snapshot.model});while(handed.size>6)handed.delete(handed.keys().next().value);clearTimeout(stateTimer);stateTimer=setTimeout(publishState,300);});
 for(const type of ['input','click'])root.addEventListener(type,track,true);

 // External links go through the host so its sandbox and confirmation rules apply.
 root.addEventListener('click',event=>{if(event.defaultPrevented)return;const link=event.composedPath().find(node=>node instanceof HTMLAnchorElement&&node.href);if(!link||link.hasAttribute('download')||!/^https?:$/.test(link.protocol)||link.origin===location.origin)return;event.preventDefault();openLink(link.href);});

 window.addEventListener('message',event=>{if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;const msg=event.data;if(pending.has(msg.id)){const waiter=pending.get(msg.id);pending.delete(msg.id);msg.error?waiter.reject(new Error(msg.error.message)):waiter.resolve(msg.result);return;}
  if(msg.method==='ui/notifications/tool-input')waiting(msg.params?.arguments);
  if(msg.method==='ui/notifications/tool-result')render(msg.params);
  if(msg.method==='ui/notifications/tool-cancelled'&&!current){settled=true;showStatus('页面生成已取消'+(msg.params?.reason?'：'+msg.params.reason:'。'),'error');}
  if(msg.method==='ui/notifications/host-context-changed')theme(msg.params?.theme);});
 // ChatGPT compatibility globals: toolOutput is structuredContent, toolResponseMetadata is _meta.
 function fromOpenAI(globals){if(!globals)return;theme(globals.theme);if(globals.toolOutput||globals.toolResponseMetadata)render({structuredContent:globals.toolOutput,_meta:globals.toolResponseMetadata,isError:globals.toolOutput?.ok===false});else waiting(globals.toolInput);}
 window.addEventListener('openai:set_globals',event=>fromOpenAI(event.detail?.globals));
 fromOpenAI(window.openai);
 send('ui/initialize',{appInfo:{name:'ShowAI',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}).then(result=>{theme(result?.hostContext?.theme);contextSupported=!!result?.hostCapabilities?.updateModelContext;notify('ui/notifications/initialized');if(contextSupported&&current&&lastResult){current='';render(lastResult);}}).catch(error=>{if(!current&&!settled)showStatus('等待宿主提供页面。');console.warn(error.message);});
 // Measure the whole body so status changes and shrinking content both resize the frame.
 new ResizeObserver(()=>notify('ui/notifications/size-changed',{height:Math.ceil(Math.max(document.body.getBoundingClientRect().height,document.body.scrollHeight))})).observe(document.body);
})();
</script></body></html>`;
