import type { PackService } from "../types";
import { CONSENT_FORM_SLUG, INTAKE_FORM_SLUG } from "./forms";

// Sample services with sample prices (the business currency). Lengths include no cleanup time: the operatory
// keeps 10 minutes free after the visit instead.
const operatory = { key: "operatory", typeKey: "operatory", bufferAfterMin: 10 };

export const SERVICES_PACK: PackService[] = [
  {
    slug: "new-patient-exam",
    name: "New patient exam",
    category: "Check-ups",
    description: "Your first visit: we get to know you, look after your teeth and plan your care.",
    durationMin: 60,
    startStepMin: 15,
    priceMinor: 9500,
    priceType: "fixed",
    needs: [{ key: "dentist", typeKey: "dentist" }, operatory],
    form: INTAKE_FORM_SLUG,
  },
  {
    slug: "cleaning-and-check-up",
    name: "Cleaning and check-up",
    category: "Check-ups",
    description: "A regular cleaning with a short check by the dentist at the end.",
    durationMin: 60,
    startStepMin: 15,
    priceMinor: 12000,
    priceType: "fixed",
    // The hygienist is with the patient the whole visit; the dentist joins for the last 15 minutes.
    needs: [
      { key: "hygienist", typeKey: "hygienist" },
      { key: "dentist", typeKey: "dentist", offsetMin: 45, lengthMin: 15 },
      operatory,
    ],
  },
  {
    slug: "filling",
    name: "Filling",
    category: "Treatments",
    description: "Repair a tooth in one visit.",
    durationMin: 45,
    startStepMin: 15,
    priceMinor: 18000,
    priceType: "from",
    needs: [{ key: "dentist", typeKey: "dentist" }, { key: "assistant", typeKey: "assistant" }, operatory],
    form: CONSENT_FORM_SLUG,
  },
  {
    slug: "root-canal-visit",
    name: "Root canal visit",
    category: "Treatments",
    description: "One visit of a longer treatment. Your dentist tells you how many visits you need.",
    durationMin: 90,
    startStepMin: 30,
    priceMinor: 65000,
    priceType: "from",
    needs: [{ key: "dentist", typeKey: "dentist" }, { key: "assistant", typeKey: "assistant" }, operatory],
    form: CONSENT_FORM_SLUG,
  },
  {
    slug: "whitening",
    name: "Whitening",
    category: "Cosmetic",
    description: "A professional whitening visit.",
    durationMin: 60,
    startStepMin: 30,
    priceMinor: 30000,
    priceType: "fixed",
    needs: [{ key: "hygienist", typeKey: "hygienist" }, operatory],
    form: CONSENT_FORM_SLUG,
  },
  {
    slug: "emergency-visit",
    name: "Emergency visit",
    category: "Emergency",
    description: "A short visit for something that cannot wait. Same-day times can be booked.",
    durationMin: 30,
    startStepMin: 15,
    priceMinor: 15000,
    priceType: "fixed",
    needs: [{ key: "dentist", typeKey: "dentist" }, operatory],
    // Short notice allowed: it can be booked right away.
    policy: { noticeMin: 0 },
  },
];
