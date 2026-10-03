import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * The frame every email shares: the app's icon, one card with a stripe in the machine's
 * colour, a button back into the app, and a line saying why this person got it.
 * Inline styles only, because that is what email clients reliably keep.
 */
export function EmailLayout({
  preview,
  heading,
  accent = "#171717",
  appUrl,
  footer,
  children,
}: {
  /** The grey line inboxes show next to the subject. */
  preview: string;
  heading: string;
  /** The machine's colour, so it reads like the calendar. */
  accent?: string;
  appUrl?: string;
  footer: string;
  children: React.ReactNode;
}) {
  const link = appUrl?.trim().replace(/\/$/, "") ?? "";
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            {link && (
              <Img
                src={`${link}/icon-192.png`}
                width="36"
                height="36"
                alt=""
                style={{
                  borderRadius: 9,
                  display: "inline-block",
                  verticalAlign: "middle",
                }}
              />
            )}
            <span style={brandName}>Laundry</span>
          </Section>

          <Section style={{ ...card, borderTop: `4px solid ${accent}` }}>
            <Heading as="h1" style={h1}>
              {heading}
            </Heading>
            {children}
            {link && (
              <Button href={link} style={button}>
                Open Laundry
              </Button>
            )}
          </Section>

          <Hr style={{ borderColor: "#e5e5e5", margin: "24px 0 12px" }} />
          <Text style={footerText}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

/** A label and a value in a soft grey box, e.g. "When / 3:45 PM to 4:45 PM". */
export function Details({ rows }: { rows: [label: string, value: string][] }) {
  return (
    <Section style={details}>
      {rows.map(([label, value]) => (
        <Text key={label} style={detailRow}>
          <span style={detailLabel}>{label}</span>
          <br />
          <strong style={{ color: "#171717" }}>{value}</strong>
        </Text>
      ))}
    </Section>
  );
}

export const paragraph: React.CSSProperties = {
  fontSize: 15,
  lineHeight: "24px",
  color: "#404040",
  margin: "0 0 16px",
};

const body: React.CSSProperties = {
  backgroundColor: "#f5f5f5",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 12px",
};

const container: React.CSSProperties = { maxWidth: 480, margin: "0 auto" };

const brand: React.CSSProperties = { padding: "0 4px 16px" };

const brandName: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "#171717",
  marginLeft: 10,
  verticalAlign: "middle",
};

const card: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 12,
  border: "1px solid #e5e5e5",
  padding: "28px 28px 32px",
};

const h1: React.CSSProperties = {
  fontSize: 22,
  lineHeight: "30px",
  fontWeight: 600,
  color: "#171717",
  margin: "0 0 12px",
};

const details: React.CSSProperties = {
  backgroundColor: "#f5f5f5",
  borderRadius: 10,
  padding: "4px 16px",
  margin: "0 0 24px",
};

const detailRow: React.CSSProperties = {
  fontSize: 15,
  lineHeight: "22px",
  margin: "12px 0",
};

const detailLabel: React.CSSProperties = { fontSize: 12, color: "#737373" };

const button: React.CSSProperties = {
  backgroundColor: "#171717",
  color: "#ffffff",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  padding: "12px 22px",
  textDecoration: "none",
};

const footerText: React.CSSProperties = {
  fontSize: 12,
  lineHeight: "18px",
  color: "#737373",
  margin: 0,
  padding: "0 4px",
};
