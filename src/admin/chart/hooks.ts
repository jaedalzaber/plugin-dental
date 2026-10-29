
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChartEntryDto,
  ChartHistoryItem,
  ConditionKey,
  EntryKind,
  EntryStatus,
  ProcedureDto,
  ToothNumbering,
} from "../../server/chart/model";
import { DENTAL_PLUGIN_ID } from "../../server/chart/model";
import { api, type ApiError } from "@appointit/plugin-sdk/client";

export type { ChartEntryDto, ChartHistoryItem, ProcedureDto, ToothNumbering } from "../../server/chart/model";

export type ChartData = { entries: ChartEntryDto[]; toothNumbering: ToothNumbering };

const chartKey = (customerId: string) => ["dental", "chart", customerId] as const;
const procedureKey = ["dental", "procedures"] as const;

/**
 * The patient's chart. Every read is written to the audit log, so it does not refetch on window focus:
 * it refreshes after a change made here or when the user reopens the tab.
 */
export function useChart(customerId: string) {
  return useQuery<ChartData, ApiError>({
    queryKey: chartKey(customerId),
    queryFn: ({ signal }) => api<ChartData>(`/ext/dental/chart/${encodeURIComponent(customerId)}`, { signal }),
    refetchOnWindowFocus: false,
  });
}

/** History of one tooth, loaded only while `enabled` (the read is audited). */
export function useToothHistory(customerId: string, tooth: string | null, enabled: boolean) {
  return useQuery<ChartHistoryItem[], ApiError>({
    queryKey: [...chartKey(customerId), "history", tooth],
    enabled: enabled && tooth !== null,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api<ChartHistoryItem[]>(`/ext/dental/chart/${encodeURIComponent(customerId)}/history`, { query: { tooth }, signal }),
  });
}

/** Active procedures of the clinic's catalog (archived ones too with includeArchived, for catalog managers). */
export function useProcedures(includeArchived = false) {
  return useQuery<ProcedureDto[], ApiError>({
    queryKey: [...procedureKey, includeArchived],
    queryFn: ({ signal }) => api<ProcedureDto[]>("/ext/dental/procedures", { query: { includeArchived: includeArchived ? true : undefined }, signal }),
  });
}

export type AddEntryInput = {
  tooth: string;
  surfaces: string[];
  kind: EntryKind;
  condition?: ConditionKey | null;
  procedureId?: string | null;
  notes?: string | null;
};

export function useAddEntry(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<ChartEntryDto, ApiError, AddEntryInput>({
    mutationFn: (body) => api<ChartEntryDto>(`/ext/dental/chart/${encodeURIComponent(customerId)}`, { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: chartKey(customerId) }),
  });
}

export type UpdateEntryInput = {
  id: string;
  expectedVersion: number;
  status?: EntryStatus;
  surfaces?: string[];
  condition?: ConditionKey | null;
  procedureId?: string | null;
  notes?: string | null;
};

export function useUpdateEntry(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<ChartEntryDto, ApiError, UpdateEntryInput>({
    mutationFn: ({ id, ...body }) => api<ChartEntryDto>(`/ext/dental/chart/entries/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: chartKey(customerId) }),
  });
}

type PluginRow = { pluginId: string; settings: Record<string, unknown>; version: number };

/** Saves the clinic's tooth numbering as the plugin setting (needs plugins.manage). */
export function useSaveNumbering(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiError, ToothNumbering>({
    mutationFn: async (toothNumbering) => {
      const rows = await api<PluginRow[]>("/plugins");
      const row = rows.find((r) => r.pluginId === DENTAL_PLUGIN_ID);
      return api(`/plugins/${encodeURIComponent(DENTAL_PLUGIN_ID)}`, {
        method: "PUT",
        body: { settings: { ...(row?.settings ?? {}), toothNumbering }, expectedVersion: row?.version ?? 0 },
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: chartKey(customerId) }),
  });
}

export type ProcedureInput = {
  code?: string | null;
  name?: string;
  category?: string | null;
  defaultPriceMinor?: number | null;
  currency?: string | null;
  serviceId?: string | null;
  active?: boolean;
};

function useInvalidateProcedures() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: procedureKey });
}

export function useCreateProcedure() {
  const invalidate = useInvalidateProcedures();
  return useMutation<ProcedureDto, ApiError, ProcedureInput & { name: string }>({
    mutationFn: (body) => api<ProcedureDto>("/ext/dental/procedures", { method: "POST", body }),
    onSettled: invalidate,
  });
}

export function useUpdateProcedure() {
  const invalidate = useInvalidateProcedures();
  return useMutation<ProcedureDto, ApiError, ProcedureInput & { id: string; expectedVersion: number }>({
    mutationFn: ({ id, ...body }) => api<ProcedureDto>(`/ext/dental/procedures/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSettled: invalidate,
  });
}

export function useReorderProcedures() {
  const invalidate = useInvalidateProcedures();
  return useMutation<{ ids: string[] }, ApiError, string[]>({
    mutationFn: (ids) => api<{ ids: string[] }>("/ext/dental/procedures/reorder", { method: "POST", body: { ids } }),
    onSettled: invalidate,
  });
}
