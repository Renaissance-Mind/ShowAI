import {expect,it} from 'vitest';
import {appendNativeInkHistoryGroups,nativeInkHistoryGroups} from './native-ink-history';
it('adopts one intent across multiple Boards without collapsing same actor identities',()=>{
 let action=appendNativeInkHistoryGroups({intentId:'selection',strokeIds:['a','b']},[{boardId:'a',operationIds:['device:1']}]);
 action=appendNativeInkHistoryGroups(action,[{boardId:'b',operationIds:['device:1']},{boardId:'a',operationIds:['device:2','device:1']}]);
 expect(action).toEqual({intentId:'selection',strokeIds:['a','b'],groups:[{boardId:'a',operationIds:['device:1','device:2']},{boardId:'b',operationIds:['device:1']}]});
 expect(action.boardId).toBeUndefined();expect(action.operationIds).toBeUndefined();
});
it('normalizes legacy single-Board history and attaches late corrections to that Board',()=>{
 const action=appendNativeInkHistoryGroups({boardId:'a',operationIds:['device:1'],strokeIds:['s']},[{boardId:'a',operationIds:['device:2']}]);
 expect(nativeInkHistoryGroups(action)).toEqual([{boardId:'a',operationIds:['device:1','device:2']}]);
 expect(action).toMatchObject({boardId:'a',operationIds:['device:1','device:2'],strokeIds:['s']});
});
it('retains the actual returned inverse groups as a fresh redo action',()=>{
 const inverse=appendNativeInkHistoryGroups({strokeIds:['a','b']},[{boardId:'a',operationIds:['device:3']},{boardId:'b',operationIds:['device:2']}]);
 expect(nativeInkHistoryGroups(inverse)).toEqual([{boardId:'a',operationIds:['device:3']},{boardId:'b',operationIds:['device:2']}]);
 expect(nativeInkHistoryGroups(appendNativeInkHistoryGroups({},[]))).toEqual([]);
});
import {unregisteredNativeInkHistoryAction} from './native-ink-history';
it('registers only unseen scoped operation identities after source arrived in an earlier save echo',()=>{
 const registered=[appendNativeInkHistoryGroups({strokeIds:['a']},[{boardId:'one',operationIds:['device:1','device:2']}])];
 const next=appendNativeInkHistoryGroups({strokeIds:['b'],intentId:'actual-second-action'},[{boardId:'one',operationIds:['device:2','device:3']},{boardId:'two',operationIds:['device:1']}]);
 const fresh=unregisteredNativeInkHistoryAction(next,registered)!;
 expect(nativeInkHistoryGroups(fresh)).toEqual([{boardId:'one',operationIds:['device:3']},{boardId:'two',operationIds:['device:1']}]);
 expect(fresh).toMatchObject({strokeIds:['b'],intentId:'actual-second-action'});
 expect(unregisteredNativeInkHistoryAction(next,[...registered,fresh])).toBeUndefined();
 expect(nativeInkHistoryGroups(next)[0].operationIds).toEqual(['device:2','device:3']);
});
it('recognizes IDs already adopted or attached as late corrections without making empty edges',()=>{
 const adopted=appendNativeInkHistoryGroups({intentId:'selection'},[{boardId:'one',operationIds:['device:1']}]);
 const corrected=appendNativeInkHistoryGroups(adopted,[{boardId:'one',operationIds:['device:2']}]);
 expect(unregisteredNativeInkHistoryAction({boardId:'one',operationIds:['device:2','device:1']},[corrected])).toBeUndefined();
 expect(unregisteredNativeInkHistoryAction({groups:[]},[corrected])).toBeUndefined();
});
