// Standalone browser behavior check: npm exec tsx tests/unit/ingest/uploads.browser.ts
// Synthetic local harness only; production auth/encryption-at-rest acceptance remains in the integration lane.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

async function main() {
  const root = process.cwd();
  const bundle = await build({
    stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {PolicyUpload} from '@/components/policy-upload'; import {LocalNameUnlock} from '@/components/local-name-unlock';
      import {sealNameKey,emptyNameKey,codeFor} from '@/core/ingest/name-key';
      window.makeKey=async()=>{ const k=emptyNameKey(); codeFor(k,'Jane Local Canary'); return sealNameKey(k,'correct horse battery'); };
      function App(){ const [context,setContext]=useState('a'); return <><PolicyUpload onChange={p=>window.payload=p} onPendingChange={p=>window.pending=p}/><LocalNameUnlock key={context} contextKey={context} workerCodes={['W001']}/><button onClick={()=>setContext('b')}>Switch company</button></> }
      createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", alias: { "@": path.join(root,"src") },
    plugins: [{ name: "local-pdf", setup(b) { b.onResolve({ filter: /^pdfjs-dist\/legacy\/build\/pdf.mjs$/ }, () => ({ path: "/pdf.mjs", external: true })); } }],
  });
  const requests: string[] = [];
  const server = createServer(async (req,res) => {
    requests.push(`${req.method} ${req.url}`);
    try {
      if (req.url === "/app.js") { res.setHeader("content-type","text/javascript"); res.end(bundle.outputFiles[0].text); }
      else if (req.url === "/pdf.mjs" || req.url?.endsWith("pdf.worker.mjs")) { res.setHeader("content-type","text/javascript"); res.end(await readFile(path.join(root,"node_modules/pdfjs-dist/legacy/build",req.url.endsWith("pdf.worker.mjs") ? "pdf.worker.mjs" : "pdf.mjs"))); }
      else { res.setHeader("content-type","text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); }
    } catch { res.statusCode=500; res.end("Fixture failed"); }
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.UPLOAD_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage({ viewport: { width:375,height:900 }, reducedMotion:"reduce" });
    const pageErrors: string[]=[]; page.on("pageerror",e=>pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    const upload = page.getByLabel("Browse files or drop them here");
    await upload.setInputFiles({ name:"private-filename.txt",mimeType:"text/plain",buffer:Buffer.from("Hours 40.\nTax 10%.") });
    await expect(page.getByLabel("Editable extracted text, document 1")).toHaveValue("Hours 40.\nTax 10%.");
    await expect(page.getByRole("button",{name:"Use reviewed policy text"})).toBeDisabled();
    await page.getByRole("checkbox").focus(); await page.keyboard.press("Space");
    await page.getByRole("button",{name:"Use reviewed policy text"}).click();
    await page.waitForFunction(()=>Boolean((window as unknown as {payload:unknown}).payload));
    const payload=await page.evaluate(()=>JSON.stringify((window as unknown as {payload:unknown}).payload));
    expect(payload).toContain('"C001"'); expect(payload).not.toContain("private-filename");
    await page.getByLabel("Editable extracted text, document 1").fill("Updated hours 40.");
    expect(await page.evaluate(()=>[(window as unknown as {payload:unknown}).payload,(window as unknown as {pending:boolean}).pending])).toEqual([null,true]);
    await page.getByRole("button",{name:"Remove document 1"}).click();
    expect(await page.evaluate(()=>(window as unknown as {pending:boolean}).pending)).toBe(false);

    // Hold local File reading, cancel, then release it: stale extraction must never reappear.
    await page.evaluate(()=>{ const original=File.prototype.arrayBuffer; File.prototype.arrayBuffer=function(){ return new Promise(resolve=>{ (window as unknown as {release:()=>void}).release=()=>{ File.prototype.arrayBuffer=original; void original.call(this).then(resolve); }; }); }; });
    await upload.setInputFiles({name:"cancel.txt",mimeType:"text/plain",buffer:Buffer.from("Do not reappear.")});
    await page.getByRole("button",{name:"Cancel reading"}).click();
    await page.evaluate(()=>(window as unknown as {release:()=>void}).release());
    await expect(page.getByLabel("Editable extracted text, document 1")).toHaveCount(0);

    const stream="BT /F1 12 Tf 72 720 Td (Hours 40.) Tj ET";
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [4 0 R] >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf="%PDF-1.4\n"; const offsets:number[]=[]; objects.forEach((o,i)=>{ offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`; }); const start=pdf.length;
    pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(o=>`${String(o).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF\n`;
    await upload.setInputFiles({name:"local.pdf",mimeType:"application/pdf",buffer:Buffer.from(pdf)});
    await expect(page.getByLabel("Editable extracted text, document 1")).toHaveValue("Hours 40.");
    expect(requests.some(r=>r.endsWith("pdf.worker.mjs"))).toBe(true);
    await page.getByRole("button",{name:"Remove document 1"}).click();

    const encrypted=await page.evaluate(()=>(window as unknown as {makeKey:()=>Promise<string>}).makeKey());
    await page.getByLabel("Encrypted name key file").setInputFiles({name:"key.json",mimeType:"application/json",buffer:Buffer.from(encrypted)});
    await page.getByLabel("Name key passphrase").fill("incorrect long password");
    await page.getByRole("button",{name:"Unlock local names"}).click();
    await expect(page.getByRole("alert")).toContainText("Wrong passphrase");
    await page.getByLabel("Name key passphrase").fill("correct horse battery");
    await page.getByRole("button",{name:"Unlock local names"}).click();
    await expect(page.getByText("jane local canary",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Switch company"}).click();
    await expect(page.getByText("jane local canary",{exact:true})).toHaveCount(0);
    await expect(page.getByLabel("Name key passphrase")).toHaveValue("");
    expect(requests.every(r=>r.startsWith("GET "))).toBe(true); expect(pageErrors).toEqual([]);
    console.log("Local upload browser checks passed: keyboard review, invalidation, cancellation/stale result, filename privacy, real local PDF worker extraction, wrong passphrase and company-change clearing; no data requests.");
  } finally { await browser?.close(); await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
}
void main().catch(e=>{ console.error(e); process.exitCode=1; });
