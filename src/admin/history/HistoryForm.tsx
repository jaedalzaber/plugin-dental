// The medical history form: sections of checkboxes and text, saved as one document. The parent re-mounts it
// (key = server version) after every save or import, so the draft always starts from what is stored.

import { useId, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Save } from "@appointit/ui/icons";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Textarea, toast } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { isApiError } from "@appointit/plugin-sdk/client";
import { historyKeys, useSaveHistory, type HistoryDocument, type HistoryDto } from "./api";
import { ImportDialog } from "./ImportDialog";
import { ListEditor } from "./ListEditor";

type Conditions = HistoryDocument["conditions"];
type Allergies = HistoryDocument["allergies"];

const CONDITION_KEYS = [
  "heartDisease",
  "highBloodPressure",
  "lowBloodPressure",
  "diabetes",
  "asthma",
  "epilepsy",
  "bleedingDisorder",
  "hepatitis",
  "hiv",
  "kidneyDisease",
  "liverDisease",
  "cancerRadiotherapy",
] as const satisfies readonly (keyof Conditions)[];

const ALLERGY_KEYS = ["penicillin", "latex", "localAnaesthetic", "nsaids"] as const satisfies readonly (keyof Allergies)[];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">{children}</CardContent>
    </Card>
  );
}

function Flag({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

export function HistoryForm({ customerId, data, canManage }: { customerId: string; data: HistoryDto; canManage: boolean }) {
  const t = useT();
  const uid = useId();
  const queryClient = useQueryClient();
  const save = useSaveHistory(customerId);
  const [draft, setDraft] = useState<HistoryDocument>(() => structuredClone(data.document));
  const [importOpen, setImportOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.document);
  const readOnly = !canManage;
  const id = (name: string) => `${uid}-${name}`;

  const patch = (change: (d: HistoryDocument) => HistoryDocument) => setDraft((d) => change(structuredClone(d)));
  const setCondition = (key: (typeof CONDITION_KEYS)[number], value: boolean) => patch((d) => ({ ...d, conditions: { ...d.conditions, [key]: value } }));
  const setAllergy = (key: (typeof ALLERGY_KEYS)[number], value: boolean) => patch((d) => ({ ...d, allergies: { ...d.allergies, [key]: value } }));

  async function submit(markReviewed: boolean) {
    try {
      await save.mutateAsync({ expectedVersion: data.version, document: draft, markReviewed });
      toast.success(markReviewed ? t("dental.histReviewedSaved") : t("dental.histSaved"));
    } catch (error) {
      if (isApiError(error, "VERSION_CONFLICT")) {
        toast.error(t("dental.histConflict"));
        await queryClient.invalidateQueries({ queryKey: historyKeys.history(customerId) });
      } else {
        toast.error(error instanceof Error ? error.message : t("dental.histSaveFailed"));
      }
    }
  }

  return (
    <div className="grid gap-4">
      {readOnly ? <p className="text-sm text-muted-foreground">{t("dental.histReadOnly")}</p> : null}

      <Section title={t("dental.histSecConditions")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CONDITION_KEYS.map((key) => (
            <Flag key={key} id={id(key)} label={t(`dental.cond_${key}`)} checked={draft.conditions[key]} disabled={readOnly} onChange={(value) => setCondition(key, value)} />
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("condOther")}>{t("dental.histConditionsOther")}</Label>
          <Input
            id={id("condOther")}
            value={draft.conditions.other}
            maxLength={2000}
            disabled={readOnly}
            onChange={(event) => patch((d) => ({ ...d, conditions: { ...d.conditions, other: event.target.value } }))}
          />
        </div>
      </Section>

      <Section title={t("dental.histSecMedications")}>
        <ListEditor
          id={id("med")}
          items={draft.medications}
          onChange={(medications) => patch((d) => ({ ...d, medications }))}
          placeholder={t("dental.histMedicationPlaceholder")}
          addLabel={t("dental.histAdd")}
          removeLabel={(item) => t("dental.histRemove", { item })}
          emptyText={t("dental.histMedicationsEmpty")}
          disabled={readOnly}
          maxItems={100}
        />
      </Section>

      <Section title={t("dental.histSecAllergies")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ALLERGY_KEYS.map((key) => (
            <Flag key={key} id={id(`al-${key}`)} label={t(`dental.allergy_${key}`)} checked={draft.allergies[key]} disabled={readOnly} onChange={(value) => setAllergy(key, value)} />
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("allergyOther")}>{t("dental.histAllergyOther")}</Label>
          <Input
            id={id("allergyOther")}
            value={draft.allergies.other}
            maxLength={2000}
            disabled={readOnly}
            onChange={(event) => patch((d) => ({ ...d, allergies: { ...d.allergies, other: event.target.value } }))}
          />
        </div>
      </Section>

      <Section title={t("dental.histSecRisks")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Flag id={id("smoker")} label={t("dental.histSmoker")} checked={draft.smoker} disabled={readOnly} onChange={(smoker) => patch((d) => ({ ...d, smoker }))} />
          <Flag id={id("anticoag")} label={t("dental.histAnticoagulants")} checked={draft.anticoagulants} disabled={readOnly} onChange={(anticoagulants) => patch((d) => ({ ...d, anticoagulants }))} />
          <Flag id={id("bisph")} label={t("dental.histBisphosphonates")} checked={draft.bisphosphonates} disabled={readOnly} onChange={(bisphosphonates) => patch((d) => ({ ...d, bisphosphonates }))} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Flag
            id={id("pregnant")}
            label={t("dental.histPregnant")}
            checked={draft.pregnancy.pregnant}
            disabled={readOnly}
            onChange={(pregnant) => patch((d) => ({ ...d, pregnancy: { pregnant, weeks: pregnant ? d.pregnancy.weeks : null } }))}
          />
          {draft.pregnancy.pregnant ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={id("weeks")} className="font-normal">
                {t("dental.histPregnancyWeeks")}
              </Label>
              <Input
                id={id("weeks")}
                type="number"
                inputMode="numeric"
                min={0}
                max={45}
                className="w-20"
                disabled={readOnly}
                value={draft.pregnancy.weeks ?? ""}
                onChange={(event) => {
                  const raw = event.target.value;
                  const weeks = raw === "" ? null : Math.min(45, Math.max(0, Math.trunc(Number(raw))));
                  patch((d) => ({ ...d, pregnancy: { ...d.pregnancy, weeks: Number.isFinite(weeks) ? weeks : null } }));
                }}
              />
            </div>
          ) : null}
        </div>
      </Section>

      <Section title={t("dental.histSecPrevious")}>
        <Textarea
          id={id("previous")}
          aria-label={t("dental.histSecPrevious")}
          value={draft.previousDentalIssues}
          maxLength={4000}
          disabled={readOnly}
          onChange={(event) => patch((d) => ({ ...d, previousDentalIssues: event.target.value }))}
        />
      </Section>

      <Section title={t("dental.histSecManualAlerts")}>
        <p className="text-sm text-muted-foreground">{t("dental.histManualAlertsHelp")}</p>
        <ListEditor
          id={id("manual")}
          items={draft.manualAlerts}
          onChange={(manualAlerts) => patch((d) => ({ ...d, manualAlerts }))}
          placeholder={t("dental.histManualAlertPlaceholder")}
          addLabel={t("dental.histAdd")}
          removeLabel={(item) => t("dental.histRemove", { item })}
          emptyText={t("dental.histManualAlertsEmpty")}
          disabled={readOnly}
          maxItems={20}
        />
      </Section>

      <Section title={t("dental.histSecNotes")}>
        <Textarea
          id={id("notes")}
          aria-label={t("dental.histSecNotes")}
          value={draft.notes}
          maxLength={8000}
          disabled={readOnly}
          onChange={(event) => patch((d) => ({ ...d, notes: event.target.value }))}
        />
      </Section>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void submit(false)} disabled={!dirty || save.isPending} loading={save.isPending && save.variables?.markReviewed !== true}>
            <Save aria-hidden="true" />
            {t("dental.histSave")}
          </Button>
          <Button variant="outline" onClick={() => void submit(true)} disabled={save.isPending} loading={save.isPending && save.variables?.markReviewed === true}>
            <CheckCircle2 aria-hidden="true" />
            {t("dental.histReviewedToday")}
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={dirty || save.isPending}>
            <FileText aria-hidden="true" />
            {t("dental.histImport")}
          </Button>
          {dirty ? <span className="text-sm text-muted-foreground">{t("dental.histUnsaved")}</span> : null}
        </div>
      ) : null}

      <ImportDialog customerId={customerId} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
