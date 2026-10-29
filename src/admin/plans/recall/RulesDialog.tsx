// Recall rules: a service, how many months until the next visit, and how many days before that to remind the patient.

import { useState } from "react";
import { Pencil, Plus } from "@appointit/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  toast,
} from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { useServices } from "@appointit/plugin-sdk/client";
import { useRecallRules, useSaveRecallRule, type RecallRuleDto } from "../hooks";

interface Draft {
  id: string | undefined;
  expectedVersion: number | undefined;
  name: string;
  serviceId: string;
  intervalMonths: string;
  leadDays: string;
  active: boolean;
}

const blank = (): Draft => ({ id: undefined, expectedVersion: undefined, name: "", serviceId: "", intervalMonths: "6", leadDays: "14", active: true });

export function RulesDialog({ canManage, onClose }: { canManage: boolean; onClose: () => void }) {
  const t = useT();
  const rules = useRecallRules();
  const services = useServices({ status: "active" }, { enabled: canManage });
  const save = useSaveRecallRule();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  function edit(rule: RecallRuleDto) {
    setError(null);
    setDraft({ id: rule.id, expectedVersion: rule.version, name: rule.name, serviceId: rule.serviceId, intervalMonths: String(rule.intervalMonths), leadDays: String(rule.leadDays), active: rule.active });
  }

  async function submit() {
    if (!draft) return;
    const months = Number(draft.intervalMonths);
    const lead = Number(draft.leadDays);
    if (draft.name.trim() === "") return setError(t("dental.recallRuleNeedName"));
    if (draft.serviceId === "") return setError(t("dental.recallRuleNeedService"));
    if (!Number.isInteger(months) || months < 1 || months > 60) return setError(t("dental.recallRuleBadMonths"));
    if (!Number.isInteger(lead) || lead < 0 || lead > 365) return setError(t("dental.recallRuleBadLead"));
    setError(null);
    try {
      await save.mutateAsync({
        ...(draft.id && { id: draft.id }),
        ...(draft.expectedVersion !== undefined && { expectedVersion: draft.expectedVersion }),
        name: draft.name.trim(),
        serviceId: draft.serviceId,
        intervalMonths: months,
        leadDays: lead,
        active: draft.active,
      });
      toast.success(t("dental.recallRuleSaved"));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dental.recallActionFailed"));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dental.recallRules")}</DialogTitle>
          <DialogDescription>{t("dental.recallRulesText")}</DialogDescription>
        </DialogHeader>

        {rules.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (rules.data?.length ?? 0) === 0 && !draft ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("dental.recallRulesEmpty")}</p>
        ) : (
          <ul className="grid gap-2">
            {rules.data?.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{rule.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {t("dental.recallRuleSummary", { service: rule.serviceName ?? "-", months: rule.intervalMonths, days: rule.leadDays })}
                  </span>
                </span>
                {!rule.active ? <StatusBadge tone="neutral">{t("dental.recallRuleInactive")}</StatusBadge> : null}
                {canManage ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.edit")} onClick={() => edit(rule)}>
                    <Pencil />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            noValidate
            className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2"
          >
            <FormField label={t("dental.recallRuleName")} htmlFor="rule-name" className="sm:col-span-2">
              <Input id="rule-name" value={draft.name} maxLength={120} placeholder={t("dental.recallRuleNamePlaceholder")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </FormField>
            <FormField label={t("dental.recallRuleService")} htmlFor="rule-service" className="sm:col-span-2">
              <Select
                id="rule-service"
                options={(services.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
                value={draft.serviceId}
                placeholder={t("dental.recallRuleChooseService")}
                onChange={(serviceId) => setDraft({ ...draft, serviceId })}
              />
            </FormField>
            <FormField label={t("dental.recallRuleMonths")} htmlFor="rule-months">
              <Input id="rule-months" inputMode="numeric" value={draft.intervalMonths} onChange={(e) => setDraft({ ...draft, intervalMonths: e.target.value })} />
            </FormField>
            <FormField label={t("dental.recallRuleLead")} htmlFor="rule-lead" description={t("dental.recallRuleLeadHelp")}>
              <Input id="rule-lead" inputMode="numeric" value={draft.leadDays} onChange={(e) => setDraft({ ...draft, leadDays: e.target.value })} />
            </FormField>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="rule-active" checked={draft.active} onCheckedChange={(active) => setDraft({ ...draft, active })} />
              <label htmlFor="rule-active" className="text-sm">
                {t("dental.recallRuleActive")}
              </label>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        ) : null}

        <DialogFooter>
          {canManage && !draft ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                setDraft(blank());
              }}
            >
              <Plus aria-hidden="true" />
              {t("dental.recallRuleAdd")}
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
