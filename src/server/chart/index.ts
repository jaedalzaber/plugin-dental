// Dental chart (odontogram) and the clinic's procedure catalog.
import type { PluginApi } from "@appointit/plugin-sdk";

export * from "./model";
export { addEntry, chartHistory, chartToothNumbering, listChart, updateEntry } from "./entries";
export { archiveProcedure, createProcedure, listProcedures, reorderProcedures, updateProcedure } from "./procedures";

export function registerChart(_api: PluginApi): void {}
