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
