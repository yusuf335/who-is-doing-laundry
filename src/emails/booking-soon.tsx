import { Text } from "@react-email/components";
import { Details, EmailLayout, paragraph } from "@/emails/layout";
import { BOOKING_LEAD_MINUTES } from "@/lib/push-message";

export interface BookingSoonProps {
  firstName: string;
  machineName: string;
  houseName: string;
  /** Already formatted in the house's time zone. */
  startsAt: string;
  endsAt: string;
  accent?: string;
  appUrl?: string;
}

/** "Your booking starts soon": sent a little before a booking you made. */
export default function BookingSoon(props: BookingSoonProps) {
  return (
    <EmailLayout
      preview={`Your ${props.machineName} booking starts at ${props.startsAt}.`}
      heading={`${props.machineName} in ${BOOKING_LEAD_MINUTES} minutes`}
      accent={props.accent}
      appUrl={props.appUrl}
      footer="You get this because you made the booking. Nobody else was emailed."
    >
      <Text style={paragraph}>Hi {props.firstName}, your booking is coming up.</Text>
      <Details
        rows={[
          ["Machine", `${props.machineName} at ${props.houseName}`],
          ["When", `${props.startsAt} to ${props.endsAt}`],
        ]}
      />
      <Text style={paragraph}>
        If you no longer need it, cancel it in the app so someone else can have the slot.
      </Text>
    </EmailLayout>
  );
}

BookingSoon.PreviewProps = {
  firstName: "Ada",
  machineName: "Dryer",
  houseName: "Maple Street",
  startsAt: "3:45 PM",
  endsAt: "4:45 PM",
  accent: "#c2410c",
  appUrl: "https://who-is-doing-laundry.vercel.app",
} satisfies BookingSoonProps;
