import { Text } from "@react-email/components";
import { Details, EmailLayout, paragraph } from "@/emails/layout";

export interface EmptiedProps {
  /** Who this copy is for: the person whose laundry it was, or whoever emptied it. */
  to: "owner" | "emptier";
  firstName: string;
  ownerName: string;
  emptierName: string;
  machineName: string;
  houseName: string;
  /** Already formatted in the house's time zone. */
  at: string;
  /** Stopped before the cycle finished, rather than emptied after. */
  stopped: boolean;
  accent?: string;
  appUrl?: string;
  assetUrl?: string;
}

/** Sent to both people when somebody other than the owner empties or stops a machine. */
export default function Emptied(props: EmptiedProps) {
  const verb = props.stopped ? "stopped" : "emptied";
  const owner = props.to === "owner";
  const heading = owner
    ? `${props.emptierName} ${verb} your ${props.machineName}`
    : `You ${verb} ${props.ownerName}'s ${props.machineName}`;

  return (
    <EmailLayout
      preview={heading}
      heading={heading}
      accent={props.accent}
      appUrl={props.appUrl}
      assetUrl={props.assetUrl}
      footer={
        owner
          ? "You get this because it was your cycle."
          : `You get this because you pressed ${props.stopped ? "Stop" : "Emptied"}.`
      }
    >
      <Text style={paragraph}>Hi {props.firstName},</Text>
      <Details
        rows={[
          ["Machine", `${props.machineName} at ${props.houseName}`],
          [
            props.stopped ? "Stopped" : "Emptied",
            `${props.at} by ${owner ? props.emptierName : "you"}`,
          ],
        ]}
      />
      <Text style={paragraph}>
        {owner
          ? props.stopped
            ? "Your cycle was stopped before it finished, so your laundry may still be inside."
            : `${props.emptierName} took your laundry out so the next person could use the machine.`
          : `${props.ownerName} has been told, so they know where their laundry went.`}
      </Text>
    </EmailLayout>
  );
}

Emptied.PreviewProps = {
  to: "owner",
  firstName: "Mo",
  ownerName: "Mo",
  emptierName: "Ada",
  machineName: "Washer",
  houseName: "Maple Street",
  at: "3:45 PM",
  stopped: false,
  accent: "#2563eb",
  appUrl: "https://who-is-doing-laundry.vercel.app",
  assetUrl: "https://who-is-doing-laundry.vercel.app",
} satisfies EmptiedProps;
