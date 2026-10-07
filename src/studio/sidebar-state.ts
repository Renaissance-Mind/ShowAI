export type SidebarExpansion = {
  projects: Record<string, boolean>;
  folders: Record<string, boolean>;
  collapsedSections: Record<string, boolean>;
};

export const sidebarExpansionKey = (home: string) =>
  `showai:sidebar-expansion:v1:${home}`;

function booleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, flag]) => typeof flag === "boolean"),
  );
}

export function readSidebarExpansion(home: string): SidebarExpansion {
  let saved: Partial<SidebarExpansion> | null = null;
  try {
    saved = JSON.parse(
      localStorage.getItem(sidebarExpansionKey(home)) ?? "null",
    );
  } catch (error) {
    console.warn("无法读取项目栏展开状态", error);
  }
  return {
    projects: booleanMap(saved?.projects),
    folders: booleanMap(saved?.folders),
    collapsedSections: booleanMap(saved?.collapsedSections),
  };
}
