import {SourceRuntimeOwner,type SourceRuntimeRequest} from "./source-runtime";
const owner=new SourceRuntimeOwner();
const worker=globalThis as unknown as {onmessage:((event:{data:{id:string;request:SourceRuntimeRequest}})=>void)|null;postMessage(value:unknown):void};
worker.onmessage=({data})=>{
 try{worker.postMessage({id:data.id,ok:true,data:owner.execute(data.request)})}
 catch(error){worker.postMessage({id:data.id,ok:false,error:{code:error&&typeof error==="object"&&"code" in error?error.code:"SOURCE_RUNTIME_FAILURE",message:error instanceof Error?error.message:String(error)}})}
};
