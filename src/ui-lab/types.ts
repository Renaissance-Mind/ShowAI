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
  | "slider"
  | "spinbutton"
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
export interface SceneStep {
  id: string;
  title: string;
  run(context: SceneContext): Promise<void>;
  capture?: UiTarget;
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
}
export interface SceneFixture {
  actions: ReadonlySet<string>;
  invoke(action: string, args: Record<string, unknown>): Promise<unknown>;
  event(name: string, input: Record<string, unknown>): Promise<void>;
  inspect(): Record<string, unknown>;
  close(): void;
}
