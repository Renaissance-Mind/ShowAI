export const COMPONENT_PARAMETER_CAPABILITIES: {
  protocol: string;
  documentationVersions: number[];
  authoringVersion: number;
  view: string;
  fieldSelection: string;
  pagination: boolean;
  knownHash: boolean;
  relations: string[];
  defaultPolicy: string;
  formatPolicy: string;
};
export const COMPONENT_PARAMETER_PROTOCOL: "showai-component-parameters-v1";
export type ParameterRule =
  | { kind: "unique"; path: string }
  | {
      kind: "reference";
      path: string;
      target: string;
      sentinelValues?: (string | number | boolean | null)[];
    }
  | {
      kind: "index";
      path: string;
      target: string;
      via?: { source: string; target: string };
      sentinelValues?: (number | null)[];
    }
  | { kind: "sumMaximum"; paths: string[]; maximum: number };
export interface ParameterInput {
  path: string;
  meaning: string;
  units?: string;
  coordinateSystem?: string;
  opaque?: boolean;
  omission?: {
    behavior: "reject" | "omit" | "fallback";
    description: string;
    value?: unknown;
    computedFrom?: string[];
    from?: { path: string; selection: "first" | "last" };
  };
}
export interface ParameterDocumentation {
  version: number;
  usage: { inputs: ParameterInput[]; rules?: ParameterRule[] };
}
export interface ParameterIssue {
  path: string;
  code: string;
  message: string;
}
export interface SchemaParameter {
  path: string;
  required: "required" | "conditional" | "optional";
  schemas: (Record<string, any> | boolean)[];
}
export function parameterPath(value: string): string;
export function schemaParameters(
  schema: Record<string, any> | boolean,
): SchemaParameter[];
export function parameterContractIssues(
  schema: Record<string, any> | boolean,
  documentation?: ParameterDocumentation,
): ParameterIssue[];
export function assertParameterContract(
  schema: Record<string, any> | boolean,
  documentation?: ParameterDocumentation,
): void;
export function parameterRuleIssues(
  data: unknown,
  rules?: ParameterRule[],
): { path: string; message: string }[];
export function parameterValues(
  data: unknown,
  path: string,
  maximum?: number,
): { path: string; value: unknown }[];
export function componentParameterReference(
  schema: Record<string, any> | boolean,
  documentation?: ParameterDocumentation,
  defaultData?: Record<string, unknown>,
  examples?: { data: Record<string, unknown> }[],
): {
  protocol: string;
  documentationVersion: number | null;
  verifiedContract: boolean;
  diagnostics: ParameterIssue[];
  entries: Record<string, any>[];
  relations: ParameterRule[];
  defaultPolicy: string;
};
