// What the dental vertical adds to the booking side panel: the patient's medical alerts, a "History review due" chip and
// a "Consent needed" notice. Renders nothing for patients without alerts or a due review and bookings without a pending consent form.

import { AlertBadge } from "./AlertBadge";
import { ConsentNotice } from "./ConsentNotice";

export function DentalBookingNotices({
  customerId,
  bookingId,
  visitStart,
  visitStatus,
}: {
  customerId: string | null;
  bookingId: string;
  visitStart?: string;
  visitStatus?: string;
}) {
  return (
    <>
      <AlertBadge customerId={customerId} showLabels visitStart={visitStart} visitStatus={visitStatus} />
      <ConsentNotice bookingId={bookingId} />
    </>
  );
}
