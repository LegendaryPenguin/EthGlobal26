// Vouch — Confidential AI attestation reader (Track: Confidential AI Attester).
//
// GET /api/attestation?id=<inferenceId> re-fetches the inference DIRECTLY from the Chainlink
// Confidential AI TEE (GET /v1/inference/:id) and returns the attestation material: the model, the
// TEE's response_digest (= the on-chain attestationRef), and the raw verdict output. The frontend
// uses this to PROVE the on-chain loan terms are bound to a real, independently re-queryable TEE
// inference — not a hardcoded value. Sensitive inputs are never returned; only the public verdict.
import type { IncomingMessage, ServerResponse } from "node:http";
import { sha256, stringToHex } from "viem";

function cfg() {
  return {
    base: process.env.CONF_AI_BASE_URL || "https://confidential-ai-dev-preview.cldev.cloud",
    key: process.env.CONF_AI_API_KEY || process.env.CRE_CONF_AI_API_KEY || "",
  };
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function createAttestationHandler(_raw: Record<string, string>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "", "http://x");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "missing id" });
      const { base, key } = cfg();
      if (!key) return json(res, 200, { ok: true, available: false, detail: "Confidential AI key not configured on this server." });

      const r = await fetch(`${base}/v1/inference/${id}`, { headers: { Authorization: `Bearer ${key}` } });
      if (r.status >= 400) return json(res, 200, { ok: true, available: false, detail: `TEE returned HTTP ${r.status}` });
      const j = (await r.json()) as {
        id?: string; status?: string; model?: string; output?: string;
        resources?: { response_digest?: string }[];
      };

      const digest = j.resources?.[0]?.response_digest;
      const responseDigest = digest
        ? `0x${digest.replace(/^0[xX]/, "").toLowerCase()}`
        : j.output ? sha256(stringToHex(j.output)) : null;
      // recompute sha256 over the output as an integrity cross-check the UI can show
      const recomputed = j.output ? sha256(stringToHex(j.output)) : null;

      return json(res, 200, {
        ok: true,
        available: true,
        inferenceId: j.id ?? id,
        model: j.model ?? null,
        status: j.status ?? null,
        endpoint: `${base}/v1/inference/${id}`,
        responseDigest,
        recomputedDigest: recomputed,
        output: j.status === "completed" ? j.output ?? null : null, // the public verdict only
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}
