# Document and Policy Sources (Later)

Google Drive, Microsoft OneDrive / SharePoint, Dropbox. Capabilities `FILE_PICKER`, `DOCUMENT_READ`.

```text
human picks one policy document (provider file picker, narrowest scope, e.g. per-file access)
  -> server fetches that file only -> size/type limits -> text extraction (deterministic)
  -> human selects the policy clauses -> clauses stored (encrypted, S41) with provenance
  -> PolicyInterpreter (AI) via src/core/ai/inputs/ -> validation -> HR approval
```
- Never scan folders, never send whole documents to the LLM. Only the clauses the human selected enter a prompt, as today (rule 5).
- Clause provenance: file ID, revision ID, fetched at, clause hash. A new revision of the file does not change an approved config; it can start a new config version.
- Document text is data, never instructions (rule 6).
