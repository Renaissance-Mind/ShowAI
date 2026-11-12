import { useMemo, useRef, useState, type RefObject } from "react";
import type {
  BuiltinComponentMetadata,
  CatalogReadOptions,
  ComponentCategory,
  TemplateMetadata,
} from "../../contract/types";
import {
  groupComponents,
  type CatalogComponent,
  type CatalogCustomComponent,
  type ComponentFilter,
} from "../../core/component-categories";
import {
  componentDisplayDescription,
  componentDisplayName,
} from "../../components/component-display";
import { desktop } from "../../host/bridge";
import { coalescedTask } from "../../lib/coalesced-task";
import { matchesTemplateType, type TemplateType } from "../TemplateNavigation";
import { latestTemplateVersions } from "../template-catalog-model";
import { useSlidingIndicator } from "../useSlidingIndicator";
import type { Catalog, ProjectScan } from "./types";

/** The component and template catalogs, their filters and how they load. */
export function useCatalogState({
  selectedRef,
}: {
  selectedRef: RefObject<string | null>;
}) {
  const catalogLoaded = useRef(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateMetadata[]>([]);
  const [showTemplateVersions, setShowTemplateVersions] = useState(false);
  const [templateType, setTemplateType] = useState<TemplateType>("all");
  const [catalog, setCatalog] = useState<Catalog>({ builtin: [], custom: [] });
  const [catalogScope, setCatalogScope] =
    useState<CatalogReadOptions["scope"]>("all");
  const catalogScopeRef = useRef(catalogScope);
  catalogScopeRef.current = catalogScope;
  const [componentProject, setComponentProject] = useState("all");
  const componentProjectRef = useRef(componentProject);
  componentProjectRef.current = componentProject;
  const [componentFilter, setComponentFilter] =
    useState<ComponentFilter>("all");
  const componentSourceTabs = useSlidingIndicator<HTMLElement>(componentFilter);
  const [componentCategory, setComponentCategory] =
    useState<ComponentCategory | null>(null);
  const [catalogQueries, setCatalogQueries] = useState({
    components: "",
    templates: "",
  });
  const componentGroups = useMemo(
    () =>
      groupComponents(catalog, componentFilter).map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.name} ${item.description} ${componentDisplayName(item)} ${componentDisplayDescription(item)}`
            .toLowerCase()
            .includes(catalogQueries.components.toLowerCase()),
        ),
      })),
    [catalog, componentFilter, catalogQueries.components],
  );
  const loadCatalog = useMemo(() => {
    const load = coalescedTask(async () => {
      const id = selectedRef.current;
      const requestedScope = catalogScopeRef.current;
      const scope = {
        ...(id ? { projectId: id } : {}),
        scope: requestedScope,
      };
      const requestedProject = componentProjectRef.current;
      const loadComponents = async (): Promise<CatalogComponent[]> => {
        if (requestedProject !== "all") {
          const project = (
            await desktop.invoke<ProjectScan>("projects:scan")
          ).projects.find((item) => item.id === requestedProject);
          if (!project) {
            componentProjectRef.current = "all";
            setComponentProject("all");
            return [];
          }
          const items = await desktop.invoke<CatalogComponent[]>(
            "components:list",
            { projectId: requestedProject, scope: "all" },
          );
          return items.map((item) =>
            !("kind" in item) && item.scope === "project"
              ? {
                  ...item,
                  projectId: requestedProject,
                  projectName: project?.name,
                }
              : item,
          );
        }
        const [shared, allProjects] = await Promise.all([
          desktop.invoke<CatalogComponent[]>("components:list", {
            scope: "all",
          }),
          desktop
            .invoke<ProjectScan>("projects:scan")
            .then((scan) => scan.projects),
        ]);
        const local = await Promise.all(
          allProjects.map(async (project) => {
            const items = await desktop.invoke<CatalogCustomComponent[]>(
              "components:list",
              { projectId: project.id, scope: "project" },
            );
            return items.map((item) => ({
              ...item,
              projectId: project.id,
              projectName: project.name,
            }));
          }),
        );
        return [...shared, ...local.flat()];
      };
      const [nextTemplates, nextCatalog] = await Promise.all([
        desktop.invoke<TemplateMetadata[]>("templates:list", scope),
        loadComponents(),
      ]);
      if (
        selectedRef.current !== id ||
        catalogScopeRef.current !== requestedScope ||
        componentProjectRef.current !== requestedProject
      )
        return;
      catalogLoaded.current = true;
      setTemplates(nextTemplates);
      setCatalog({
        builtin: nextCatalog.filter(
          (item): item is BuiltinComponentMetadata => "kind" in item,
        ),
        custom: nextCatalog.filter(
          (item): item is CatalogCustomComponent => !("kind" in item),
        ),
      });
    });
    return async () => {
      setCatalogLoading(true);
      try {
        await load();
      } finally {
        setCatalogLoading(false);
      }
    };
  }, []);
  const catalogTemplates = (
    showTemplateVersions ? templates : latestTemplateVersions(templates)
  )
    .slice()
    .sort((a, b) => {
      const priority = (item: TemplateMetadata) =>
        item.scope === "project"
          ? -3
          : item.workflow && item.id !== "system-presentation"
            ? -2
            : item.id === "system-presentation"
              ? 2
              : 0;
      return priority(a) - priority(b);
    });
  const visibleTemplates = catalogTemplates.filter(
    (item) =>
      matchesTemplateType(item, templateType) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(catalogQueries.templates.toLowerCase()),
  );
  return {
    catalogLoaded,
    catalogLoading,
    templates,
    showTemplateVersions,
    setShowTemplateVersions,
    templateType,
    setTemplateType,
    catalog,
    catalogScope,
    setCatalogScope,
    componentProject,
    setComponentProject,
    componentProjectRef,
    componentFilter,
    setComponentFilter,
    componentSourceTabs,
    componentCategory,
    setComponentCategory,
    catalogQueries,
    setCatalogQueries,
    componentGroups,
    loadCatalog,
    catalogTemplates,
    visibleTemplates,
  };
}

export type CatalogState = ReturnType<typeof useCatalogState>;
