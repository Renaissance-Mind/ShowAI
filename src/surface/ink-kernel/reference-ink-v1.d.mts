export * from '../portable-ink.mjs';
import type {PortableInkV1} from "../portable-ink.mjs";
export function isPortableInk(ink:unknown):ink is PortableInkV1;
export function createPortableInk(points:{x:number;y:number;pressure?:number}[],width:number,extent:[number,number],brush?:PortableInkV1["brush"],pressure?:boolean):PortableInkV1;
export function portableNodeInk(node:{attrs:Record<string,any>}):PortableInkV1;
export function validatePortableInk(ink:unknown):PortableInkV1;
