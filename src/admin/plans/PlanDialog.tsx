// The plan editor: title, treatments in order (procedure, tooth, surfaces, price, gaps), estimate and insurance, notes,
// and the status actions (propose, accept, find times and book, cancel).

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarPlus, Download, Plus, Trash2 } from "@appointit/ui/icons";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
  toast,
  type SelectOption,
} from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { formatMoney, useAdmin } from "@appointit/plugin-sdk/client";
import { AcceptDialog } from "./AcceptDialog";
import { ScheduleDialog } from "./ScheduleDialog";
import { minorToText, textToMinor } from "./money";
import { PLAN_TONE } from "./tones";
import { usePlanAction, usePlanOptions, usePlans, useSavePlan, type PlanDto, type PlanItemInput, type ProcedureOption } from "./hooks";

export function planMoney(minor: number, currency: string | null): string {
  return currency ? formatMoney(minor, currency) : minorToText(minor, null);
}

interface ItemDraft {
  key: string;
  id: string | undefined;
  procedureId: string;
  tooth: string;
  surfaces: string;
  price: string;
  minGap: string;
  maxGap: string;
  /** Booked or done visits keep their place and cannot be edited. */
  locked: boolean;
}

let counter = 0;
const nextKey = (): string => `item-${++counter}`;

function draftOf(plan: PlanDto | null, currency: string | null): ItemDraft[] {
  if (!plan) return [];
  return plan.items
    .filter((i) => i.status !== "cancelled")
    .map((i) => ({
      key: nextKey(),
      id: i.id,
      procedureId: i.procedureId ?? "",
      tooth: i.tooth ?? "",
      surfaces: i.surfaces.join(""),
      price: minorToText(i.priceMinor, currency),
      minGap: String(i.minGapDays),
      maxGap: i.maxGapDays === null ? "" : String(i.maxGapDays),
      locked: i.status !== "planned",
    }));
}

const emptyItem = (): ItemDraft => ({ key: nextKey(), id: undefined, procedureId: "", tooth: "", surfaces: "", price: "", minGap: "0", maxGap: "", locked: false });

export function PlanDialog({ customerId, patientName, planId, onClose, onCreated }: { customerId: string; patientName: string; planId: string | null; onClose: () => void; onCreated: (planId: string) => void }) {
  const { can } = useAdmin();
  const plans = usePlans(customerId);
  const options = usePlanOptions();
  const plan = planId ? (plans.data?.find((p) => p.id === planId) ?? null) : null;
  // The form starts from the stored plan once; saving brings the stored plan back and the form keeps the user's text.
  if (planId && !plan) return plans.isFetching ? null : <MissingPlan onClose={onClose} />;
  return <PlanForm key={plan?.id ?? "new"} customerId={customerId} patientName={patientName} plan={plan} procedures={options.data?.procedures ?? []} defaultCurrency={options.data?.currency ?? null} canManage={can("health.manage")} canBook={can("bookings.create")} onClose={onClose} onCreated={onCreated} />;
}

