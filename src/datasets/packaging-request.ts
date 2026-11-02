/**
 * Event a bound block sends to choose what synchronization carries of its
 * linked file. The workbench takes it (preventDefault) for a project that
 * syncs and opens that project's packaging list on the item; otherwise the
 * block opens its shared data dialog at the file's synchronization choice.
 */
export const PACKAGING_EVENT = "showai:packaging";

export interface PackagingRequest {
  projectId: string;
  datasetId: string;
  /** The item id in the project's packaging plan. */
  itemId: string;
}

/** The packaging item id of a dataset, as core/packaging names it. */
export const datasetPackagingItem = (projectId: string, datasetId: string) =>
  `dataset:${projectId}/${datasetId}`;

/**
 * Asks the workbench to open the packaging list on a dataset's item; false
 * when nothing took the request (the project does not sync here).
 */
export function requestPackaging(projectId: string, datasetId: string) {
  const detail: PackagingRequest = {
    projectId,
    datasetId,
    itemId: datasetPackagingItem(projectId, datasetId),
  };
  return !window.dispatchEvent(
    new CustomEvent(PACKAGING_EVENT, { detail, cancelable: true }),
  );
}
