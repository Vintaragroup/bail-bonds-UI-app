import { useMutation, useQuery } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

// Authenticated health check for the enrichment proxy target
// Returns { ok: boolean, target?: string, status?: number }
export function useEnrichmentProxyHealth(options = {}) {
  return useQuery({
    queryKey: ['enrichmentProxyHealth'],
    queryFn: async () => {
      try {
        const data = await getJSON('/enrichment/_proxy_health');
        return { ok: Boolean(data?.ok), target: data?.target, status: data?.status };
      } catch (e) {
        return { ok: false };
      }
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    ...options,
  });
}

// Providers list for the Enrichment dropdown
// UI -> GET /api/enrichment/providers (same-origin) -> server enrichmentProxy -> ENRICHMENT_API_URL/api/enrichment/providers
// Returned shape: { providers: [{ id, label, default?, supportsForce? }] }
// Note: This endpoint requires an authenticated session or valid bearer token.
export function useEnrichmentProviders(options = {}) {
  return useQuery({
    queryKey: ['enrichmentProviders:proxy'],
    queryFn: () => getJSON('/enrichment/providers'),
    // Always refetch on mount to pick up newly enabled providers (e.g., Pipl)
    refetchOnMount: 'always',
    staleTime: 300_000,
    ...options,
  });
}

// POST /enrichment/pipl_first_pull { subjectId }
export function usePiplFirstPull(options = {}) {
  return useMutation({
    mutationFn: ({ subjectId, overrideLocation }) =>
      sendJSON('/enrichment/pipl_first_pull', {
        method: 'POST',
        body: { subjectId, overrideLocation: Boolean(overrideLocation) || undefined },
      }),
    ...options,
  });
}

// GET /enrichment/crm_suggestions?subjectId=SPN
export function useCrmSuggestions(subjectId, options = {}) {
  return useQuery({
    queryKey: ['crmSuggestions', subjectId],
    enabled: Boolean(subjectId),
    queryFn: () => getJSON(`/enrichment/crm_suggestions?subjectId=${encodeURIComponent(subjectId)}`),
    staleTime: 30_000,
    ...options,
  });
}

// GET /enrichment/subject_summary?subjectId=SPN
export function useSubjectSummary(subjectId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: ['enrichmentSubjectSummary', subjectId],
    enabled: Boolean(subjectId) && enabled,
    queryFn: () => getJSON(`/enrichment/subject_summary?subjectId=${encodeURIComponent(subjectId)}`),
    staleTime: 30_000,
    ...rest,
  });
}

// GET /enrichment/pipl_matches?subjectId=SPN (proxied)
export function usePiplMatches(subjectId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: ['piplMatches', subjectId],
    enabled: Boolean(subjectId) && enabled,
    queryFn: () => getJSON(`/enrichment/pipl_matches?subjectId=${encodeURIComponent(subjectId)}`),
    staleTime: 30_000,
    ...rest,
  });
}

// GET /enrichment/providers/pipl/raw?subjectId=SPN (proxied to /api/providers/pipl/raw)
export function usePiplRaw(subjectId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: ['piplRaw', subjectId],
    enabled: Boolean(subjectId) && enabled,
    queryFn: () => getJSON(`/enrichment/providers/pipl/raw?subjectId=${encodeURIComponent(subjectId)}`),
    staleTime: 30_000,
    ...rest,
  });
}

// POST /enrichment/related_party_pull { subjectId, maxParties?, partyId?, partyName?, requireUnique?, matchMin?, aggressive?, preferStatewide? }
// Triggers enrichment of related parties for a subject; server may enrich top N or a specific party when partyId/partyName is provided.
export function useRelatedPartyPull(options = {}) {
  return useMutation({
    mutationFn: ({ subjectId, maxParties, partyId, partyName, requireUnique, matchMin, aggressive, preferStatewide, force }) =>
      sendJSON('/enrichment/related_party_pull', {
        method: 'POST',
        body: {
          subjectId,
          // Optional params; server ignores unknowns
          maxParties: typeof maxParties === 'number' ? maxParties : undefined,
          partyId: partyId ? String(partyId) : undefined,
          partyName: partyName || undefined,
          requireUnique: typeof requireUnique === 'boolean' ? requireUnique : undefined,
          matchMin: typeof matchMin === 'number' ? matchMin : undefined,
          aggressive: aggressive ? true : undefined,
          preferStatewide: typeof preferStatewide === 'boolean' ? preferStatewide : undefined,
          force: force ? true : undefined,
        },
      }),
    ...options,
  });
}

// GET /enrichment/related_party_audits?subjectId=...&partyId=...&limit=50
// Returns { ok, count, summary, rows } where rows are flattened audit entries.
export function useRelatedPartyAudits(subjectId, partyId, limit = 50, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: ['relatedPartyAudits', subjectId, partyId, limit],
    enabled: Boolean(subjectId) && Boolean(partyId) && enabled,
    queryFn: () =>
      getJSON(
        `/enrichment/related_party_audits?subjectId=${encodeURIComponent(
          subjectId
        )}&partyId=${encodeURIComponent(partyId)}&limit=${encodeURIComponent(String(limit))}`
      ),
    staleTime: 15_000,
    ...rest,
  });
}

// GET /enrichment/related_parties?subjectId=SPN
// Returns a list of related parties with partyId, name, relationType, and lastAudit
export function useRelatedParties(subjectId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: ['relatedParties', subjectId],
    enabled: Boolean(subjectId) && enabled,
    queryFn: () => getJSON(`/enrichment/related_parties?subjectId=${encodeURIComponent(subjectId)}`),
    staleTime: 15_000,
    ...rest,
  });
}

// POST /enrichment/related_party_validate_phones { subjectId, maxPerParty? }
// Validates stored related-party phones via Whitepages for the subject
export function useValidateRelatedPartyPhones(options = {}) {
  return useMutation({
    mutationFn: ({ subjectId, maxPerParty }) =>
      sendJSON('/enrichment/related_party_validate_phones', {
        method: 'POST',
        body: {
          subjectId,
          maxPerParty: typeof maxPerParty === 'number' ? maxPerParty : undefined,
        },
      }),
    ...options,
  });
}

// POST /enrichment/related_party_override { subjectId, partyId, relationType?, relationLabel?, confidence? }
// Admin override to correct a party's relationship classification
export function useRelatedPartyOverride(options = {}) {
  return useMutation({
    mutationFn: ({ subjectId, partyId, relationType, relationLabel, confidence }) =>
      sendJSON('/enrichment/related_party_override', {
        method: 'POST',
        body: {
          subjectId,
          partyId,
          relationType: relationType || undefined,
          relationLabel: relationLabel || undefined,
          confidence: typeof confidence === 'number' ? confidence : undefined,
        },
      }),
    ...options,
  });
}

