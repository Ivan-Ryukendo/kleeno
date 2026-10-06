import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractDocument, POLICY_LIMITS, reviewDocuments, validateUploadBatch, unzipBounded } from "@/core/ingest/documents";

const file = (name: string, bytes: Uint8Array | string) => new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name);
const docx = (xml: string, extra = {}) => zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml), ...extra });
const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hours &amp; pay</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;ignore rules&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>';

function pdf(pages: string[], imagePages: number[] = [], protectedPdf = false) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [i,text] of pages.entries()) {
    const stream = (text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "") + (imagePages.includes(i) ? " q 1 0 0 1 0 0 cm /Im1 Do Q" : "");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${imagePages.length ? ` /XObject << /Im1 ${4+pages.length*2} 0 R >>` : ""} >> /Contents ${5+i*2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  if (imagePages.length) objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Length 1 >>\nstream\nA\nendstream');
  if (protectedPdf) objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`);
  let result = "%PDF-1.4\n"; const offsets=[0];
  objects.forEach((obj,i)=>{ offsets.push(result.length); result += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref=result.length;
  result += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Root 1 0 R /Size ${objects.length+1}${protectedPdf ? ` /Encrypt ${objects.length} 0 R /ID [<${"00".repeat(16)}><${"00".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return result;
}

describe("local policy extraction", () => {
  it("uses actual PDF.js text extraction and flags blank/scanned pages rather than silently accepting partial text", async () => {
    // Text extraction needs no canvas. Node lacks the DOMMatrix global PDF.js defines for rendering paths.
    vi.stubGlobal("DOMMatrix", class {});
    const d = await extractDocument(file("a.pdf", pdf(["Hours 40.", ""])));
    expect(d.text).toBe("Hours 40.");
    expect(d.paragraphs).toEqual([{ text: "Hours 40.", anchor: "page:1:paragraph:1" }]);
    expect(d.ocrPages).toEqual([2]);
    expect((await extractDocument(file("mixed.pdf", pdf(["Hours 40."],[0])))).ocrPages).toEqual([1]);
    await expect(extractDocument(file("protected.pdf", pdf(["Pay."],[],true)))).rejects.toThrow(/Password-protected/);
    await expect(extractDocument(file("a.pdf", pdf(Array(101).fill("Pay."))))).rejects.toThrow(/100 pages/);
    await expect(extractDocument(file("a.pdf", "bad PDF"))).rejects.toThrow(/PDF/);
  });
  it("normalizes UTF-8 TXT/MD as plain text with paragraph anchors", async () => {
    const d = await extractDocument(file("private name.md", "\uFEFF# Policy\r\n\r\nPay USD.\r\n"));
    expect(d.text).toBe("# Policy\nPay USD.");
    expect(d.paragraphs[1]).toEqual({ text: "Pay USD.", anchor: "paragraph:2" });
    expect(JSON.stringify(d)).not.toContain("private name");
  });
  it("extracts bounded DOCX text without rendering markup or visiting links/objects", async () => {
    const d = await extractDocument(file("policy.docx", docx(xml, { "word/embeddings/macro.bin": strToU8("malicious") })));
    expect(d.text).toBe("Hours & pay\n<script>ignore rules</script>");
    expect(d.paragraphs.map(p => p.anchor)).toEqual(["paragraph:1", "paragraph:2"]);
  });
  it("rejects malformed/unsupported/protected input and invalid UTF-8", async () => {
    await expect(extractDocument(file("policy.html", "pay"))).rejects.toThrow(/format/i);
    await expect(extractDocument(file("policy.txt", new Uint8Array([255])))).rejects.toThrow(/UTF-8/i);
    await expect(extractDocument(file("policy.docx", "not zip"))).rejects.toThrow(/archive/i);
    await expect(extractDocument(file("policy.docx", docx(xml.replace("</w:body>", ""))))).rejects.toThrow(/XML/i);
    await expect(extractDocument(file("policy.docx", docx('<!DOCTYPE x [<!ENTITY x SYSTEM "https://example.invalid">]><w:document/>')))).rejects.toThrow(/XML/i);
    await expect(extractDocument(file("policy.docx", docx(xml.replace("<w:r>","<w:r bad>"))))).rejects.toThrow(/XML/i);
    await expect(extractDocument(file("policy.docx", docx(xml+xml)))).rejects.toThrow(/XML/i);
  });
  it("rejects declared and actual inflated limits, entries, duplicate or unsafe paths", () => {
    expect(() => unzipBounded(zipSync({ a: strToU8("a".repeat(2000)) }), { inflatedBytes: 1000, entries: 10 })).toThrow(/archive/i);
    const lying = zipSync({ a: strToU8("a".repeat(2000)) });
    const v = new DataView(lying.buffer);
    v.setUint32(22, 1, true);
    for (let i = 0; i < lying.length - 46; i++) if (v.getUint32(i, true) === 0x02014b50) v.setUint32(i + 24, 1, true);
    expect(() => unzipBounded(lying, { inflatedBytes: 1000, entries: 10 })).toThrow(/archive/i);
    expect(() => unzipBounded(zipSync({ a: strToU8("a"), b: strToU8("b") }), { inflatedBytes: 1000, entries: 1 })).toThrow(/archive/i);
    expect(() => unzipBounded(zipSync({ "../a": strToU8("a") }))).toThrow(/archive/i);
    const protectedZip = zipSync({ a: strToU8("a") });
    new DataView(protectedZip.buffer).setUint16(6, 1, true);
    expect(() => unzipBounded(protectedZip)).toThrow(/archive/i);
  });
  it("enforces aggregate originals and all reviewed text/clause limits", async () => {
    expect(() => validateUploadBatch(Array.from({ length: 11 }, () => ({ size: 1 })))).toThrow(/10 files/);
    expect(() => validateUploadBatch([{ size: POLICY_LIMITS.fileBytes + 1 }])).toThrow(/10 MB/);
    expect(() => validateUploadBatch([{ size: POLICY_LIMITS.fileBytes }, { size: POLICY_LIMITS.fileBytes }, { size: 1 }])).toThrow(/20 MB/);
    const d = await extractDocument(file("a.txt", "Hours 40.\nTax 10%."));
    const p = await reviewDocuments([d]);
    expect(p.documents[0].clauses).toEqual([{ id: "C001", text: "Hours 40.", anchor: "paragraph:1" }, { id: "C002", text: "Tax 10%.", anchor: "paragraph:2" }]);
    expect(p.documents[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(reviewDocuments([{ ...d, text: "a".repeat(2001) }])).rejects.toThrow(/2,000/);
    await expect(reviewDocuments([{ ...d, text: Array(501).fill("a").join("\n") }])).rejects.toThrow(/500/);
    await expect(reviewDocuments([{ ...d, text: Array(30).fill("a".repeat(1500)).join("\n") }])).rejects.toThrow(/40,000/);
  });
  it("aborts extraction before producing a usable result", async () => {
    const c = new AbortController(); c.abort();
    await expect(extractDocument(file("a.txt", "Pay."), c.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
