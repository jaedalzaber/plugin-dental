// The admin side of the dental plugin. Pages and slots are listed in plugin.json (contributes); the keys below match them.
// Text comes from i18n/en.json (namespace "dental"); API calls go to /api/v1/ext/dental/...
import { definePluginUI, type SlotProps } from "@appointit/plugin-sdk/ui";
import { AlertBadge } from "./alerts/AlertBadge";
import { DentalBookingNotices } from "./alerts/DentalBookingNotices";
import { ProceduresScreen } from "./chart/ProceduresScreen";
import { DentalPatientTabs } from "./DentalPatientTabs";
import { ConsentFormsSettings } from "./history/ConsentFormsSettings";
import { RecallScreen } from "./plans/recall/RecallScreen";
import { RecallTile } from "./reports/RecallTile";
import { DentalSetupCard } from "./setup/DentalSetupCard";

function PatientTabs({ customerId }: SlotProps["customer.detail"]) {
  return <DentalPatientTabs customerId={customerId} />;
}

function BookingNotices({ customerId, bookingId, visitStart, visitStatus }: SlotProps["booking.panel"]) {
  return <DentalBookingNotices customerId={customerId} bookingId={bookingId} visitStart={visitStart} visitStatus={visitStatus} />;
}

function CalendarBadge({ customerId, visitStart, visitStatus }: SlotProps["calendar.booking.badge"]) {
  return <AlertBadge customerId={customerId} compact visitStart={visitStart} visitStatus={visitStatus} />;
}

export default definePluginUI({
  pages: { recall: RecallScreen, procedures: ProceduresScreen },
  slots: {
    "customer.detail": PatientTabs,
    "booking.panel": BookingNotices,
    "calendar.booking.badge": CalendarBadge,
    "settings.business": DentalSetupCard,
    "reports.tiles": RecallTile,
    "plugin.settings": ConsentFormsSettings,
  },
});
