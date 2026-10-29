import type { PackProcedure } from "../types";

// The clinic's own procedure catalog. Codes are short clinic-own labels, not a licensed code list: the clinic
// changes, adds or clears them. Prices are samples in minor units of the business currency.
const p = (code: string | null, name: string, category: string, priceMinor: number, service: string): PackProcedure => ({
  code,
  name,
  category,
  priceMinor,
  service,
});

export const PROCEDURES_PACK: PackProcedure[] = [
  p("EXAM-NP", "New patient exam", "Diagnostic", 9500, "new-patient-exam"),
  p("EXAM-PD", "Periodic check-up", "Diagnostic", 6000, "cleaning-and-check-up"),
  p("XRAY-BW", "Bitewing X-rays", "Diagnostic", 4500, "new-patient-exam"),
  p("XRAY-PAN", "Panoramic X-ray", "Diagnostic", 9000, "new-patient-exam"),
  p("CLEAN", "Cleaning", "Preventive", 8500, "cleaning-and-check-up"),
  p("FLUOR", "Fluoride treatment", "Preventive", 3000, "cleaning-and-check-up"),
  p("SEAL", "Sealant", "Preventive", 4000, "filling"),
  p("FILL-1", "Filling, one surface", "Restorative", 18000, "filling"),
  p("FILL-2", "Filling, two surfaces", "Restorative", 24000, "filling"),
  p("FILL-3", "Filling, three surfaces", "Restorative", 30000, "filling"),
  p("ROOT-1", "Root canal, front tooth", "Endodontics", 65000, "root-canal-visit"),
  p("ROOT-2", "Root canal, back tooth", "Endodontics", 95000, "root-canal-visit"),
  p("ROOT-TEMP", "Temporary filling", "Endodontics", 7000, "root-canal-visit"),
  p("WHITE", "Whitening", "Cosmetic", 30000, "whitening"),
  p("WHITE-TU", "Whitening touch-up", "Cosmetic", 15000, "whitening"),
  p("EMERG-EX", "Emergency exam", "Emergency", 15000, "emergency-visit"),
  p("EMERG-REL", "Emergency relief visit", "Emergency", 20000, "emergency-visit"),
];
