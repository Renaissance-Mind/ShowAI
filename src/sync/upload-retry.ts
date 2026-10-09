import { SyncError } from "./protocol";

/** Upload identities are immutable digests or durable task/part IDs. Retrying
 * them after an ambiguous transport failure cannot publish a second revision. */
export async function retryUpload<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const transient =
        error instanceof SyncError
          ? (error.status === 429 && error.code === "BUSY") ||
            (error.status === 409 && error.code === "UPLOAD_IN_PROGRESS") ||
            [502, 503, 504].includes(error.status)
          : error instanceof TypeError ||
            (error instanceof Error &&
              ["AbortError", "TimeoutError"].includes(error.name));
      if (!transient || attempt >= 4) throw error;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(5000, 500 * 2 ** attempt) * (0.8 + Math.random() * 0.4),
        ),
      );
    }
  }
}
