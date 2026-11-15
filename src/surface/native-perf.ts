declare global {
  interface Window {__showaiNativePerf?:(stage:string,durationMs:number)=>void}
}

export function measureNativeSync<T>(stage:string,run:()=>T):T {
  const observe=typeof window==='undefined'?undefined:window.__showaiNativePerf;
  if(typeof observe!=='function')return run();
  const start=performance.now();
  try{return run()}
  finally{try{observe(stage,performance.now()-start)}catch{                                                           }}
}
