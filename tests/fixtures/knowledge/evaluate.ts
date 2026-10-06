// Reproducible local-only evaluation: npm exec tsx tests/fixtures/knowledge/evaluate.ts
// Uses no credentials, network, real company records or external model.
import { evaluateSynthetic } from "./synthetic";

async function main() {
  const reports = await evaluateSynthetic();
  console.log(JSON.stringify({ mode: "SYNTHETIC_LOCAL_ONLY", embeddingModel: "token-hash-v1", k: 3, retrievalVersion: "native-synthetic-v1", externalModelQualityMeasured: false, reports },null,2));
  if (reports.some(r => r.failedScenarios.length || r.tenantFailures || r.disallowedVersionOverrides || r.unsupportedAcceptedClaims || r.escalationRate !== 1)) process.exitCode = 1;
}
void main().catch(() => { console.error("Synthetic evaluation failed."); process.exitCode = 1; });
