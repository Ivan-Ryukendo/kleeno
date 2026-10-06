"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { DocumentError, extractDocument, normalizePolicyText, POLICY_LIMITS, reviewDocuments, validateUploadBatch, type ExtractedDocument, type PolicyUploadPayload } from "@/core/ingest/documents";

export type { PolicyUploadPayload } from "@/core/ingest/documents";
interface LocalDocument { fileName: string; size: number; extracted: ExtractedDocument; reviewed: boolean }
const area = "min-h-40 w-full rounded-field border border-field-border bg-white px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40";

/** Originals and filenames stay local. Only explicitly reviewed text/provenance reaches the configuration host. */
export function PolicyUpload({ onChange, onPendingChange, disabled = false }: { onChange: (payload: PolicyUploadPayload | null) => void; onPendingChange?: (pending: boolean) => void; disabled?: boolean }) {
  const id = useId();
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  function invalidate() { generation.current++; controller.current?.abort(); onChange(null); onPendingChange?.(true); setError(null); setStatus(""); }
  function cancel() { invalidate(); onPendingChange?.(documents.length > 0); setBusy(false); setStatus("Cancelled. No new document was added."); }

  async function add(files: File[]) {
    if (disabled || !files.length) return;
    invalidate(); const ticket = generation.current;
    const current = documents.map(d => ({ ...d, reviewed: false })); setDocuments(current);
    try {
      validateUploadBatch([...current, ...files]);
      const c = new AbortController(); controller.current = c; setBusy(true);
      const added: LocalDocument[] = [];
      for (const file of files) {
        setStatus(`Reading document ${added.length + 1} of ${files.length} on this computer…`);
        const extracted = await extractDocument(file, c.signal);
        if (ticket !== generation.current) return;
        added.push({ fileName: file.name, size: file.size, extracted, reviewed: false });
      }
      if (ticket === generation.current) { setDocuments([...current, ...added]); setStatus("Extraction ready. Check every document below before using its text."); }
    } catch (e) {
      if (ticket === generation.current && !(e instanceof DOMException && e.name === "AbortError")) { onPendingChange?.(current.length > 0); setError(e instanceof DocumentError ? e.message : "The document could not be read. Try plain text."); }
    } finally { if (ticket === generation.current) setBusy(false); }
  }

  async function useReviewed() {
    invalidate(); const ticket = generation.current;
    setBusy(true);
    try {
      const payload = await reviewDocuments(documents.map(d => d.extracted));
      if (ticket === generation.current) { onChange(payload); onPendingChange?.(false); setStatus(`${payload.documents.length} reviewed documents ready for the policy proposal.`); }
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : "Check the extracted text."); }
    finally { if (ticket === generation.current) setBusy(false); }
  }

  return <section className="space-y-4" aria-labelledby={`${id}-heading`}>
    <div><h3 id={`${id}-heading`} className="text-lg font-medium">Upload your pay policy</h3><p id={`${id}-limits`} className="mt-1 text-sm text-muted-foreground">TXT, Markdown, DOCX or text PDF. Up to 10 files, 10 MB each and 20 MB together. PDFs: 100 pages. DOCX: 20 MB unpacked and 1,000 archive entries. Reviewed text: 40,000 characters, 500 lines, 2,000 characters per line.</p></div>
    <div className="rounded-box border border-dashed border-field-border p-4" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void add(Array.from(e.dataTransfer.files)); }}>
      <Label htmlFor={`${id}-files`}>Browse files or drop them here</Label>
      <input id={`${id}-files`} type="file" multiple accept=".txt,.md,.docx,.pdf" disabled={disabled || busy} aria-describedby={`${id}-limits ${id}-privacy`} className="mt-2 block max-w-full text-sm" onChange={e => { void add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <p id={`${id}-privacy`} className="mt-2 text-sm text-muted-foreground">Files and filenames stay on this computer. Reviewed policy text will be sent for an AI proposal and encrypted for storage. Remove names and private worker details before continuing.</p>
    </div>
    {busy && <Button type="button" variant="outline" onClick={cancel}>Cancel reading</Button>}
    {documents.map((d, index) => <div key={d.extracted.id} className="rounded-box border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="min-w-0 break-all font-medium">Document {index + 1}: {d.fileName}</h4><Button type="button" variant="ghost" disabled={disabled} onClick={() => { invalidate(); onPendingChange?.(documents.length > 1); setBusy(false); setDocuments(ds => ds.filter(x => x.extracted.id !== d.extracted.id)); }}>Remove document {index + 1}</Button></div>
      {d.extracted.ocrPages.length > 0 && <p className="mt-2 text-sm font-medium text-signal">OCR required or image content needs checking on pages {d.extracted.ocrPages.join(", ")}. Supply the complete missing policy text below. Partial extraction cannot be used as-is.</p>}
      <p className="mt-2 text-sm text-muted-foreground">Check reading order, tables and every policy line. Editing replaces original page references with reviewed paragraph references.</p>
      <Label htmlFor={`${id}-text-${index}`}>Editable extracted text, document {index + 1}</Label>
      <textarea id={`${id}-text-${index}`} className={area} maxLength={POLICY_LIMITS.textChars} disabled={disabled || busy} value={d.extracted.text} onChange={e => { invalidate(); const text = e.target.value; setDocuments(ds => ds.map(x => x.extracted.id === d.extracted.id ? { ...x, reviewed: false, extracted: { ...x.extracted, text } } : x)); }} />
      <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" disabled={disabled || busy || !d.extracted.text.trim() || d.extracted.ocrPages.length > 0 && normalizePolicyText(d.extracted.text) === d.extracted.paragraphs.map(p => p.text).join("\n")} checked={d.reviewed} onChange={e => { invalidate(); setDocuments(ds => ds.map(x => x.extracted.id === d.extracted.id ? { ...x, reviewed: e.target.checked } : x)); }} />I checked this document against the original and supplied any missing text.</label>
    </div>)}
    {documents.length > 0 && <Button type="button" disabled={disabled || busy || documents.some(d => !d.reviewed)} onClick={useReviewed}>Use reviewed policy text</Button>}
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    {error && <p role="alert" className="text-sm font-medium text-signal">{error}</p>}
  </section>;
}