function MissingPlan({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dental.planMissing")}</DialogTitle>
          <DialogDescription>{t("dental.planMissingText")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  customerId: string;
  patientName: string;
  plan: PlanDto | null;
  procedures: ProcedureOption[];
  defaultCurrency: string | null;
  canManage: boolean;
  canBook: boolean;
  onClose: () => void;
  onCreated: (planId: string) => void;
}

function PlanForm({ customerId, patientName, plan, procedures, defaultCurrency, canManage, canBook, onClose, onCreated }: FormProps) {
  const t = useT();
  const save = useSavePlan();
  const action = usePlanAction();
  const currency = plan?.currency ?? defaultCurrency;
  const [title, setTitle] = useState(plan?.title ?? "");
  const [items, setItems] = useState<ItemDraft[]>(() => (plan ? draftOf(plan, currency) : [emptyItem()]));
  const [insurance, setInsurance] = useState(minorToText(plan?.insuranceEstimateMinor ?? 0, currency));
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const status = plan?.status ?? "draft";
  const itemsEditable = canManage && (status === "draft" || status === "proposed");
  const open = status !== "completed" && status !== "cancelled";
  const editable = canManage && open;
  const procedureById = useMemo(() => new Map(procedures.map((p) => [p.id, p])), [procedures]);
  const procedureOptions = useMemo<SelectOption[]>(
    () =>
      procedures.map((p) => ({
        value: p.id,
        label: p.code ? `${p.code} · ${p.name}` : p.name,
        description: p.serviceName ?? t("dental.planNoServiceShort"),
      })),
    [procedures, t],
  );

  const total = items.reduce((sum, i) => sum + (textToMinor(i.price, currency) ?? 0), 0);
  const insuranceMinor = textToMinor(insurance, currency) ?? 0;

  function change(key: string, patch: Partial<ItemDraft>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function choose(key: string, procedureId: string) {
    const procedure = procedureById.get(procedureId);
    change(key, { procedureId, ...(procedure?.defaultPriceMinor != null && { price: minorToText(procedure.defaultPriceMinor, currency) }) });
  }

  function move(index: number, by: -1 | 1) {
    setItems((list) => {
      const to = index + by;
      const a = list[index];
      const b = list[to];
      if (!a || !b || a.locked || b.locked) return list;
      const copy = [...list];
      copy[index] = b;
      copy[to] = a;
      return copy;
    });
  }

  /** The items as the server wants them, or an error text. */
  function itemsPayload(): PlanItemInput[] | string {
    const out: PlanItemInput[] = [];
    for (const [index, item] of items.entries()) {
      const where = t("dental.planRowLabel", { n: index + 1 });
      if (item.procedureId === "") return `${where}: ${t("dental.planChooseProcedure")}`;
      const price = textToMinor(item.price, currency);
      if (price === null) return `${where}: ${t("dental.planBadPrice")}`;
      const minGap = Number(item.minGap === "" ? "0" : item.minGap);
      const maxGap = item.maxGap.trim() === "" ? null : Number(item.maxGap);
      if (!Number.isInteger(minGap) || minGap < 0 || (maxGap !== null && (!Number.isInteger(maxGap) || maxGap < minGap))) return `${where}: ${t("dental.planBadGap")}`;
      const surfaces = item.surfaces.toUpperCase().replace(/[^A-Z]/g, "").split("").slice(0, 6);
      out.push({ ...(item.id && { id: item.id }), procedureId: item.procedureId, tooth: item.tooth.trim() === "" ? null : item.tooth.trim(), surfaces, priceMinor: price, minGapDays: minGap, maxGapDays: maxGap });
    }
    return out;
  }

  /** Saves the form and returns the stored plan; null when something is wrong (the message is shown). */
  async function persist(): Promise<PlanDto | null> {
    if (title.trim() === "") {
      setError(t("dental.planNeedTitle"));
      return null;
    }
    const payload = itemsEditable ? itemsPayload() : undefined;
    if (typeof payload === "string") {
      setError(payload);
      return null;
    }
    const insuranceValue = textToMinor(insurance, currency);
    if (insuranceValue === null) {
      setError(t("dental.planBadPrice"));
      return null;
    }
    setError(null);
    try {
      return await save.mutateAsync({
        ...(plan && { planId: plan.id, expectedVersion: plan.version }),
        customerId,
        title: title.trim(),
        insuranceEstimateMinor: insuranceValue,
        notes: notes.trim() === "" ? null : notes,
        ...(payload && { items: payload }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dental.planSaveFailed"));
      return null;
    }
  }

  async function onSave() {
    const stored = await persist();
    if (!stored) return;
    toast.success(t("dental.planSaved"));
    // A new plan stays open (now stored), so it can be proposed right away.
    if (!plan) onCreated(stored.id);
  }

  async function onPropose() {
    const stored = await persist();
    if (!stored) return;
    try {
      await action.mutateAsync({ planId: stored.id, expectedVersion: stored.version, action: "propose" });
      toast.success(t("dental.planProposed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dental.planSaveFailed"));
    }
  }

  async function onCancelPlan() {
    if (!plan) return;
    try {
      await action.mutateAsync({ planId: plan.id, expectedVersion: plan.version, action: "cancel" });
      toast.success(t("dental.planCancelled"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dental.planSaveFailed"));
      throw err;
    }
  }

  const busy = save.isPending || action.isPending;
  const dirtyHint = plan !== null && status === "proposed" && itemsEditable;

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-4xl sm:max-w-4xl" aria-describedby="plan-description">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {plan ? plan.title : t("dental.planNew")}
              {plan ? <StatusBadge tone={PLAN_TONE[status] ?? "neutral"}>{t(`dental.planStatus_${status}`)}</StatusBadge> : null}
            </DialogTitle>
            <DialogDescription id="plan-description">{t("dental.planEditorText", { name: patientName || "-" })}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <FormField label={t("dental.planTitleLabel")} htmlFor="plan-title" required>
              <Input id="plan-title" value={title} maxLength={200} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
            </FormField>

            <div className="grid gap-2">
              <p className="text-sm font-medium">{t("dental.planItems")}</p>
              {items.length === 0 ? <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{t("dental.planNoItems")}</p> : null}
              {items.map((item, index) => {
                const procedure = procedureById.get(item.procedureId);
                const disabled = !itemsEditable || item.locked;
                return (
                  <div key={item.key} className="grid gap-3 rounded-lg border p-3 md:grid-cols-12">
                    <div className="flex items-center gap-2 md:col-span-12">
                      <span className="text-[13px] font-medium text-muted-foreground">{t("dental.planRowLabel", { n: index + 1 })}</span>
                      {item.locked ? <StatusBadge tone="info">{t("dental.planItemBooked")}</StatusBadge> : null}
                      <span className="ml-auto flex items-center gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("dental.planMoveUp")} disabled={disabled || index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("dental.planMoveDown")} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("dental.planRemoveRow")} disabled={disabled} onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>
                          <Trash2 />
                        </Button>
                      </span>
                    </div>
                    <FormField label={t("dental.planProcedure")} htmlFor={`${item.key}-procedure`} className="md:col-span-5">
                      <Select id={`${item.key}-procedure`} options={procedureOptions} value={item.procedureId} disabled={disabled} placeholder={t("dental.planChooseProcedure")} onChange={(value) => choose(item.key, value)} />
                    </FormField>
                    <FormField label={t("dental.planTooth")} htmlFor={`${item.key}-tooth`} className="md:col-span-2">
                      <Input id={`${item.key}-tooth`} value={item.tooth} maxLength={10} disabled={disabled} placeholder="16" onChange={(e) => change(item.key, { tooth: e.target.value })} />
                    </FormField>
                    <FormField label={t("dental.planSurfaces")} htmlFor={`${item.key}-surfaces`} className="md:col-span-2">
                      <Input id={`${item.key}-surfaces`} value={item.surfaces} maxLength={6} disabled={disabled} placeholder="MOD" onChange={(e) => change(item.key, { surfaces: e.target.value })} />
                    </FormField>
                    <FormField label={t("dental.planPrice", { currency: currency ?? "" })} htmlFor={`${item.key}-price`} className="md:col-span-3">
                      <Input id={`${item.key}-price`} inputMode="decimal" value={item.price} disabled={disabled} onChange={(e) => change(item.key, { price: e.target.value })} />
                    </FormField>
                    <FormField label={t("dental.planMinGap")} htmlFor={`${item.key}-min`} className="md:col-span-3">
                      <Input id={`${item.key}-min`} inputMode="numeric" value={item.minGap} disabled={disabled} onChange={(e) => change(item.key, { minGap: e.target.value })} />
                    </FormField>
                    <FormField label={t("dental.planMaxGap")} htmlFor={`${item.key}-max`} className="md:col-span-3">
                      <Input id={`${item.key}-max`} inputMode="numeric" value={item.maxGap} disabled={disabled} placeholder={t("dental.planNoLimit")} onChange={(e) => change(item.key, { maxGap: e.target.value })} />
                    </FormField>
                    {procedure && !procedure.serviceId ? <p className="text-[13px] text-warning md:col-span-12">{t("dental.planNoService")}</p> : null}
                  </div>
                );
              })}
              {itemsEditable ? (
                <Button type="button" variant="outline" className="w-fit" onClick={() => setItems((list) => [...list, emptyItem()])}>
                  <Plus aria-hidden="true" />
                  {t("dental.planAddItem")}
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label={t("dental.planEstimate")}>
                <p className="flex h-9 items-center text-sm font-semibold">{planMoney(total, currency)}</p>
              </FormField>
              <FormField label={t("dental.planInsurance", { currency: currency ?? "" })} htmlFor="plan-insurance" description={t("dental.planInsuranceHelp")}>
                <Input id="plan-insurance" inputMode="decimal" value={insurance} disabled={!editable} onChange={(e) => setInsurance(e.target.value)} />
              </FormField>
              <FormField label={t("dental.planPatientShare")}>
                <p className="flex h-9 items-center text-sm font-semibold">{planMoney(Math.max(0, total - insuranceMinor), currency)}</p>
              </FormField>
            </div>

            <FormField label={t("dental.planNotes")} htmlFor="plan-notes" description={t("dental.planNotesHelp")}>
              <Textarea id="plan-notes" rows={3} maxLength={5000} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
            </FormField>

            {dirtyHint ? <p className="text-[13px] text-muted-foreground">{t("dental.planEditRevertsNote")}</p> : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="flex-wrap">
            {plan?.acceptanceUrl ? (
              <Button type="button" variant="outline" asChild>
                <a href={plan.acceptanceUrl} target="_blank" rel="noreferrer">
                  <Download aria-hidden="true" />
                  {t("dental.planAcceptancePdf")}
                </a>
              </Button>
            ) : null}
            {plan && open && canManage ? (
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setCancelling(true)}>
                {t("dental.planCancelPlan")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
            {editable ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void onSave()}>
                {t("common.save")}
              </Button>
            ) : null}
            {canManage && plan && status === "draft" ? (
              <Button type="button" disabled={busy} onClick={() => void onPropose()}>
                {t("dental.planPropose")}
              </Button>
            ) : null}
            {canManage && plan && status === "proposed" ? (
              <Button type="button" disabled={busy} onClick={() => setAccepting(true)}>
                {t("dental.planAccept")}
              </Button>
            ) : null}
            {canBook && plan && (status === "accepted" || status === "in_progress") && plan.items.some((i) => i.status === "planned") ? (
              <Button type="button" disabled={busy} onClick={() => setScheduling(true)}>
                <CalendarPlus aria-hidden="true" />
                {t("dental.planFindTimes")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {accepting && plan ? <AcceptDialog plan={plan} patientName={patientName} onClose={() => setAccepting(false)} /> : null}
      {scheduling && plan ? <ScheduleDialog plan={plan} onClose={() => setScheduling(false)} /> : null}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        destructive
        title={t("dental.planCancelTitle")}
        description={t("dental.planCancelText")}
        confirmLabel={t("dental.planCancelConfirm")}
        onConfirm={onCancelPlan}
      />
    </>
  );
}
