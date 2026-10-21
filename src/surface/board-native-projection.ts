/** Include ancestor CSS transforms; WebKit SVG screen matrices omit some
 * ancestor scales. Camera inversion happens once at content/layout changes. */
export function clientMatrix(element: Element, width: number, height: number) {
  let matrix = new DOMMatrix();
  for(let parent:Element|null=element;parent;parent=parent.parentElement){
    const transform=getComputedStyle(parent).transform;
    if(transform==="none")continue;
    const m=new DOMMatrix(transform);
    matrix=new DOMMatrix([m.a,m.b,m.c,m.d,0,0]).multiply(matrix);
  }
  const rect=element.getBoundingClientRect();
  matrix.e=rect.left-Math.min(0,matrix.a*width,matrix.c*height,matrix.a*width+matrix.c*height);
  matrix.f=rect.top-Math.min(0,matrix.b*width,matrix.d*height,matrix.b*width+matrix.d*height);
  return matrix;
}
export const matrixValues=(m:DOMMatrix)=>[m.a,m.b,m.c,m.d,m.e,m.f].map(n=>Math.round(n*1e6)/1e6);
export interface NativeObjectProjection {
  id:string; size:number[]; matrix:number[];
  clips:{ownerId?:string;matrix:number[];rect:number[]}[];
}
export function measureNativeBoard(surface:HTMLElement,world:HTMLElement):NativeObjectProjection[]{
  const inverse=clientMatrix(world,world.offsetWidth,world.offsetHeight).inverse();
  const projections:NativeObjectProjection[]=[];
  for(const element of world.querySelectorAll<HTMLElement>(".surface-object[data-surface-id]")){
    if(element.closest(".page-surface")!==surface)continue;
    const width=element.offsetWidth,height=element.offsetHeight;
    if(!(width>0&&height>0))throw new Error("Native object has no committed layout: "+element.dataset.surfaceId);
    const svg=[...element.querySelectorAll<SVGSVGElement>("svg[data-native-ink],svg.board-drawing")]
      .find(candidate=>candidate.closest("[data-surface-id]")===element);
    const box=svg?.viewBox.baseVal;
    const size=box&&box.width>0&&box.height>0?[box.width,box.height]:[width,height];
    const matrix=inverse.multiply(clientMatrix(element,width,height)).scale(width/size[0],height/size[1]);
    if(box)matrix.translateSelf(-box.x,-box.y);
    const clips:NativeObjectProjection["clips"]=[];
    for(let ancestor=element.parentElement;ancestor&&ancestor!==world;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor);
      if(![style.overflowX,style.overflowY].some(value=>value==="hidden"||value==="clip"||value==="auto"||value==="scroll"))continue;
      const owner=ancestor.closest<HTMLElement>("[data-surface-id]");
      clips.push({ownerId:owner?.dataset.surfaceId,matrix:matrixValues(inverse.multiply(clientMatrix(ancestor,ancestor.offsetWidth,ancestor.offsetHeight))),
        rect:[ancestor.clientLeft,ancestor.clientTop,ancestor.clientWidth,ancestor.clientHeight]});
    }
    projections.push({id:element.dataset.surfaceId!,size,matrix:matrixValues(matrix),clips});
  }
  return projections;
}
