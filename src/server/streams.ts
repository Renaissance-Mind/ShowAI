import { SyncError } from "../sync/protocol";
import type { StreamDigest } from "./storage";

export function verifiedStream(
  body: ReadableStream<Uint8Array>,
  digest: StreamDigest,
  expected: string,
  maximum: number,
  expectedBytes?: number,
) {
  let length = 0;
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
        await digest.update(bytes);
        controller.enqueue(bytes);
      },
      async flush() {
        if (
          (expectedBytes !== undefined && length !== expectedBytes) ||
          (await digest.finish()) !== expected
        )
          throw new SyncError(
            400,
            "DIGEST_MISMATCH",
            "Content does not match its verified digest or length.",
          );
      },
    }),
  );
}
