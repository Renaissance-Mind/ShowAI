import {useEffect,useRef,type RefObject} from "react";
import type {ShowDocument} from "../types";
import type {JSONContent} from "@tiptap/core";
import type {Camera} from "./model";
import type {NodeLayout} from "./types";
import {clientMatrix,matrixValues,measureNativeBoard} from "./board-native-projection";
import {inkUIRegions} from "./ink-ui-regions";
import {finishBoardDrawing} from "./board-drawing.mjs";
declare global { interface Window { showaiApplyingNativeCamera?:boolean } }

export interface NativeBoardOptions {
  root:RefObject<HTMLDivElement|null>;world:RefObject<HTMLDivElement|null>;camera:RefObject<Camera>;
  document?:ShowDocument;boardId:string;tool?:string|null;color:string;fillColor?:string;width:number;pressure:boolean;ruler:boolean;enabled:boolean;
  onCamera:(value:Camera,final:boolean)=>void;onTool:(tool:string)=>void;onClearSelection:()=>void;
  selection?:()=>string[];onSelection?:(ids:string[])=>void;
  onLayout?:(frames:Record<string,NodeLayout>)=>void;
  onDrawing?:(node:JSONContent,frame:NodeLayout)=>void;
  onActivate?:(id:string)=>void;
}

/** All tools share one native scene. DOM measurements belong to content/layout
 * changes; native contact/camera frames never ask React to repaint the Board. */
