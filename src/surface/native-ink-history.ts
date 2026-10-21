export interface NativeInkHistoryGroup {boardId:string;operationIds:string[]}
export interface NativeInkHistoryAction {
  groups?:NativeInkHistoryGroup[];
  /** Old sessions may still contain a single Board action. */
  boardId?:string;operationIds?:string[];
  intentId?:string;strokeIds?:string[];
}
/** Operation identities are local to a Board; identical actor:sequence values
 * in different Boards must never be deduplicated together. */
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
