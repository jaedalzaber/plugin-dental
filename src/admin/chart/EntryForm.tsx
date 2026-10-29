
import { useState, type FormEvent } from "react";
import { Button, Checkbox, FormField, Label, Select, Textarea, toast, type SelectOption } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { CONDITIONS, ENTRY_KINDS, SURFACE_SLOTS, surfaceLetters } from "../../server/chart/model";
import type { ConditionKey, EntryKind } from "../../server/chart/model";
import { issuesOf } from "@appointit/plugin-sdk/client";
import { useAddEntry, useProcedures } from "./hooks";

type Errors = { form?: string; condition?: string; surfaces?: string; notes?: string };

/** Add a finding, existing work, or planned or completed work to one tooth. */
export function EntryForm({ customerId, tooth }: { customerId: string; tooth: string }) {
  const t = useT();
  const add = useAddEntry(customerId);
  const procedures = useProcedures();
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [kind, setKind] = useState<EntryKind>("condition");
  const [condition, setCondition] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const letters = surfaceLetters(tooth);
  const idPrefix = `chart-add-${tooth}`;

  const kindOptions: SelectOption[] = ENTRY_KINDS.map((value) => ({ value, label: t(`dental.kind_${value}`) }));
  const conditionOptions: SelectOption[] = [
    { value: "", label: t("dental.chartNone") },
    ...CONDITIONS.map((value) => ({ value, label: t(`dental.condition_${value}`) })),
  ];
  const procedureOptions: SelectOption[] = [
    { value: "", label: t("dental.chartNone") },
    ...(procedures.data ?? []).map((p) => ({ value: p.id, label: p.name, ...(p.code ? { description: p.code } : {}) })),
  ];

  function toggle(letter: string, checked: boolean) {
    setSurfaces((current) => (checked ? [...current, letter] : current.filter((l) => l !== letter)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (condition === "" && procedureId === "") {
      setErrors({ condition: t("dental.chartErrorNeed") });
      return;
    }
    setErrors({});
    try {
      await add.mutateAsync({
        tooth,
        surfaces,
        kind,
        condition: condition === "" ? null : (condition as ConditionKey),
        procedureId: procedureId === "" ? null : procedureId,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      toast.success(t("dental.chartAdded"));
      setSurfaces([]);
      setCondition("");
      setProcedureId("");
      setNotes("");
    } catch (error) {
      const next: Errors = {};
      for (const issue of issuesOf(error)) {
        const field = issue.path.split(".")[0];
        if (field === "condition") next.condition = issue.message;
        else if (field === "surfaces") next.surfaces = issue.message;
        else if (field === "notes") next.notes = issue.message;
        else next.form = issue.message;
      }
      if (Object.keys(next).length === 0) next.form = error instanceof Error ? error.message : t("dental.chartSaveFailed");
      setErrors(next);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="grid gap-3">
      <h3 className="text-sm font-semibold">{t("dental.chartAddTitle")}</h3>
      {errors.form ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
          {errors.form}
        </p>
      ) : null}
      <fieldset className="grid gap-1.5">
        <legend className="text-sm leading-none font-medium">{t("dental.chartSurfaces")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {SURFACE_SLOTS.map((slot) => {
            const letter = letters[slot];
            const id = `${idPrefix}-surface-${letter}`;
            return (
              <div key={slot} className="flex items-center gap-2">
                <Checkbox id={id} checked={surfaces.includes(letter)} onCheckedChange={(checked) => toggle(letter, checked === true)} />
                <Label htmlFor={id} className="cursor-pointer font-normal">
                  <span className="font-medium">{letter}</span> {t(`dental.surface_${letter}`)}
                </Label>
              </div>
            );
          })}
        </div>
        <p className="text-[13px] text-muted-foreground">{errors.surfaces ?? t("dental.chartSurfacesHelp")}</p>
      </fieldset>
      <FormField label={t("dental.chartKind")} htmlFor={`${idPrefix}-kind`}>
        <Select id={`${idPrefix}-kind`} options={kindOptions} value={kind} onChange={(value) => setKind(value as EntryKind)} />
      </FormField>
      <FormField label={t("dental.chartCondition")} htmlFor={`${idPrefix}-condition`} error={errors.condition}>
        <Select id={`${idPrefix}-condition`} options={conditionOptions} value={condition} onChange={setCondition} placeholder={t("dental.chartNone")} />
      </FormField>
      <FormField label={t("dental.chartProcedure")} htmlFor={`${idPrefix}-procedure`}>
        <Select id={`${idPrefix}-procedure`} options={procedureOptions} value={procedureId} onChange={setProcedureId} placeholder={t("dental.chartNone")} />
      </FormField>
      <FormField label={t("dental.chartNotes")} htmlFor={`${idPrefix}-notes`} description={t("dental.chartNotesHelp")} error={errors.notes}>
        <Textarea id={`${idPrefix}-notes`} value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
      </FormField>
      <div>
        <Button type="submit" loading={add.isPending}>
          {t("dental.chartAdd")}
        </Button>
      </div>
    </form>
  );
}
