import type { CompiledInkKernel, InkKernelExports } from "./compiled-ink.mjs";
export interface AnalyticBudget {
  maxCommands?: number;
  maxPatches?: number;
  maxDepth?: number;
}
export interface AnalyticPatch {
  origin: number[];
  controls: number[];
  parameterStart: number;
  parameterEnd: number;
  firstVertex: number;
  vertexCount: number;
  commandIndex: number;
  mode: number;
  winding: number;
  sign: number;
}
export interface AnalyticMesh {
  patches: AnalyticPatch[];
  vertices: Float32Array;
  rayPatches: number;
}
export interface AnalyticHit {
  winding: number;
  inside: boolean;
  boundary: boolean;
}
type AnalyticFunction =
  | "sa_analytic_abi_version"
  | "sa_analytic_sizeof_patch"
  | "sa_analytic_sizeof_vertex"
  | "sa_analytic_path_counts"
  | "sa_analytic_path_build"
  | "sa_analytic_path_winding"
  | "sa_analytic_mesh_winding"
  | "sa_analytic_patch_winding"
  | "sa_analytic_bezier_evaluate"
  | "sa_analytic_curve_evaluate"
  | "sa_analytic_implicit_evaluate";
export type AnalyticExports = InkKernelExports &
  Record<AnalyticFunction, (...values: number[]) => number>;
export class AnalyticPathKernel {
  constructor();
  readonly kernel: CompiledInkKernel;
  readonly api: AnalyticExports;
  input(
    commands: readonly (readonly (string | number)[])[],
    affine: readonly number[],
    budget: AnalyticBudget,
  ): { command: number; transform: number; limit: number };
  build(
    commands: readonly (readonly (string | number)[])[],
    affine?: readonly number[],
    budget?: AnalyticBudget,
  ): AnalyticMesh;
  pathWinding(
    commands: readonly (readonly (string | number)[])[],
    point: readonly number[],
    affine?: readonly number[],
    fill?: number,
  ): AnalyticHit;
  meshWinding(
    mesh: AnalyticMesh,
    points: readonly (readonly number[])[],
    fill?: number,
  ): AnalyticHit[];
}
