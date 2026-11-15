export interface NativeInkHistoryGroup {boardId:string;operationIds:string[]}
export interface NativeInkHistoryAction {
  kind?:"native-ink";
  groups?:NativeInkHistoryGroup[];
  boardId?:string;operationIds?:string[];
  intentId?:string;strokeIds?:string[];
}
export function nativeInkHistoryGroups(action:NativeInkHistoryAction):NativeInkHistoryGroup[]{
  const groups=new Map<string,string[]>();
  const incoming=action.groups??(action.boardId&&action.operationIds?[{boardId:action.boardId,operationIds:action.operationIds}]:[]);
  for(const value of incoming){
    if(!value.boardId)continue;
    const ids=groups.get(value.boardId)??[];
    for(const id of value.operationIds)if(id&&!ids.includes(id))ids.push(id);
    if(ids.length)groups.set(value.boardId,ids);
  }
  return [...groups].map(([boardId,operationIds])=>({boardId,operationIds}));
}
export function appendNativeInkHistoryGroups(action:NativeInkHistoryAction,incoming:NativeInkHistoryGroup[]):NativeInkHistoryAction{
  const groups=nativeInkHistoryGroups({groups:[...nativeInkHistoryGroups(action),...incoming]});
  const {boardId:_board,operationIds:_ids,...metadata}=action;
  return {...metadata,groups,...(groups.length===1?groups[0]:{})};
}
export function unregisteredNativeInkHistoryAction(action:NativeInkHistoryAction,registered:Iterable<NativeInkHistoryAction>):NativeInkHistoryAction|undefined{
  const known=new Map<string,Set<string>>();
  for(const previous of registered)for(const group of nativeInkHistoryGroups(previous)){
    let ids=known.get(group.boardId);if(!ids)known.set(group.boardId,ids=new Set());
    for(const id of group.operationIds)ids.add(id);
  }
  const groups=nativeInkHistoryGroups(action).map(group=>({...group,operationIds:group.operationIds.filter(id=>!known.get(group.boardId)?.has(id))})).filter(group=>group.operationIds.length);
  return groups.length?appendNativeInkHistoryGroups({...action,groups:[],boardId:undefined,operationIds:undefined},groups):undefined;
}
