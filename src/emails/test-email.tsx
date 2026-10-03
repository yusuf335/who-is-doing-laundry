import { Text } from "@react-email/components";
import { EmailLayout, paragraph } from "@/emails/layout";
import { BOOKING_LEAD_MINUTES } from "@/lib/push-message";

export interface TestEmailProps {
  firstName: string;
  houseName: string;
  appUrl?: string;
  /** Public https base the logo loads from; omitted, the email goes without it. */
  assetUrl?: string;
}

/** Sent on request from settings, to show that email reaches this person at all. */
export default function TestEmail(props: TestEmailProps) {
  return (
    <EmailLayout
      preview="Email reminders reach you."
      heading="Email reminders reach you"
      appUrl={props.appUrl}
      assetUrl={props.assetUrl}
      footer={`You asked for this test in ${props.houseName}'s settings.`}
    >
      <Text style={paragraph}>Hi {props.firstName}, this is the test you asked for.</Text>
      <Text style={paragraph}>
        From now on you will get an email when your laundry is done, and one{" "}
        {BOOKING_LEAD_MINUTES} minutes before each of your bookings.
      </Text>
    </EmailLayout>
  );
}

TestEmail.PreviewProps = {
  firstName: "Ada",
  houseName: "Maple Street",
  appUrl: "https://who-is-doing-laundry.vercel.app",
  assetUrl: "https://who-is-doing-laundry.vercel.app",
} satisfies TestEmailProps;