export function useNativeBoard(options:NativeBoardOptions){
  const current=useRef(options);current.current=options;
  const invalidation=useRef<(()=>void)|null>(null), cameraVersion=useRef(0), previousInk=useRef("pen");
  if(options.tool==="pen"||options.tool==="highlighter")previousInk.current=options.tool;
  const active=options.enabled&&typeof window!=="undefined"&&window.showai?.inlineInk?.nativeScene===true;
  useEffect(()=>{invalidation.current?.()});
  useEffect(()=>{
    const bridge=window.showai?.inlineInk;
    if(!active||!bridge||!options.document)return;
    return bridge.onCommand(value=>{
      const o=current.current;
      if(value.pageId!==o.document?.id||value.boardId!==o.boardId)return;
      if(value.error)throw new Error(value.error);
      if(value.clearSelection)o.onClearSelection();
      if(value.selection)o.onSelection?.(value.selection);
      if(value.layouts)o.onLayout?.(value.layouts);
      if(value.activate)o.onActivate?.(value.activate);
      if(value.camera){
        cameraVersion.current=value.cameraVersion??cameraVersion.current;
        const previous=window.showaiApplyingNativeCamera;window.showaiApplyingNativeCamera=true;
        try{o.onCamera(value.camera,true)}finally{window.showaiApplyingNativeCamera=previous}
      }
      if(value.primitive){
        const p=value.primitive;
        if(!["rectangle","ellipse","arrow","region"].includes(p.tool))throw new Error("Unsupported native primitive");
        const result=finishBoardDrawing(p.tool as Parameters<typeof finishBoardDrawing>[0],{color:o.color,fillColor:o.fillColor??"none",strokeWidth:o.width},
          {origin:p.start,release:p.end,points:[p.start,p.end],moved:Math.hypot(p.end.x-p.start.x,p.end.y-p.start.y)*o.camera.current.scale>=3,scale:o.camera.current.scale});
        result.node.attrs!.id=p.id;o.onDrawing?.(result.node,result.frame);
      }
      if(value.tool)o.onTool(value.tool==="toggleEraser"?(o.tool==="eraser"?previousInk.current:"eraser"):value.tool==="previous"?previousInk.current:value.tool);
    });
  },[active,options.document?.id,options.boardId]);
  useEffect(()=>{
    const bridge=window.showai?.inlineInk,o=current.current,surface=o.root.current,world=o.world.current;
    if(!active||!bridge||!surface||!world||!o.document)return;
    const token=crypto.randomUUID();
    let alive=true,pending=false,dirty=false,frame=0,lastKey="",lastDocument:ShowDocument|undefined;
    let poseDocument:ShowDocument|undefined,poseSize="",poses:ReturnType<typeof measureNativeBoard>|undefined,lastPoses:typeof poses;
    const schedule=()=>{dirty=true;if(alive&&!pending&&!frame)frame=requestAnimationFrame(()=>{frame=0;void send()})};
    const send=async()=>{
      dirty=false;const v=current.current,source=v.document;
      if(!alive||!source||!surface.getClientRects().length||document.visibilityState==="hidden")return;
      const size=surface.clientWidth+":"+surface.clientHeight;
      if(poseDocument!==source||poseSize!==size){poses=measureNativeBoard(surface,world,source);poseDocument=source;poseSize=size}
      const holes=inkUIRegions(document.querySelectorAll<HTMLElement>("[data-surface-ui],.surface-toolbar,.studio-context-menu,.studio-modal-shade,.container-inspector,.studio-sidebar-shell:not([data-sidebar-mode=hidden]) .studio-sidebar,.studio-mobile-sidebar-edge,.studio-mobile-sidebar-scrim,.studio-mobile-navigation-tools"));
      const style=getComputedStyle(surface);
      const packet={token,pageId:source.id,boardId:v.boardId,nativeScene:true,tool:v.tool??"select",color:v.color,fillColor:v.fillColor??"none",width:v.width,pressure:v.pressure,ruler:v.ruler,
        dark:document.documentElement.dataset.theme==="dark",widthPx:surface.clientWidth,heightPx:surface.clientHeight,
        viewport:matrixValues(clientMatrix(surface,surface.offsetWidth,surface.offsetHeight)),camera:{...v.camera.current},cameraVersion:cameraVersion.current,
        selection:v.selection?.()??[],holes,grid:surface.classList.contains("has-board-grid"),background:style.backgroundColor};
      const key=JSON.stringify(packet);
      if(key===lastKey&&source===lastDocument&&poses===lastPoses)return;
      pending=true;
      try{
        surface.dataset.nativeInkToken=token;
        const accepted=await bridge.frame({...packet,...(poses!==lastPoses?{objects:poses}:{}),document:source});
        if(!alive||accepted===false)return;
        lastKey=key;lastDocument=source;lastPoses=poses;
        surface.dataset.nativeBoardActive="true";
      }catch(error){surface.dispatchEvent(new CustomEvent("showai:ink-error",{bubbles:true,detail:String(error)}));throw error}
      finally{pending=false;if(dirty)schedule()}
    };
    invalidation.current=schedule;
    const observer=new MutationObserver(changes=>{
      if(changes.some(change=>change.target!==world&&world.contains(change.target)))poseDocument=undefined;
      if(changes.some(change=>change.target!==world&&change.attributeName!=="data-native-board-active"))schedule();
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["style","class","hidden","open","data-sidebar-mode","data-mobile-sidebar","data-theme","data-native-orientation","data-dragging"]});
    const resize=new ResizeObserver(()=>{poseSize="";schedule()});resize.observe(surface);
    const viewport=()=>{if(window.showaiApplyingNativeCamera)return;cameraVersion.current++;schedule()};
    const refresh=()=>{lastDocument=undefined;poseDocument=undefined;lastKey="";schedule()};
    surface.addEventListener("showai:viewport-change",viewport);surface.addEventListener("showai:ink-refresh",refresh);
    window.addEventListener("resize",schedule);document.addEventListener("scroll",schedule,true);document.addEventListener("visibilitychange",schedule);
    schedule();
    return()=>{alive=false;if(invalidation.current===schedule)invalidation.current=null;cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();
      surface.removeEventListener("showai:viewport-change",viewport);surface.removeEventListener("showai:ink-refresh",refresh);window.removeEventListener("resize",schedule);document.removeEventListener("scroll",schedule,true);document.removeEventListener("visibilitychange",schedule);
      void bridge.hide(o.document!.id,o.boardId,token).finally(()=>{if(surface.dataset.nativeInkToken===token){delete surface.dataset.nativeBoardActive;delete surface.dataset.nativeInkToken}});
    };
  },[active,options.document?.id,options.boardId,options.root,options.world]);
}
