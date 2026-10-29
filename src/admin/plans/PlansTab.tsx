// Treatment plans of one patient (list, new plan, editor) and the patient's recall dates.

import { useState } from "react";
import { Plus } from "@appointit/ui/icons";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, StatusBadge } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatDate, useAdmin, useCustomer } from "@appointit/plugin-sdk/client";
import { PlanDialog, planMoney } from "./PlanDialog";
import { PLAN_TONE, RECALL_TONE } from "./tones";
import { usePlans, useRecalls, type PlanDto } from "./hooks";

export function PlansTab({ customerId }: { customerId: string }) {
  const t = useT();
  const { can, locations, currentLocationId } = useAdmin();
  const plans = usePlans(customerId);
  const customer = useCustomer(customerId, { enabled: can("customers.read") });
  const recalls = useRecalls({ customerId, limit: 20 }, can("bookings.read"));
  // null = closed, "new" = a new plan, otherwise the id of the plan being viewed.
  const [open, setOpen] = useState<string | null>(null);
  const timeZone = locations.find((l) => l.id === currentLocationId)?.timeZone ?? "UTC";
  const patientName = customer.data?.displayName ?? "";

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>{t("dental.planListTitle")}</CardTitle>
          {can("health.manage") ? (
            <Button type="button" size="sm" onClick={() => setOpen("new")}>
              <Plus aria-hidden="true" />
              {t("dental.planNew")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {plans.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : plans.isError ? (
            <p className="text-sm text-destructive">{plans.error.message}</p>
          ) : (plans.data?.length ?? 0) === 0 ? (
            <EmptyState title={t("dental.planEmptyTitle")} description={t("dental.planEmptyText")} />
          ) : (
            <ul className="grid gap-2">
              {plans.data?.map((plan) => (
                <PlanRow key={plan.id} plan={plan} timeZone={timeZone} onOpen={() => setOpen(plan.id)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {can("bookings.read") && (recalls.data?.rows.length ?? 0) > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("dental.recallPatientTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {recalls.data?.rows.map((r) => (
                <li key={`${r.ruleId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{r.ruleName}</span>
                  <span className="text-muted-foreground">{t("dental.recallDueOn", { date: formatDate(r.dueOn, timeZone) })}</span>
                  <StatusBadge tone={RECALL_TONE[r.status] ?? "neutral"}>{t(`dental.recallStatus_${r.status}`)}</StatusBadge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {open !== null ? <PlanDialog customerId={customerId} patientName={patientName} planId={open === "new" ? null : open} onClose={() => setOpen(null)} onCreated={setOpen} /> : null}
    </div>
  );
}

function PlanRow({ plan, timeZone, onOpen }: { plan: PlanDto; timeZone: string; onOpen: () => void }) {
  const t = useT();
  const active = plan.items.filter((i) => i.status !== "cancelled");
  const done = active.filter((i) => i.status === "done").length;
  const next = active.filter((i) => i.status === "booked" && i.bookingStart).map((i) => i.bookingStart as string).sort()[0];
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{plan.title}</span>
          <StatusBadge tone={PLAN_TONE[plan.status] ?? "neutral"}>{t(`dental.planStatus_${plan.status}`)}</StatusBadge>
          <span className="ml-auto text-sm font-semibold">{planMoney(plan.estimateMinor, plan.currency)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span>{t("dental.planVisitsProgress", { done, total: active.length })}</span>
          {next ? <span>{t("dental.planNextVisit", { date: formatDate(next, timeZone) })}</span> : null}
          {plan.acceptedAt ? <Badge variant="outline">{t("dental.planAcceptedOn", { date: formatDate(plan.acceptedAt, timeZone) })}</Badge> : null}
        </span>
      </button>
    </li>
  );
}
