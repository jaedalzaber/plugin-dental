
import { useState, type FormEvent } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormField, Input, Select, toast, type SelectOption } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { amountTextToMinor, currencyExponent, issuesOf, minorToAmountText, useServices } from "@appointit/plugin-sdk/client";
import { useCreateProcedure, useUpdateProcedure, type ProcedureDto, type ProcedureInput } from "./hooks";

type Errors = { form?: string; name?: string; code?: string; category?: string; price?: string; currency?: string; serviceId?: string };

/** Add a procedure to the clinic's catalog, or edit one (`procedure` set). */
export function ProcedureDialog({ procedure, defaultCurrency, onClose }: { procedure: ProcedureDto | null; defaultCurrency: string; onClose: () => void }) {
  const t = useT();
  const create = useCreateProcedure();
  const update = useUpdateProcedure();
  const services = useServices();
  const [name, setName] = useState(procedure?.name ?? "");
  const [code, setCode] = useState(procedure?.code ?? "");
  const [category, setCategory] = useState(procedure?.category ?? "");
  const [currency, setCurrency] = useState(procedure?.currency ?? defaultCurrency);
  const [price, setPrice] = useState(
    procedure?.defaultPriceMinor != null ? minorToAmountText(String(procedure.defaultPriceMinor), currencyExponent(procedure.currency ?? defaultCurrency)) : "",
  );
  const [serviceId, setServiceId] = useState(procedure?.serviceId ?? "");
  const [errors, setErrors] = useState<Errors>({});

  const serviceOptions: SelectOption[] = [
    { value: "", label: t("dental.procFieldServiceNone") },
    ...(services.data ?? [])
      .filter((s) => s.status !== "archived" || s.id === procedure?.serviceId)
      .map((s) => ({ value: s.id, label: s.name })),
  ];
  const pending = create.isPending || update.isPending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Errors = {};
    const trimmedName = name.trim();
    const code3 = currency.trim().toUpperCase();
    let defaultPriceMinor: number | null = null;
    if (trimmedName === "") found.name = t("dental.procErrorName");
    if (price.trim() !== "") {
      const minor = /^[A-Za-z]{3}$/.test(code3) ? amountTextToMinor(price, currencyExponent(code3)) : null;
      if (!/^[A-Za-z]{3}$/.test(code3)) found.currency = t("dental.procErrorCurrency");
      else if (minor === null || !Number.isSafeInteger(Number(minor))) found.price = t("dental.procErrorPrice");
      else defaultPriceMinor = Number(minor);
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: ProcedureInput = {
      name: trimmedName,
      code: code.trim() === "" ? null : code.trim(),
      category: category.trim() === "" ? null : category.trim(),
      defaultPriceMinor,
      currency: defaultPriceMinor === null ? null : code3,
      serviceId: serviceId === "" ? null : serviceId,
    };
    try {
      if (procedure) {
        await update.mutateAsync({ ...body, id: procedure.id, expectedVersion: procedure.version });
        toast.success(t("dental.procSaved"));
      } else {
        await create.mutateAsync({ ...body, name: trimmedName });
        toast.success(t("dental.procCreated"));
      }
      onClose();
    } catch (error) {
      const next: Errors = {};
      for (const issue of issuesOf(error)) {
        const field = issue.path.split(".")[0];
        if (field === "name") next.name = issue.message;
        else if (field === "code") next.code = issue.message;
        else if (field === "category") next.category = issue.message;
        else if (field === "defaultPriceMinor") next.price = issue.message;
        else if (field === "currency") next.currency = issue.message;
        else if (field === "serviceId") next.serviceId = issue.message;
        else next.form = issue.message;
      }
      if (Object.keys(next).length === 0) next.form = error instanceof Error ? error.message : t("dental.procSaveFailed");
      setErrors(next);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={(event) => void onSubmit(event)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{procedure ? t("dental.procEditTitle") : t("dental.procAddTitle")}</DialogTitle>
            <DialogDescription>{t("dental.procDialogText")}</DialogDescription>
          </DialogHeader>
          {errors.form ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
              {errors.form}
            </p>
          ) : null}
          <FormField label={t("dental.procFieldName")} htmlFor="proc-name" error={errors.name} required>
            <Input id="proc-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoFocus />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("dental.procFieldCode")} htmlFor="proc-code" description={t("dental.procFieldCodeHelp")} error={errors.code}>
              <Input id="proc-code" value={code} maxLength={40} onChange={(event) => setCode(event.target.value)} />
            </FormField>
            <FormField label={t("dental.procFieldCategory")} htmlFor="proc-category" error={errors.category}>
              <Input id="proc-category" value={category} maxLength={60} onChange={(event) => setCategory(event.target.value)} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label={t("dental.procFieldPrice")} htmlFor="proc-price" error={errors.price}>
              <Input id="proc-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            </FormField>
            <FormField label={t("dental.procFieldCurrency")} htmlFor="proc-currency" error={errors.currency}>
              <Input id="proc-currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </FormField>
          </div>
          <FormField label={t("dental.procFieldService")} htmlFor="proc-service" description={t("dental.procFieldServiceHelp")} error={errors.serviceId}>
            <Select id="proc-service" options={serviceOptions} value={serviceId} onChange={setServiceId} placeholder={t("dental.procFieldServiceNone")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("dental.procSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
