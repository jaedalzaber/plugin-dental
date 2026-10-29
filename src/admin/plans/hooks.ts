// Data hooks of the dental plans and recall screens (/api/v1/ext/dental/plans, /api/v1/ext/dental/recall).

import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type {
  PlanDto,
  PlanOptions,
  PlanSchedule,
  RecallDto,
  RecallRuleDto,
} from "../../server";
import { api, type ApiError } from "@appointit/plugin-sdk/client";

export type {
  PlanDto,
  PlanItemDto,
  PlanOptions,
  PlanSchedule,
  ProcedureOption,
  RecallDto,
  RecallRuleDto,
  ScheduleVisit,
} from "../../server";

const PLANS = ["dental-plans"] as const;
const RECALL = ["dental-recall"] as const;

// ---- Plans --------------------------------------------------------------------------------------------------------

export function usePlans(customerId: string) {
  return useQuery<PlanDto[], ApiError>({
    queryKey: [...PLANS, "list", customerId],
    queryFn: ({ signal }) => api<PlanDto[]>("/ext/dental/plans", { query: { customerId }, signal }),
  });
}

export function usePlanOptions(enabled = true) {
  return useQuery<PlanOptions, ApiError>({
    queryKey: [...PLANS, "options"],
    enabled,
    queryFn: ({ signal }) => api<PlanOptions>("/ext/dental/plans/options", { signal }),
  });
}

export interface PlanItemInput {
  id?: string;
  procedureId: string | null;
  tooth: string | null;
  surfaces: string[];
  priceMinor: number;
  minGapDays: number;
  maxGapDays: number | null;
}

export interface SavePlanInput {
  /** Set to change a plan, leave out to create one. */
  planId?: string;
  expectedVersion?: number;
  customerId: string;
  title: string;
  insuranceEstimateMinor: number;
  notes: string | null;
  /** Left out when the items cannot be changed any more. */
  items?: PlanItemInput[];
}

export function useSavePlan() {
  const queryClient = useQueryClient();
  return useMutation<PlanDto, ApiError, SavePlanInput>({
    mutationFn: ({ planId, customerId, ...rest }) =>
      planId
        ? api<PlanDto>(`/ext/dental/plans/${encodeURIComponent(planId)}`, { method: "PATCH", body: rest })
        : api<PlanDto>("/ext/dental/plans", { method: "POST", body: { customerId, ...rest } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLANS }),
  });
}

export type PlanAction = "propose" | "accept" | "cancel";

export interface PlanActionInput {
  planId: string;
  expectedVersion: number;
  action: PlanAction;
  signerName?: string;
  signatureDataUrl?: string;
  strokes?: number[][][];
}

export function usePlanAction() {
  const queryClient = useQueryClient();
  return useMutation<PlanDto, ApiError, PlanActionInput>({
    mutationFn: ({ planId, action, ...body }) => api<PlanDto>(`/ext/dental/plans/${encodeURIComponent(planId)}/${action}`, { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLANS }),
  });
}

export function useFindPlanTimes() {
  return useMutation<PlanSchedule, ApiError, { planId: string; locationId: string; from?: string }>({
    mutationFn: ({ planId, ...body }) => api<PlanSchedule>(`/ext/dental/plans/${encodeURIComponent(planId)}/find-times`, { method: "POST", body, idempotent: false }),
  });
}

export interface BookPlanInput {
  planId: string;
  expectedVersion: number;
  locationId: string;
  visits: { itemId: string; start: string }[];
  allowLateGaps?: boolean;
}

export function useBookPlan() {
  const queryClient = useQueryClient();
  return useMutation<{ plan: PlanDto }, ApiError, BookPlanInput>({
    mutationFn: ({ planId, ...body }) => api<{ plan: PlanDto }>(`/ext/dental/plans/${encodeURIComponent(planId)}/book`, { method: "POST", body }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PLANS }),
        queryClient.invalidateQueries({ queryKey: RECALL }),
        queryClient.invalidateQueries({ queryKey: ["bookings"] }),
      ]);
    },
  });
}

// ---- Recall -------------------------------------------------------------------------------------------------------------

export interface RecallListArgs {
  status?: string[];
  dueFrom?: string | null;
  dueTo?: string | null;
  customerId?: string;
  limit?: number;
  offset?: number;
}

export function useRecalls(args: RecallListArgs, enabled = true) {
  return useQuery<{ rows: RecallDto[]; hasMore: boolean }, ApiError>({
    queryKey: [...RECALL, "list", args],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api<{ rows: RecallDto[]; hasMore: boolean }>("/ext/dental/recall", {
        query: { status: args.status, dueFrom: args.dueFrom, dueTo: args.dueTo, customerId: args.customerId, limit: args.limit, offset: args.offset },
        signal,
      }),
  });
}

export function useRecallRules() {
  return useQuery<RecallRuleDto[], ApiError>({
    queryKey: [...RECALL, "rules"],
    queryFn: ({ signal }) => api<RecallRuleDto[]>("/ext/dental/recall/rules", { signal }),
  });
}

export interface SaveRuleInput {
  id?: string;
  expectedVersion?: number;
  name: string;
  serviceId: string;
  intervalMonths: number;
  leadDays: number;
  active: boolean;
}

export function useSaveRecallRule() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; version: number }, ApiError, SaveRuleInput>({
    mutationFn: ({ id, ...body }) =>
      id ? api(`/ext/dental/recall/rules/${encodeURIComponent(id)}`, { method: "PATCH", body }) : api("/ext/dental/recall/rules", { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: RECALL }),
  });
}

export function useRemindRecall() {
  const queryClient = useQueryClient();
  return useMutation<{ messages: number }, ApiError, { customerId: string; ruleId: string }>({
    mutationFn: (body) => api("/ext/dental/recall/remind", { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: RECALL }),
  });
}

export function useSnoozeRecall() {
  const queryClient = useQueryClient();
  return useMutation<{ dueOn: string }, ApiError, { customerId: string; ruleId: string; days: 30 | 60 | 90 }>({
    mutationFn: (body) => api("/ext/dental/recall/snooze", { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: RECALL }),
  });
}
