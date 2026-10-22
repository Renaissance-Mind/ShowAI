import {
  PortableCubicInputOwner,
  type CubicInputRequest,
} from "./portable-cubic-worker-model";
const owner = new PortableCubicInputOwner();
const endpoint = globalThis as unknown as {
  onmessage:
    | ((event: { data: { id: string; request: CubicInputRequest } }) => void)
    | null;
  postMessage(value: unknown): void;
};
endpoint.onmessage = ({ data }) => {
  try {
    const result = owner.execute(data.request);
    // The receiver already owns every unchanged command chunk. Only final
    // per-chunk affine paths/bounds are new; don't clone the complete numeric
    // mesh across the thread again at pen-up.
    if (result.sealed) {
      const { geometry, ...sealed } = result.sealed;
      const { commands, ...summary } = geometry;
      void commands;
      endpoint.postMessage({
        id: data.id,
        ok: true,
        result: {
          ...result,
          sealed: {
            ...sealed,
            geometry: {
              ...summary,
              chunks: geometry.chunks.map(({ commands, ...chunk }) => {
                void commands;
                return chunk;
              }),
            },
          },
        },
      });
    } else endpoint.postMessage({ id: data.id, ok: true, result });
  } catch (error) {
    endpoint.postMessage({
      id: data.id,
      ok: false,
      error: {
        code:
          (error as { code?: string }).code ??
          (error instanceof RangeError
            ? "CUBIC_GEOMETRY_BUDGET"
            : "CUBIC_INPUT_FAILURE"),
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
