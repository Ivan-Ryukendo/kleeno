import "server-only";

export class BodyTooLarge extends Error {
  constructor(maxBytes: number) { super(`Request exceeds ${maxBytes} bytes. Reduce the upload or split rows by period.`); }
}

/** Headers can refuse early, but only the actual stream can enforce a byte budget. */
export async function readBoundedBody(request: Pick<Request, "body" | "headers">, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  try {
    if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new BodyTooLarge(maxBytes);
    if (!reader) return "";
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLarge(maxBytes);
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks)); // like request.text(): strips a leading BOM
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally { reader?.releaseLock(); }
}
