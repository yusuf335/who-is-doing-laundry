import { render } from "@react-email/render";
import BookingReleased from "@/emails/booking-released";
import BookingSoon from "@/emails/booking-soon";
import CycleDone from "@/emails/cycle-done";
import Emptied from "@/emails/emptied";
import TestEmail from "@/emails/test-email";
import { BOOKING_LEAD_MINUTES, clockIn } from "@/lib/push-message";
import type { ReminderContent } from "@/lib/reminder";

/**
 * Turns each React Email template into what Resend sends: a subject, the HTML, and a
 * plain-text version rendered from the same template so the two never drift apart.
 * Times are formatted in the house's zone because the server runs in UTC.
 */

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || "there";
}

async function content(
  subject: string,
  email: React.ReactElement,
): Promise<ReminderContent> {
  const [html, text] = await Promise.all([
    render(email),
    render(email, { plainText: true }),
  ]);
  return { subject, html, text };
}

export function cycleDoneEmail(input: {
  displayName: string;
  machineName: string;
  houseName: string;
  finishesAt: Date;
  timeZone?: string;
  accent?: string;
  appUrl?: string;
  assetUrl?: string;
}): Promise<ReminderContent> {
  return content(
    `Your laundry is done: ${input.machineName}`,
    <CycleDone
      firstName={firstName(input.displayName)}
      machineName={input.machineName}
      houseName={input.houseName}
      finishedAt={clockIn(input.finishesAt, input.timeZone)}
      accent={input.accent}
      appUrl={input.appUrl}
      assetUrl={input.assetUrl}
    />,
  );
}

export function bookingSoonEmail(input: {
  displayName: string;
  machineName: string;
  houseName: string;
  startsAt: Date;
  endsAt: Date;
  timeZone?: string;
  accent?: string;
  appUrl?: string;
  assetUrl?: string;
}): Promise<ReminderContent> {
  return content(
    `${input.machineName} in ${BOOKING_LEAD_MINUTES} minutes`,
    <BookingSoon
      firstName={firstName(input.displayName)}
      machineName={input.machineName}
      houseName={input.houseName}
      startsAt={clockIn(input.startsAt, input.timeZone)}
      endsAt={clockIn(input.endsAt, input.timeZone)}
      accent={input.accent}
      appUrl={input.appUrl}
      assetUrl={input.assetUrl}
    />,
  );
}

export function testEmail(input: {
  displayName: string;
  houseName: string;
  appUrl?: string;
  assetUrl?: string;
}): Promise<ReminderContent> {
  return content(
    "Test email from Laundry",
    <TestEmail
      firstName={firstName(input.displayName)}
      houseName={input.houseName}
      appUrl={input.appUrl}
      assetUrl={input.assetUrl}
    />,
  );
}

export function emptiedEmail(input: {
  role: "owner" | "emptier";
  recipientName: string;
  ownerName: string;
  emptierName: string;
  machineName: string;
  houseName: string;
  at: Date;
  stopped: boolean;
  timeZone?: string;
  accent?: string;
  appUrl?: string;
  assetUrl?: string;
}): Promise<ReminderContent> {
  const verb = input.stopped ? "stopped" : "emptied";
  return content(
    input.role === "owner"
      ? `${firstName(input.emptierName)} ${verb} your ${input.machineName}`
      : `You ${verb} ${firstName(input.ownerName)}'s ${input.machineName}`,
    <Emptied
      to={input.role}
      firstName={firstName(input.recipientName)}
      ownerName={firstName(input.ownerName)}
      emptierName={firstName(input.emptierName)}
      machineName={input.machineName}
      houseName={input.houseName}
      at={clockIn(input.at, input.timeZone)}
      stopped={input.stopped}
      accent={input.accent}
      appUrl={input.appUrl}
      assetUrl={input.assetUrl}
    />,
  );
}

export function bookingReleasedEmail(input: {
  displayName: string;
  machineName: string;
  houseName: string;
  startsAt: Date;
  endsAt: Date;
  timeZone?: string;
  accent?: string;
  appUrl?: string;
  assetUrl?: string;
}): Promise<ReminderContent> {
  return content(
    `Your ${input.machineName} booking was released`,
    <BookingReleased
      firstName={firstName(input.displayName)}
      machineName={input.machineName}
      houseName={input.houseName}
      startsAt={clockIn(input.startsAt, input.timeZone)}
      endsAt={clockIn(input.endsAt, input.timeZone)}
      accent={input.accent}
      appUrl={input.appUrl}
      assetUrl={input.assetUrl}
    />,
  );
}
