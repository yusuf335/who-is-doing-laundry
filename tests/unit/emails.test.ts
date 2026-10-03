import { describe, expect, it } from "vitest";
import {
  bookingSoonEmail,
  cycleDoneEmail,
  emptiedEmail,
  testEmail,
} from "@/emails/build";

const zone = "America/Edmonton"; // UTC-6 in October
const at = (h: number, m: number) => new Date(Date.UTC(2026, 9, 3, h + 6, m)); // local h:m

const done = {
  displayName: "Mo Farah",
  machineName: "Washer",
  houseName: "12 Oak Street",
  finishesAt: at(15, 2),
  timeZone: zone,
};

describe("cycleDoneEmail", () => {
  it("says the laundry is done and names the machine", async () => {
    const { subject, text } = await cycleDoneEmail(done);
    expect(subject).toBe("Your laundry is done: Washer");
    expect(text).toMatch(/your laundry is done/i);
    expect(text).toContain("Washer at 12 Oak Street");
  });

  it("greets by first name and gives the time in the house's zone", async () => {
    const { text } = await cycleDoneEmail(done);
    expect(text).toContain("Hi Mo,");
    expect(text).toContain("3:02 PM");
  });

  it("says why the recipient got it and that nobody else did", async () => {
    const { text } = await cycleDoneEmail(done);
    expect(text).toContain("because you started the cycle. Nobody else was emailed.");
  });

  it("links back to the app only when there is a URL", async () => {
    expect((await cycleDoneEmail(done)).html).not.toContain("Open Laundry");
    const { html } = await cycleDoneEmail({ ...done, appUrl: "http://localhost:3001/" });
    expect(html).toContain('href="http://localhost:3001"');
  });

  it("loads the logo from a public https address, never localhost", async () => {
    const local = await cycleDoneEmail({ ...done, assetUrl: "http://localhost:3001" });
    expect(local.html).not.toContain("icon-192.png");
    const { html } = await cycleDoneEmail({ ...done, assetUrl: "https://l.example/" });
    expect(html).toContain("https://l.example/icon-192.png");
  });

  it("paints the stripe in the machine's colour", async () => {
    const { html } = await cycleDoneEmail({ ...done, accent: "#7c3aed" });
    expect(html).toContain("#7c3aed");
  });

  it("escapes a display name that contains markup", async () => {
    const { html } = await cycleDoneEmail({ ...done, displayName: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
  });

  it("falls back to a neutral greeting for a blank name", async () => {
    const { text } = await cycleDoneEmail({ ...done, displayName: "  " });
    expect(text).toContain("Hi there,");
  });
});

describe("bookingSoonEmail", () => {
  const soon = {
    displayName: "Ada Lovelace",
    machineName: "Dryer",
    houseName: "Maple",
    startsAt: at(15, 45),
    endsAt: at(16, 45),
    timeZone: zone,
  };

  it("says which machine and when, in the house's zone", async () => {
    const { subject, text } = await bookingSoonEmail(soon);
    expect(subject).toBe("Dryer in 15 minutes");
    expect(text).toContain("Hi Ada");
    expect(text).toContain("3:45 PM to 4:45 PM");
    expect(text).toContain("cancel it in the app");
  });
});

describe("testEmail", () => {
  it("says it is a test and what real reminders to expect", async () => {
    const { subject, text, html } = await testEmail({
      displayName: "Ada",
      houseName: "<Maple>",
    });
    expect(subject).toBe("Test email from Laundry");
    expect(text).toMatch(/email reminders reach you/i);
    expect(text).toContain("15 minutes before each of your bookings");
    expect(html).not.toContain("<Maple>");
  });
});

describe("emptiedEmail", () => {
  const base = {
    ownerName: "Mo Farah",
    emptierName: "Ada Lovelace",
    machineName: "Washer",
    houseName: "Maple",
    at: at(15, 45),
    timeZone: zone,
    stopped: false,
  };

  it("tells the owner who emptied it and when", async () => {
    const { subject, text } = await emptiedEmail({
      ...base,
      role: "owner",
      recipientName: "Mo Farah",
    });
    expect(subject).toBe("Ada emptied your Washer");
    expect(text).toContain("Hi Mo,");
    expect(text).toContain("3:45 PM by Ada");
  });

  it("confirms it to whoever emptied it", async () => {
    const { subject, text } = await emptiedEmail({
      ...base,
      role: "emptier",
      recipientName: "Ada Lovelace",
    });
    expect(subject).toBe("You emptied Mo's Washer");
    expect(text).toContain("Mo has been told");
  });

  it("says when it was stopped before it finished", async () => {
    const { subject, text } = await emptiedEmail({
      ...base,
      role: "owner",
      recipientName: "Mo",
      stopped: true,
    });
    expect(subject).toBe("Ada stopped your Washer");
    expect(text).toContain("may still be inside");
  });
});
