import { createHash } from "node:crypto";
import { SyncError } from "./protocol";

interface UploadStatus {
  id: string | null;
  completed: boolean;
  partBytes: number;
  parts: { part_index: number; digest: string; bytes: number }[];
}
export async function resumableUpload(
  url: string,
  credential: string,
  digest: string,
  bytes: Buffer,
) {
  const request = async <T>(
    path: string,
    method: string,
    body?: BodyInit,
    contentType?: string,
  ): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url + path, {
        method,
        headers: {
          authorization: `Bearer ${credential}`,
          ...(contentType ? { "content-type": contentType } : {}),
        },
        body,
        signal: AbortSignal.timeout(120_000),
      });
      const value = await response.json();
      if (response.ok) return value as T;
      if (
        attempt < 4 &&
        ((response.status === 429 && value.error?.code === "BUSY") ||
          (response.status === 409 &&
            value.error?.code === "UPLOAD_IN_PROGRESS"))
      ) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(
              5000,
              Number(response.headers.get("retry-after") ?? 1) * 1000,
            ) *
              (0.8 + Math.random() * 0.4),
          ),
        );
        continue;
      }
      throw new SyncError(
        response.status,
        value.error?.code ?? "UPLOAD_FAILED",
        value.error?.message ?? "上传失败。",
        value.error?.details,
      );
    }
  };
  const initial = await request<UploadStatus>(
    "/uploads",
    "POST",
    JSON.stringify({ digest, bytes: bytes.length }),
    "application/json",
  );
  if (initial.completed) return;
  if (
    !initial.id ||
    !Number.isSafeInteger(initial.partBytes) ||
    initial.partBytes < 1 ||
    initial.partBytes > 8 * 1024 * 1024
  )
    throw new SyncError(
      400,
      "INVALID_UPLOAD",
      "Invalid resumable upload descriptor.",
    );
  const retained = new Map(
    initial.parts.map((part) => [part.part_index, part]),
  );
  for (
    let index = 0, offset = 0;
    offset < bytes.length || index === 0;
    index++, offset += initial.partBytes
  ) {
    const block = bytes.subarray(
        offset,
        Math.min(bytes.length, offset + initial.partBytes),
      ),
      name = createHash("sha256").update(block).digest("hex");
    const previous = retained.get(index);
    if (previous) {
      if (previous.digest !== name || previous.bytes !== block.length)
        throw new SyncError(
          409,
          "PART_CONFLICT",
          "保留的上传分片与本地内容不同。",
        );
      continue;
    }
    await request(
      `/uploads/${initial.id}/parts/${index}?digest=${name}`,
      "PUT",
      new Uint8Array(block.buffer as ArrayBuffer, block.byteOffset, block.length),
    );
  }
  await request(`/uploads/${initial.id}/complete`, "POST");
}
