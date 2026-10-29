// Alert flags, history review dates and consent state for lists (calendar blocks, the booking panel). Alert requests are batched: every
// badge that mounts within a short moment asks for its patient, and one GET /ext/dental/alerts answers all of them.

import { useQuery } from "@tanstack/react-query";
import type { AlertSummary, ConsentStatus } from "../../server";
import { api, useAdmin, type ApiError } from "@appointit/plugin-sdk/client";

export type { AlertSummary, ConsentStatus };

export const dentalKeys = {
  alerts: () => ["dental", "alerts"] as const,
  alert: (customerId: string | null | undefined) => ["dental", "alerts", customerId] as const,
  consent: (bookingId: string | null | undefined) => ["dental", "consent", bookingId] as const,
};

const BATCH_DELAY_MS = 25;
const BATCH_SIZE = 100;

type Waiter = { resolve: (row: AlertSummary) => void; reject: (error: unknown) => void };

let queue = new Map<string, Waiter[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  const batch = queue;
  queue = new Map();
  timer = null;
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    api<AlertSummary[]>("/ext/dental/alerts", { query: { customerIds: chunk } }).then(
      (rows) => {
        const byId = new Map(rows.map((row) => [row.customerId, row]));
        for (const id of chunk) {
          const row = byId.get(id) ?? { customerId: id, hasAlerts: false, historyMissing: true, reviewDueAt: null };
          for (const waiter of batch.get(id) ?? []) waiter.resolve(row);
        }
      },
      (error: unknown) => {
        for (const id of chunk) for (const waiter of batch.get(id) ?? []) waiter.reject(error);
      },
    );
  }
}

function loadAlert(customerId: string): Promise<AlertSummary> {
  return new Promise((resolve, reject) => {
    const waiters = queue.get(customerId) ?? [];
    waiters.push({ resolve, reject });
    queue.set(customerId, waiters);
    timer ??= setTimeout(flush, BATCH_DELAY_MS);
  });
}

/** Alert flag (and labels, when the member may read health data) of one patient; batched with the others on screen. */
export function useAlert(customerId: string | null | undefined) {
  const { can } = useAdmin();
  return useQuery<AlertSummary, ApiError>({
    queryKey: dentalKeys.alert(customerId),
    queryFn: () => loadAlert(customerId as string),
    enabled: Boolean(customerId) && can("bookings.read"),
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Whether the booking still needs a signed consent form. Needs bookings.read. */
export function useConsentStatus(bookingId: string | null | undefined) {
  const { can } = useAdmin();
  return useQuery<ConsentStatus, ApiError>({
    queryKey: dentalKeys.consent(bookingId),
    queryFn: ({ signal }) => api<ConsentStatus>("/ext/dental/alerts/consent", { signal, query: { bookingId } }),
    enabled: Boolean(bookingId) && can("bookings.read"),
    staleTime: 30_000,
    retry: false,
  });
}
