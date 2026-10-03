import { Text } from "@react-email/components";
import { Details, EmailLayout, paragraph } from "@/emails/layout";

export interface CycleDoneProps {
  firstName: string;
  machineName: string;
  houseName: string;
  /** Already formatted in the house's time zone, e.g. "3:45 PM". */
  finishedAt: string;
  accent?: string;
  appUrl?: string;
}

/** "Your laundry is done": sent when a cycle you started finishes. */
export default function CycleDone(props: CycleDoneProps) {
  return (
    <EmailLayout
      preview={`Your ${props.machineName} finished at ${props.finishedAt}.`}
      heading="Your laundry is done"
      accent={props.accent}
      appUrl={props.appUrl}
      footer="You get this because you started the cycle. Nobody else was emailed."
    >
      <Text style={paragraph}>Hi {props.firstName},</Text>
      <Details
        rows={[
          ["Machine", `${props.machineName} at ${props.houseName}`],
          ["Finished", props.finishedAt],
        ]}
      />
      <Text style={paragraph}>
        Empty it when you can so the next person gets a turn, then mark it available in
        the app.
      </Text>
    </EmailLayout>
  );
}

// What `npm run email` shows while designing.
CycleDone.PreviewProps = {
  firstName: "Ada",
  machineName: "Washer",
  houseName: "Maple Street",
  finishedAt: "3:45 PM",
  accent: "#2563eb",
  appUrl: "https://who-is-doing-laundry.vercel.app",
} satisfies CycleDoneProps;
