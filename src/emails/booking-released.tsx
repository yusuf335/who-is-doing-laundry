import { Text } from "@react-email/components";
import { Details, EmailLayout, paragraph } from "@/emails/layout";
import { NO_SHOW_MINUTES } from "@/lib/types";

export interface BookingReleasedProps {
  firstName: string;
  machineName: string;
  houseName: string;
  /** Already formatted in the house's time zone. */
  startsAt: string;
  endsAt: string;
  accent?: string;
  appUrl?: string;
  assetUrl?: string;
}

/** Sent when a booking lapses because nobody started the machine in time. */
export default function BookingReleased(props: BookingReleasedProps) {
  return (
    <EmailLayout
      preview={`Your ${props.machineName} booking was released.`}
      heading={`Your ${props.machineName} booking was released`}
      accent={props.accent}
      appUrl={props.appUrl}
      assetUrl={props.assetUrl}
      footer="You get this because you made the booking. Nobody else was emailed."
    >
      <Text style={paragraph}>Hi {props.firstName},</Text>
      <Details
        rows={[
          ["Machine", `${props.machineName} at ${props.houseName}`],
          ["Booking", `${props.startsAt} to ${props.endsAt}`],
        ]}
      />
      <Text style={paragraph}>
        The machine was not started within {NO_SHOW_MINUTES} minutes of the start, so the
        slot has been freed for someone else. Book again whenever you are ready.
      </Text>
    </EmailLayout>
  );
}

BookingReleased.PreviewProps = {
  firstName: "Ada",
  machineName: "Washer",
  houseName: "Maple Street",
  startsAt: "3:00 PM",
  endsAt: "4:00 PM",
  accent: "#2563eb",
  appUrl: "https://who-is-doing-laundry.vercel.app",
  assetUrl: "https://who-is-doing-laundry.vercel.app",
} satisfies BookingReleasedProps;
