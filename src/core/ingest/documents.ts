import { Inflate } from "fflate";

export const POLICY_LIMITS = { fileBytes: 10 * 1024 * 1024, batchBytes: 20 * 1024 * 1024, files: 10, inflatedBytes: 20 * 1024 * 1024, entries: 1000, pages: 100, textChars: 40000, clauseChars: 2000, clauses: 500 } as const;
export type DocumentFormat = "txt" | "md" | "docx" | "pdf";
export interface PolicyParagraph { text: string; anchor: string }
export interface ExtractedDocument { id: string; format: DocumentFormat; text: string; paragraphs: PolicyParagraph[]; ocrPages: number[] }
export interface PolicyUploadPayload {
  policyText: string;
  documents: { id: string; format: DocumentFormat; contentHash: string; clauses: { id: string; text: string; anchor: string }[] }[];
}
export class DocumentError extends Error {}
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };
const utf8 = (bytes: Uint8Array) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new DocumentError("The document is not valid UTF-8 text."); } };
export const normalizePolicyText = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean).join("\n");

export function validateUploadBatch(files: readonly { size: number }[]) {
  if (files.length > POLICY_LIMITS.files) throw new DocumentError("Choose at most 10 files.");
  if (files.some(f => f.size > POLICY_LIMITS.fileBytes)) throw new DocumentError("Each file must be at most 10 MB.");
  if (files.reduce((sum, f) => sum + f.size, 0) > POLICY_LIMITS.batchBytes) throw new DocumentError("Together the files must be at most 20 MB.");
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Validate central/local metadata AND actual streamed inflation before handing XML to any parser. No paths are written. */
export function unzipBounded(bytes: Uint8Array, limits: { inflatedBytes: number; entries: number } = POLICY_LIMITS, signal?: AbortSignal): Record<string, Uint8Array<ArrayBuffer>> {
  const bad = () => new DocumentError("The archive is unsafe, protected, malformed, or exceeds its extraction limits.");
  try {
    abort(signal);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0 || end + 22 + view.getUint16(end + 20, true) !== bytes.length || view.getUint32(end + 4, true) !== 0) throw bad();
    const count = view.getUint16(end + 10, true);
    if (count !== view.getUint16(end + 8, true) || count > limits.entries || count === 0xffff) throw bad();
    let at = view.getUint32(end + 16, true);
    const centralEnd = at + view.getUint32(end + 12, true);
    if (centralEnd !== end) throw bad();
    const result: Record<string, Uint8Array<ArrayBuffer>> = Object.create(null);
    const ranges: [number, number][] = [];
    let inflated = 0;
    for (let i = 0; i < count; i++) {
      abort(signal);
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw bad();
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true), original = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
      const local = view.getUint32(at + 42, true);
      const name = utf8(bytes.subarray(at + 46, at + 46 + nameLength));
      if (flags & 1 || ![0, 8].includes(method) || original + inflated > limits.inflatedBytes || !name || /(^\/|\\|\u0000|(^|\/)\.\.?($|\/))/.test(name) || name in result || view.getUint16(at + 34, true) !== 0) throw bad();
      if (local + 30 > at || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw bad();
      const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
      if (utf8(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) throw bad();
      if (!(flags & 8) && (view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== original || view.getUint32(local + 14, true) !== view.getUint32(at + 16, true))) throw bad();
      const start = local + 30 + localNameLength + localExtra, stop = start + compressed;
      if (stop > view.getUint32(end + 16, true) || ranges.some(([a, b]) => local < b && stop > a)) throw bad();
      ranges.push([local, stop]);
      const chunks: Uint8Array[] = []; let length = 0;
      const collect = (chunk: Uint8Array) => { length += chunk.length; inflated += chunk.length; if (inflated > limits.inflatedBytes || length > original) throw bad(); chunks.push(chunk.slice()); };
      if (method === 0) collect(bytes.subarray(start, stop));
      else {
        const stream = new Inflate(collect);
        // ponytail: 1 KB compressed chunks bound inflation bursts; move parsing to a worker if larger files are approved.
        for (let p = start; p < stop; p += 1024) { abort(signal); stream.push(bytes.subarray(p, Math.min(p + 1024, stop)), p + 1024 >= stop); }
        if (compressed === 0) throw bad();
      }
      if (length !== original) throw bad();
      const content = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
      if (crc32(content) !== view.getUint32(at + 16, true)) throw bad();
      result[name] = content;
      at += 46 + nameLength + extra + comment;
    }
    if (at !== centralEnd) throw bad();
    return result;
  } catch (e) { if (e instanceof DOMException && e.name === "AbortError") throw e; throw bad(); }
}

/** A text-only WordprocessingML reader: balanced tags, no DTD/entity expansion, fields or embedded objects. */
function wordParagraphs(xml: string): PolicyParagraph[] {
  const invalid = () => new DocumentError("The DOCX XML is malformed or unsupported. Save it again, or use plain text.");
  if (/<!DOCTYPE|<!ENTITY|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(xml)) throw invalid();
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g) ?? [];
  if (tokens.join("") !== xml) throw invalid();
  const stack: string[] = []; const out: PolicyParagraph[] = []; let text = "", paragraph = 0, textChars = 0, roots = 0;
  const decode = (s: string) => {
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(s)) throw invalid();
    return s.replace(/&([^;]+);/g, (_, entity: string) => {
    const named: Record<string,string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity in named) return named[entity];
    if (!/^#(\d+|x[\da-f]+)$/i.test(entity)) throw invalid();
    const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || code < 32 && ![9,10,13].includes(code) || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw invalid();
    return String.fromCodePoint(code);
    });
  };
  let prefix = "w";
  for (const token of tokens) {
    if (token.startsWith("<?") || token.startsWith("<!--")) continue;
    if (token.startsWith("<!")) throw invalid();
    if (token.startsWith("</")) {
      const name = /^<\/([\w:.-]+)\s*>$/.exec(token)?.[1];
      if (!name || stack.pop() !== name) throw invalid();
      if (name === `${prefix}:p`) { const normalized = normalizePolicyText(text); if (normalized) out.push({ text: normalized.replaceAll("\n", " "), anchor: `paragraph:${paragraph}` }); text = ""; }
    } else if (token.startsWith("<")) {
      const name = /^<([\w:.-]+)/.exec(token)?.[1];
      if (!name || !/^<[\w:.-]+(?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?\s*>$/.test(token)) throw invalid();
      if (stack.length === 0) {
        if (++roots > 1) throw invalid();
        const ns = /xmlns:([\w.-]+)=["']http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main["']/.exec(token);
        if (!ns || name !== `${ns[1]}:document`) throw invalid(); prefix = ns[1];
      }
      if (name === `${prefix}:p`) paragraph++;
      if ([`${prefix}:tab`, `${prefix}:br`, `${prefix}:cr`].includes(name) && stack.includes(`${prefix}:p`)) text += " ";
      if (!/\/\s*>$/.test(token)) stack.push(name);
    } else if (stack.length === 0 && token.trim()) throw invalid();
    else if (stack.at(-1) === `${prefix}:t` && stack.includes(`${prefix}:p`)) {
      const value = decode(token); text += value; textChars += value.length;
      if (textChars > POLICY_LIMITS.textChars) throw new DocumentError("Extracted text exceeds 40,000 characters.");
    }
  }
  if (stack.length) throw invalid();
  return out;
}

async function pdfParagraphs(bytes: Uint8Array, signal?: AbortSignal) {
  // Image stream dictionaries are outside compressed object streams. Decode escaped PDF names, never images.
  const source = new TextDecoder("latin1").decode(bytes).replace(/#([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex,16)));
  const hasImages = /\/Subtype(?:\s|%[^\r\n]*[\r\n])+\/Image\b/.test(source);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Next bundles the installed worker asset; no remote CDN or file content is sent.
  if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  const loading = pdfjs.getDocument({ data: bytes, maxImageSize: 0, enableXfa: false, useWasm: false, useWorkerFetch: false, useSystemFonts: false, disableFontFace: true });
  const cancel = () => { void loading.destroy(); }; signal?.addEventListener("abort", cancel, { once: true });
  try {
    const pdf = await loading.promise; abort(signal);
    if (pdf.numPages > POLICY_LIMITS.pages) throw new DocumentError("PDFs must be at most 100 pages.");
    const paragraphs: PolicyParagraph[] = [], ocrPages: number[] = []; let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      abort(signal);
      const page = await pdf.getPage(p), content = await page.getTextContent();
      let line = "", n = 0;
      for (const item of content.items) if ("str" in item) { line += item.str + (item.hasEOL ? "\n" : " "); chars += item.str.length + 1; if (chars > POLICY_LIMITS.textChars) throw new DocumentError("Extracted text exceeds 40,000 characters."); }
      for (const text of normalizePolicyText(line).split("\n").filter(Boolean)) paragraphs.push({ text, anchor: `page:${p}:paragraph:${++n}` });
      // ponytail: image-bearing PDFs flag all pages without decoding images; page-local classification can follow an OCR phase.
      if (!line.trim() || hasImages) ocrPages.push(p);
      page.cleanup();
    }
    return { paragraphs, ocrPages };
  } catch (e) {
    abort(signal);
    if (e instanceof DocumentError) throw e;
    throw new DocumentError((e as { name?: string }).name === "PasswordException" ? "Password-protected PDFs are unsupported. Use an unlocked copy." : "The PDF could not be read. Use an unlocked text PDF or plain text.");
  } finally { signal?.removeEventListener("abort", cancel); await loading.destroy(); }
}

export async function extractDocument(file: File, signal?: AbortSignal): Promise<ExtractedDocument> {
  abort(signal); validateUploadBatch([file]);
  const format = file.name.split(".").at(-1)?.toLowerCase() as DocumentFormat;
  if (!["txt","md","docx","pdf"].includes(format)) throw new DocumentError("Unsupported format. Choose TXT, Markdown, DOCX, or a text PDF.");
  const bytes = new Uint8Array(await file.arrayBuffer()); abort(signal);
  let paragraphs: PolicyParagraph[], ocrPages: number[] = [];
  if (format === "docx") {
    const archive = unzipBounded(bytes, POLICY_LIMITS, signal);
    if (!archive["word/document.xml"] || !archive["[Content_Types].xml"]) throw new DocumentError("This archive is not a DOCX document.");
    paragraphs = wordParagraphs(utf8(archive["word/document.xml"]));
  } else if (format === "pdf") ({ paragraphs, ocrPages } = await pdfParagraphs(bytes, signal));
  else paragraphs = normalizePolicyText(utf8(bytes)).split("\n").filter(Boolean).map((text, i) => ({ text, anchor: `paragraph:${i + 1}` }));
  const text = paragraphs.map(p => p.text).join("\n");
  if (text.length > POLICY_LIMITS.textChars) throw new DocumentError("Extracted text exceeds 40,000 characters.");
  if (!text && ocrPages.length === 0) throw new DocumentError("The document contains no usable text.");
  abort(signal);
  return { id: crypto.randomUUID(), format, text, paragraphs, ocrPages };
}

/** Hash the HR-reviewed text only. Edited paragraphs explicitly lose their original page anchor. */
export async function reviewDocuments(input: ExtractedDocument[]): Promise<PolicyUploadPayload> {
  const texts = input.map(d => normalizePolicyText(d.text));
  const policyText = texts.join("\n");
  if (!policyText) throw new DocumentError("Add policy text before continuing.");
  if (policyText.length > POLICY_LIMITS.textChars) throw new DocumentError("Together the text must be at most 40,000 characters.");
  let count = 0;
  const documents = [];
  for (const [index, d] of input.entries()) {
    const lines = texts[index].split("\n").filter(Boolean);
    if (!lines.length) throw new DocumentError("Every document needs reviewed text, or remove it.");
    const unchanged = texts[index] === d.paragraphs.map(p => p.text).join("\n");
    const clauses = lines.map((text, i) => {
      if (text.length > POLICY_LIMITS.clauseChars) throw new DocumentError("Split policy lines longer than 2,000 characters.");
      if (++count > POLICY_LIMITS.clauses) throw new DocumentError("Use at most 500 policy clauses across all documents.");
      return { id: `C${String(count).padStart(3, "0")}`, text, anchor: unchanged ? d.paragraphs[i].anchor : `reviewed:paragraph:${i + 1}` };
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texts[index]));
    documents.push({ id: d.id, format: d.format, contentHash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join(""), clauses });
  }
  return { policyText, documents };
}
