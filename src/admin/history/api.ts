// Data hooks of the medical history tab: history, import, insurance and the consent form mapping.
// Health data: queries keep it only briefly in memory and never refetch on window focus (every read is audit-logged).

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import type {
  HistoryDocument,
  HistoryDto,
  ImportResult,
  InsuranceDto,
  IntakeSubmissionDto,
  SaveResult,
} from "../../server";
import { api, type ApiError } from "@appointit/plugin-sdk/client";
import { dentalKeys } from "../alerts/api";

export type { HistoryDocument, HistoryDto, ImportResult, InsuranceDto, IntakeSubmissionDto, SaveResult };

const seg = encodeURIComponent;

export const historyKeys = {
  history: (customerId: string) => ["dental", "history", customerId] as const,
  intake: (customerId: string) => ["dental", "history", customerId, "intake"] as const,
  insurance: (customerId: string) => ["dental", "insurance", customerId] as const,
  consentForms: () => ["dental", "consent-forms"] as const,
};

const HEALTH_CACHE = { staleTime: 5 * 60_000, gcTime: 60_000, refetchOnWindowFocus: false, retry: false } as const;

export function useHistory(customerId: string): UseQueryResult<HistoryDto, ApiError> {
  return useQuery<HistoryDto, ApiError>({
    queryKey: historyKeys.history(customerId),
    queryFn: ({ signal }) => api<HistoryDto>(`/ext/dental/history/${seg(customerId)}`, { signal }),
    ...HEALTH_CACHE,
  });
}

export type SaveHistoryInput = { expectedVersion: number; document: HistoryDocument; markReviewed?: boolean };

export function useSaveHistory(customerId: string): UseMutationResult<SaveResult, ApiError, SaveHistoryInput> {
  const queryClient = useQueryClient();
  return useMutation<SaveResult, ApiError, SaveHistoryInput>({
    mutationFn: (input) => api<SaveResult>(`/ext/dental/history/${seg(customerId)}`, { method: "PUT", body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyKeys.history(customerId) });
      await queryClient.invalidateQueries({ queryKey: dentalKeys.alerts() });
    },
  });
}

export function useIntakeSubmissions(customerId: string, enabled: boolean): UseQueryResult<IntakeSubmissionDto[], ApiError> {
  return useQuery<IntakeSubmissionDto[], ApiError>({
    queryKey: historyKeys.intake(customerId),
    queryFn: ({ signal }) => api<IntakeSubmissionDto[]>(`/ext/dental/history/${seg(customerId)}/submissions`, { signal }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useImportHistory(customerId: string): UseMutationResult<ImportResult, ApiError, { submissionId: string }> {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, ApiError, { submissionId: string }>({
    mutationFn: (input) => api<ImportResult>(`/ext/dental/history/${seg(customerId)}/import`, { method: "POST", body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyKeys.history(customerId) });
      await queryClient.invalidateQueries({ queryKey: dentalKeys.alerts() });
    },
  });
}

// ---- insurance ----

export function useInsurance(customerId: string): UseQueryResult<InsuranceDto[], ApiError> {
  return useQuery<InsuranceDto[], ApiError>({
    queryKey: historyKeys.insurance(customerId),
    queryFn: ({ signal }) => api<InsuranceDto[]>("/ext/dental/insurance", { signal, query: { customerId } }),
    ...HEALTH_CACHE,
  });
}

export type InsuranceInput = {
  carrier: string;
  memberId: string | null;
  groupNumber: string | null;
  subscriberName: string | null;
  subscriberRelationship: string | null;
  isPrimary: boolean;
  validTo: string | null;
};

export type SaveInsuranceInput = { id?: string; expectedVersion?: number; values: InsuranceInput };

export function useSaveInsurance(customerId: string): UseMutationResult<{ id: string; version: number }, ApiError, SaveInsuranceInput> {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; version: number }, ApiError, SaveInsuranceInput>({
    mutationFn: ({ id, expectedVersion, values }) =>
      id
        ? api(`/ext/dental/insurance/${seg(id)}`, { method: "PATCH", body: { ...values, expectedVersion } })
        : api("/ext/dental/insurance", { method: "POST", body: { ...values, customerId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: historyKeys.insurance(customerId) }),
  });
}

export function useDeleteInsurance(customerId: string): UseMutationResult<{ id: string }, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (id) => api(`/ext/dental/insurance/${seg(id)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: historyKeys.insurance(customerId) }),
  });
}

// ---- consent form mapping (admin picker) ----

export type ConsentFormMap = Record<string, string>;

export function useConsentForms(enabled: boolean): UseQueryResult<ConsentFormMap, ApiError> {
  return useQuery<ConsentFormMap, ApiError>({
    queryKey: historyKeys.consentForms(),
    queryFn: ({ signal }) => api<ConsentFormMap>("/ext/dental/alerts/consent/forms", { signal }),
    enabled,
    retry: false,
  });
}

export function useSaveConsentForms(): UseMutationResult<{ count: number }, ApiError, ConsentFormMap> {
  const queryClient = useQueryClient();
  return useMutation<{ count: number }, ApiError, ConsentFormMap>({
    mutationFn: (consentForms) => api("/ext/dental/alerts/consent/forms", { method: "PUT", body: { consentForms } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyKeys.consentForms() });
      await queryClient.invalidateQueries({ queryKey: ["dental", "consent"] });
    },
  });
}
