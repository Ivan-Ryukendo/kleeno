"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { namesByCode, NameKeyError, openNameKey } from "@/core/ingest/name-key";

/** A company/account context change remounts the local session, immediately clearing all name/key state. */
export function LocalNameUnlock({ contextKey, workerCodes, onChange }: { contextKey: string; workerCodes: string[]; onChange?: (names: Record<string, string>) => void }) {
  return <LocalNameSession key={contextKey} contextKey={contextKey} workerCodes={workerCodes} onChange={onChange} />;
}

function LocalNameSession({ contextKey, workerCodes, onChange }: { contextKey: string; workerCodes: string[]; onChange?: (names: Record<string, string>) => void }) {
  const id = useId(), generation = useRef(0);
  const [file, setFile] = useState<File | null>(null), [passphrase, setPassphrase] = useState("");
  const [names, setNames] = useState<{ context: string; value: Record<string,string> } | null>(null), [error, setError] = useState<string | null>(null), [busy,setBusy] = useState(false);
  const callback = useRef(onChange); useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => () => { generation.current++; callback.current?.({}); }, []);
  function clear() { generation.current++; setNames(null); setFile(null); setPassphrase(""); setError(null); setBusy(false); callback.current?.({}); }
  const visible = names?.context === contextKey ? names.value : null;
  return <section className="mt-6 rounded-box border border-border p-4" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="text-lg">Show names on this computer</h2>
    <p className="mt-1 text-sm text-muted-foreground">Open your encrypted name key locally. The file, passphrase and names are never sent to Kleeno. Lock it when you finish; changing company or account clears the names.</p>
    {!visible && <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault(); setError(null); if (!file) return setError("Choose your encrypted name key file.");
      const ticket = ++generation.current; setBusy(true);
      try {
        if (file.size > 5 * 1024 * 1024) throw new NameKeyError("BAD_FILE");
        const key = await openNameKey(await file.text(), passphrase);
        if (ticket === generation.current) { const value = namesByCode(key, workerCodes); setNames({ context: contextKey, value }); setPassphrase(""); setFile(null); callback.current?.(value); }
      } catch (e) { if (ticket === generation.current) setError(e instanceof NameKeyError ? e.message : "That name key could not be opened."); }
      finally { if (ticket === generation.current) setBusy(false); }
    }}>
      <div><Label htmlFor={`${id}-file`}>Encrypted name key file</Label><input id={`${id}-file`} type="file" accept=".json,application/json" disabled={busy} className="mt-2 block max-w-full text-sm" onChange={e => { generation.current++; setFile(e.target.files?.[0] ?? null); setError(null); }} /></div>
      <div><Label htmlFor={`${id}-pass`}>Name key passphrase</Label><Input id={`${id}-pass`} type="password" autoComplete="off" required minLength={12} disabled={busy} value={passphrase} onChange={e => setPassphrase(e.target.value)} /></div>
      <Button type="submit" disabled={busy || !file} className="sm:col-span-2 sm:justify-self-start">{busy ? "Opening locally…" : "Unlock local names"}</Button>
    </form>}
    {visible && <><p role="status" className="mt-3 text-sm">Local names unlocked for {Object.keys(visible).length} workers.</p><dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">{workerCodes.map(code => <div key={code} className="flex flex-wrap justify-between gap-2 border-b border-border py-2"><dt className="font-medium">{code}</dt><dd className="break-words">{visible[code] ?? "No name in this key"}</dd></div>)}</dl><Button type="button" variant="outline" className="mt-4" onClick={clear}>Lock and clear names</Button></>}
    {error && <p role="alert" className="mt-3 text-sm font-medium text-signal">{error}</p>}
  </section>;
}
