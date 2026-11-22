import type { Locale } from "../i18n";

export type UiRole =
  | "button"
  | "checkbox"
  | "combobox"
  | "dialog"
  | "heading"
  | "link"
  | "menuitem"
  | "option"
  | "radio"
  | "searchbox"
  | "slider"
  | "spinbutton"
  | "switch"
  | "status"
  | "tab"
  | "tabpanel"
  | "textbox"
  | "treeitem";
export interface UiTarget {
  role?: UiRole;
  name?: string;
  selector?: string;
  testId?: string;
  within?: UiTarget;
}
export interface UiDriver {
  click(target: UiTarget): Promise<void>;
  fill(target: UiTarget, value: string): Promise<void>;
  select(target: UiTarget, value: string): Promise<void>;
  expect(
    target: UiTarget,
    state?: "visible" | "hidden" | "enabled" | "disabled",
  ): Promise<void>;
}
export interface SceneContext {
  ui: UiDriver;
  locale: Locale;
  event(name: string, input?: Record<string, unknown>): Promise<void>;
  inspect(): Promise<Record<string, unknown>>;
  assert(value: unknown, message: string): void;
}
export interface MotionObservation {
  events: string[];
  widthChanges?: number;
}
export interface SceneStep {
  id: string;
  title: string;
  run(context: SceneContext): Promise<void>;
  capture?: UiTarget;
  motion?: {
    selector: string;
    events: string[];
    pseudo?: string;
    stableWidth?: string;
  };
}
export interface UiScene {
  id: string;
  title: string;
  description: string;
  fixture: string;
  layout?: { dialogPadding?: number; primaryContrast?: number };
  prepare(context: SceneContext): Promise<void>;
  steps: SceneStep[];
}
export interface UiFeature {
  id: string;
  title: string;
  events?: Array<{ name: string; title: string }>;
  scenes: UiScene[];
}
export interface LabSession {
  id: string;
  token: string;
  feature: string;
  scene: string;
  home: string;
  locale: Locale;
  theme: "light" | "dark";
  mode: "manual" | "test";
  appUrl: string;
  flow?: string;
  node?: string;
  annotations?: boolean;
}

export interface FlowAction {
  id: string;
  title: string;
  target: UiTarget;
  to?: string;
}
export interface FlowMatch {
  target: UiTarget;
  state?: "visible" | "hidden" | "enabled" | "disabled";
}
export interface FlowNode {
  id: string;
  title: string;
  stateLabel?: string;
  variantLabels?: Record<string, string>;
  screen: string;
  screenTitle: string;
  parent?: string;
  scene: string;
  variants?: string[];
  matches: FlowMatch[];
  priority?: number;
  when?: (state: Record<string, unknown>) => boolean;
  enter(context: SceneContext): Promise<void>;
  actions: FlowAction[];
  checks?: SceneStep[];
}
export interface UiFlow {
  feature: string;
  title: string;
  entry: string;
  nodes: FlowNode[];
}
export interface SceneFixture {
  actions: ReadonlySet<string>;
  invoke(action: string, args: Record<string, unknown>): Promise<unknown>;
  event(name: string, input: Record<string, unknown>): Promise<void>;
  inspect(): Record<string, unknown>;
  close(): void;
}
