import type { PackForm, PackFormField } from "../types";

// Three forms in the shape the form builder edits (steps, fields, after, spam ...). They send no automatic email,
// so no answer ever travels in a message; the thank-you text is generic.
export const INTAKE_FORM_SLUG = "new-patient-intake";
export const CONSENT_FORM_SLUG = "consent-to-treatment";
export const BOOKING_FORM_SLUG = "book-an-appointment";
export const BOOKING_THANKS = "You're booked! We sent a confirmation to your email.";
export const FORM_THANKS = "Thank you. We have received your form.";

const field = (step: string, id: string, type: string, label: string, o: Partial<PackFormField> = {}): PackFormField => ({
  id,
  type,
  label,
  ph: "",
  help: "",
  req: false,
  w: "full",
  step,
  ...o,
});

const base = (name: string, purpose: "request" | "blank" | "booking", popupBtn: string, contacts: boolean, thanks = FORM_THANKS) => ({
  schemaVersion: 1,
  name,
  rules: [],
  after: {
    notify: "",
    route: false,
    bell: true,
    push: false,
    auto: false,
    autoSub: "",
    body: "",
    thanks,
    redirect: "",
    contacts,
  },
  spam: { honey: true, speed: true, rate: true, dup: true, turn: false, otp: false },
  place: [],
  avail: { open: true, until: "", max: 0, closed: "Closed" },
  popupBtn,
  purpose,
  autos: [],
});

const YES_NO = ["Yes", "No"];

// Field ids and labels are chosen for history/intake-mapping.ts, which maps the answers of an intake submission onto
// the medical history. INTAKE_FIELD_SECTIONS names the section each answer lands in (the test checks it).
const intakeFields: PackFormField[] = [
  field("about", "name", "name", "Full name", { req: true, w: "half", role: "name" }),
  field("about", "date_of_birth", "date", "Date of birth", { req: true, w: "half" }),
  field("about", "email", "email", "Email", { req: true, w: "half", role: "email" }),
  field("about", "phone", "phone", "Phone", { req: true, w: "half", role: "phone" }),
  field("about", "address", "address", "Home address", { role: "address" }),
  field("about", "visit_reason", "short", "What brings you in?", { ph: "For example: a check-up" }),

  field("history", "conditions", "check", "Do you have, or have you had, any of these health conditions?", {
    opts: [
      "Heart condition",
      "High blood pressure",
      "Low blood pressure",
      "Diabetes",
      "Asthma",
      "Epilepsy or seizures",
      "Bleeding disorder",
      "Hepatitis",
      "HIV or AIDS",
      "Kidney disease",
      "Liver disease",
      "Cancer or radiotherapy",
      "None of these",
    ],
  }),
  field("history", "allergies", "check", "Are you allergic to any of these?", {
    opts: ["Penicillin", "Latex", "Local anaesthetic (numbing injection)", "NSAID painkillers such as ibuprofen", "None of these"],
  }),
  field("history", "other_allergies", "short", "Any other allergies?", { help: "Write None if you have none." }),
  field("history", "medications", "long", "Medicines you take now", { help: "Include vitamins and supplements. Write None if you take none." }),
  field("history", "blood_thinners", "radio", "Do you take blood thinners (anticoagulants)?", { opts: YES_NO, req: true }),
  field("history", "bisphosphonates", "radio", "Do you take, or have you taken, bisphosphonate medicines for bone strength?", { opts: YES_NO, req: true }),
  field("more", "pregnant", "radio", "Are you pregnant?", { opts: ["No", "Yes", "Not applicable"], req: true }),
  field("more", "pregnancy_weeks", "short", "If you are pregnant, how many weeks?", { w: "half" }),
  field("more", "smoker", "radio", "Do you smoke or use tobacco or vapes?", { opts: YES_NO, req: true }),
  field("more", "dental_history", "long", "Previous dental problems or treatment", { help: "Write None if there is nothing to tell us." }),
  field("more", "health_notes", "long", "Anything else about your health we should know?"),

  field("emergency", "emergency_name", "short", "Emergency contact name", { req: true, w: "half" }),
  field("emergency", "emergency_phone", "short", "Emergency contact phone", { req: true, w: "half", ph: "(123) 456-7890" }),

  field("emergency", "confirm_true", "consent", "I confirm that the information I gave is true and complete.", { req: true }),
];

