// /admin/ext/dental/recall: patients who are due for a regular visit. Filters, reminders, snooze, and one click to book.

import { useState } from "react";
import { Bell, CalendarPlus, Clock, Settings } from "@appointit/ui/icons";
import {
  Button,
  DataTable,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  PageHeader,
  Select,
  StatusBadge,
  toast,
  type DataTableColumn,
  type SelectOption,
} from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { NewBookingDialog, formatDate, useAdmin, useNavigate } from "@appointit/plugin-sdk/client";
import { useRecalls, useRemindRecall, useSnoozeRecall, type RecallDto } from "../hooks";
import { RECALL_TONE } from "../tones";
import { RulesDialog } from "./RulesDialog";

const PAGE = 50;
const ATTENTION = "attention";
const ALL = "all";
const SNOOZE_DAYS = [30, 60, 90] as const;

export function RecallScreen() {
  const t = useT();
  const { can, locations, currentLocationId } = useAdmin();
  const go = useNavigate();
  const timeZone = locations.find((l) => l.id === currentLocationId)?.timeZone ?? "UTC";
  const [filter, setFilter] = useState<string>(ATTENTION);
  const [dueFrom, setDueFrom] = useState<string | null>(null);
  const [dueTo, setDueTo] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [rules, setRules] = useState(false);
  const [booking, setBooking] = useState<RecallDto | null>(null);
  const remind = useRemindRecall();
  const snooze = useSnoozeRecall();

  const status = filter === ALL ? undefined : filter === ATTENTION ? ["due", "reminded"] : [filter];
  const recalls = useRecalls({ ...(status && { status }), dueFrom, dueTo, limit: PAGE, offset });
  const canAct = can("bookings.create");

  const filterOptions: SelectOption[] = [
    { value: ATTENTION, label: t("dental.recallFilterAttention") },
    { value: ALL, label: t("dental.recallFilterAll") },
    ...["upcoming", "due", "reminded", "scheduled", "snoozed", "done"].map((s) => ({ value: s, label: t(`dental.recallStatus_${s}`) })),
  ];

  function reset<T>(set: (value: T) => void) {
    return (value: T) => {
      setOffset(0);
      set(value);
    };
  }

  async function sendNow(row: RecallDto) {
    try {
      const result = await remind.mutateAsync({ customerId: row.customerId, ruleId: row.ruleId });
      toast.success(t("dental.recallReminderSent", { count: result.messages }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dental.recallActionFailed"));
    }
  }

  async function snoozeFor(row: RecallDto, days: 30 | 60 | 90) {
    try {
      await snooze.mutateAsync({ customerId: row.customerId, ruleId: row.ruleId, days });
      toast.success(t("dental.recallSnoozed", { days }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("dental.recallActionFailed"));
    }
  }

  const columns: DataTableColumn<RecallDto>[] = [
    {
      key: "patient",
      header: t("dental.recallColPatient"),
      cell: (row) => (
        <a
          href={`/admin/customers/${row.customerId}`}
          className="font-medium hover:underline"
          onClick={(event) => {
            // plain click: navigate inside the app (no page reload); modified clicks keep the browser default
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            go(`/admin/customers/${row.customerId}`);
          }}
        >
          {row.customerName}
        </a>
      ),
    },
    { key: "rule", header: t("dental.recallColRule"), cell: (row) => row.ruleName },
    { key: "due", header: t("dental.recallColDue"), className: "w-36", cell: (row) => formatDate(row.dueOn, timeZone) },
    { key: "last", header: t("dental.recallColLastVisit"), className: "w-36", cell: (row) => (row.lastVisitAt ? formatDate(row.lastVisitAt, timeZone) : <span className="text-muted-foreground">-</span>) },
    {
      key: "status",
      header: t("dental.recallColStatus"),
      className: "w-36",
      cell: (row) => <StatusBadge tone={RECALL_TONE[row.status] ?? "neutral"}>{t(`dental.recallStatus_${row.status}`)}</StatusBadge>,
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("dental.recallColActions")}</span>,
      className: "w-64",
      cell: (row) =>
        canAct && row.status !== "scheduled" && row.status !== "done" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" disabled={remind.isPending} onClick={() => void sendNow(row)}>
              <Bell aria-hidden="true" />
              {t("dental.recallRemindNow")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={snooze.isPending}>
                  <Clock aria-hidden="true" />
                  {t("dental.recallSnooze")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SNOOZE_DAYS.map((days) => (
                  <DropdownMenuItem key={days} onSelect={() => void snoozeFor(row, days)}>
                    {t("dental.recallSnoozeDays", { days })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" onClick={() => setBooking(row)}>
              <CalendarPlus aria-hidden="true" />
              {t("dental.recallBook")}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={t("dental.recallTitle")}
        description={t("dental.recallDescription")}
        actions={
          <Button type="button" variant="outline" onClick={() => setRules(true)}>
            <Settings aria-hidden="true" />
            {t("dental.recallRules")}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label={t("dental.recallFilterStatus")} htmlFor="recall-status" className="w-56">
          <Select id="recall-status" options={filterOptions} value={filter} searchable={false} onChange={reset(setFilter)} />
        </FormField>
        <FormField label={t("dental.recallFilterFrom")} htmlFor="recall-from" className="w-48">
          <DatePicker id="recall-from" value={dueFrom} onChange={reset(setDueFrom)} clearable />
        </FormField>
        <FormField label={t("dental.recallFilterTo")} htmlFor="recall-to" className="w-48">
          <DatePicker id="recall-to" value={dueTo} onChange={reset(setDueTo)} clearable />
        </FormField>
      </div>

      {recalls.isError ? (
        <EmptyState
          title={t("dental.recallLoadFailed")}
          description={recalls.error.message}
          action={
            <Button variant="outline" onClick={() => void recalls.refetch()}>
              {t("common.tryAgain")}
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={recalls.data?.rows ?? []}
          loading={recalls.isLoading}
          getRowId={(row) => `${row.customerId}:${row.ruleId}`}
          columns={columns}
          empty={<EmptyState title={t("dental.recallEmptyTitle")} description={t("dental.recallEmptyText")} />}
        />
      )}

      {offset > 0 || recalls.data?.hasMore ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            {t("dental.recallPrevious")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!recalls.data?.hasMore} onClick={() => setOffset(offset + PAGE)}>
            {t("dental.recallNext")}
          </Button>
        </div>
      ) : null}

      {rules ? <RulesDialog canManage={can("services.manage")} onClose={() => setRules(false)} /> : null}
      <NewBookingDialog
        open={booking !== null}
        onOpenChange={(open) => !open && setBooking(null)}
        defaults={booking ? { customerId: booking.customerId, serviceId: booking.serviceId } : undefined}
      />
    </div>
  );
}
