import {parentPort} from "node:worker_threads";
import {SourceRuntimeOwner,type SourceRuntimeRequest} from "../surface/source-runtime";
if(!parentPort)throw new Error("Source runtime requires its dedicated worker port");
const port=parentPort,owner=new SourceRuntimeOwner();
port.on("message",(message:{id:string;request:SourceRuntimeRequest})=>{
 try{port.postMessage({id:message.id,ok:true,data:owner.execute(message.request)})}
 catch(error){port.postMessage({id:message.id,ok:false,error:{code:error&&typeof error==="object"&&"code" in error?error.code:"SOURCE_RUNTIME_FAILURE",message:error instanceof Error?error.message:String(error)}})}
});
