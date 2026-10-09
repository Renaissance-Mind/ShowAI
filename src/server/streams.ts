import { SyncError } from "../sync/protocol";
import type { StreamDigest } from "./storage";

/** A admitted request cannot hold backup drainage open with an endless body. */
export function deadlineBody(
  body: ReadableStream<Uint8Array>,
  milliseconds = 120_000,
) {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        timer = setTimeout(() => {
          stopped = true;
          controller.error(
            new SyncError(
              408,
              "REQUEST_TIMEOUT",
              "The request body exceeded its transfer deadline.",
            ),
          );
          void reader
            .cancel("request body deadline")
            .catch((error) =>
              console.error("Request body cancellation failed", error),
            );
        }, milliseconds);
      },
      async pull(controller) {
        pending = reader.read();
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await pending;
        } finally {
          pending = undefined;
        }
        if (stopped) return;
        if (next.done) {
          clearTimeout(timer);
          controller.close();
        } else controller.enqueue(next.value);
      },
      async cancel(reason) {
        stopped = true;
        clearTimeout(timer);
        await reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return {
    body: stream,
    async dispose() {
      clearTimeout(timer);
      stopped = true;
      try {
        if (pending) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export function verifiedStream(
  body: ReadableStream<Uint8Array>,
  digest: StreamDigest,
  expected: string,
  maximum: number,
  expectedBytes?: number,
) {
  let length = 0;
  let buffer = new Uint8Array(64 * 1024),
    filled = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(bytes, controller) {
        length += bytes.byteLength;
        if (length > maximum)
          throw new SyncError(
            413,
            "TOO_LARGE",
            "Object exceeds its size limit.",
          );
        for (let offset = 0; offset < bytes.byteLength;) {
          const count = Math.min(
            buffer.length - filled,
            bytes.byteLength - offset,
          );
          buffer.set(bytes.subarray(offset, offset + count), filled);
          filled += count;
          offset += count;
          if (filled === buffer.length) {
            await digest.update(buffer);
            controller.enqueue(buffer);
            buffer = new Uint8Array(64 * 1024);
            filled = 0;
          }
        }
      },
      async flush(controller) {
        if (filled) await digest.update(buffer.subarray(0, filled));
        if (
          (expectedBytes !== undefined && length !== expectedBytes) ||
          (await digest.finish()) !== expected
        )
          throw new SyncError(
            400,
            "DIGEST_MISMATCH",
            "Content does not match its verified digest or length.",
          );
        if (filled) controller.enqueue(buffer.subarray(0, filled));
      },
    }),
  );
}
