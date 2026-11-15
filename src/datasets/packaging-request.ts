export const PACKAGING_EVENT = "showai:packaging";

export interface PackagingRequest {
  projectId: string;
  datasetId: string;
  itemId: string;
}

export const datasetPackagingItem = (projectId: string, datasetId: string) =>
  `dataset:${projectId}/${datasetId}`;

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