export const INTAKE_FORM: PackForm = {
  slug: INTAKE_FORM_SLUG,
  name: "New patient intake and medical history",
  purpose: "intake",
  content: {
    ...base("New patient intake and medical history", "request", "Start intake", true),
    steps: [
      { id: "about", t: "About you" },
      { id: "history", t: "Health history", desc: "This helps us look after you safely. Tell us if anything changes later." },
      { id: "more", t: "A few more questions" },
      { id: "emergency", t: "Emergency contact and confirmation" },
    ],
    fields: intakeFields,
  },
};

/**
 * The section of the medical history each intake answer lands in (names as in mapIntakeAnswers().mappedSections), or
 * "skip" for contact and confirmation fields the mapping ignores on purpose. "notes" = kept as a line in the notes.
 */
export const INTAKE_FIELD_SECTIONS: Record<string, string> = {
  name: "skip",
  date_of_birth: "notes",
  email: "skip",
  phone: "skip",
  address: "skip",
  visit_reason: "notes",
  conditions: "conditions",
  allergies: "allergies",
  other_allergies: "allergies",
  medications: "medications",
  blood_thinners: "anticoagulants",
  bisphosphonates: "bisphosphonates",
  pregnant: "pregnancy",
  pregnancy_weeks: "pregnancy",
  smoker: "smoker",
  dental_history: "previousDentalIssues",
  health_notes: "notes",
  emergency_name: "notes",
  emergency_phone: "notes",
  confirm_true: "skip",
};

export const CONSENT_FORM: PackForm = {
  slug: CONSENT_FORM_SLUG,
  name: "Consent to treatment",
  purpose: "consent",
  content: {
    ...base("Consent to treatment", "blank", "Sign consent", false),
    steps: [
      { id: "patient", t: "Patient" },
      { id: "consent", t: "Consent and signature" },
    ],
    fields: [
      field("patient", "name", "name", "Full name", { req: true, role: "name" }),
      field("patient", "consent_date", "date", "Date", { req: true, w: "half" }),
      field("consent", "consent_info", "textimage", "About your treatment", {
        html: "<p><b>Consent to treatment</b></p><p>Your dentist has explained the proposed treatment, why it is suggested, what to expect, the possible risks and the alternatives, including having no treatment. You can ask questions at any time and you can change your mind before treatment starts.</p>",
      }),
      field("consent", "agree_explained", "consent", "The treatment, its risks and the alternatives were explained to me.", { req: true }),
      field("consent", "agree_questions", "consent", "I had the chance to ask questions and they were answered.", { req: true }),
      field("consent", "agree_treatment", "consent", "I agree to the treatment.", { req: true }),
      field("consent", "signature", "signature", "Patient signature", { req: true }),
    ],
  },
};

// The online booking form: service, time, contact, then a review and the payment block, which shows the deposit the
// service asks for (nothing is due for a service without one). Same blocks as the "Paid booking (deposit)" template of
// the form builder; services, prices and free times always come from the clinic's own catalog and schedule.
export const BOOKING_FORM: PackForm = {
  slug: BOOKING_FORM_SLUG,
  name: "Book an appointment",
  purpose: "booking",
  content: {
    ...base("Book an appointment", "booking", "Book now", true, BOOKING_THANKS),
    confirm: "paid",
    steps: [
      { id: "service", t: "Service" },
      { id: "time", t: "Date & time" },
      { id: "you", t: "Your info" },
      { id: "review", t: "Review" },
      { id: "payment", t: "Payment" },
    ],
    fields: [
      field("service", "service", "service", "Which services?", { req: true, role: "service", disp: "cards", multi: true, ph: "Choose a service", prefill: "service" }),
      field("time", "slot", "slot", "Date & time", { req: true, role: "slot", hold: 10 }),
      field("you", "name", "name", "Full name", { req: true, w: "half", role: "name", ph: "John Doe" }),
      field("you", "email", "email", "Email", { req: true, role: "email", ph: "john@example.com" }),
      field("you", "phone", "phone", "Phone", { req: true, w: "half", role: "phone", ph: "(123) 456-7890" }),
      field("you", "sms", "consent", "I agree to receive appointment text messages.", { role: "sms", policy: "" }),
      field("you", "agree", "consent", "I agree to the Privacy Policy and Terms of Service", { req: true }),
      field("review", "summary", "summary", "Check your booking", { req: true }),
      field("payment", "payment", "payment", "Payment", { req: true, pay: { mode: "deposit", amountType: "fixed", amount: 20, refundHours: 24 } }),
    ],
  },
};

export const FORMS_PACK: PackForm[] = [INTAKE_FORM, CONSENT_FORM, BOOKING_FORM];
