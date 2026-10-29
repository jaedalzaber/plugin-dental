import type { PackResourceType } from "../types";

// The kinds of people, rooms and equipment a dental clinic books. The resources themselves (Dr. X, Operatory 1)
// are the clinic's own and are added under Resources.
export const RESOURCE_TYPES_PACK: PackResourceType[] = [
  { key: "dentist", name: "Dentist", kind: "person" },
  { key: "hygienist", name: "Hygienist", kind: "person" },
  { key: "assistant", name: "Dental assistant", kind: "person" },
  { key: "operatory", name: "Operatory", kind: "space" },
  { key: "imaging", name: "Imaging equipment", kind: "equipment" },
];
