import { describe, expect, it } from "vitest";
import { cycleDoneEmail } from "@/lib/reminder";

const base = {
  displayName: "Mo Farah",
  machineName: "Washer",
  houseName: "12 Oak Street",
  finishesAt: new Date("2026-09-21T15:02:00"),
};

describe("cycleDoneEmail", () => {
  it("says the laundry is done and names the machine", () => {
    expect(cycleDoneEmail(base).subject).toBe("Your laundry is done: Washer");
  });

  it("greets by first name and states the house and time", () => {
    const { text } = cycleDoneEmail(base);
    expect(text).toContain("Hi Mo,");
    expect(text).toContain("Washer at 12 Oak Street");
    expect(text).toContain("3:02 PM");
  });

  it("says why the recipient got it and that nobody else did", () => {
    const { text, html } = cycleDoneEmail(base);
    expect(text).toContain("Nobody else was emailed.");
    expect(html).toContain("Nobody else was emailed.");
  });

  it("includes the app link only when there is one", () => {
    expect(cycleDoneEmail(base).html).not.toContain("<a href");
    const linked = cycleDoneEmail({ ...base, appUrl: "https://laundry.example.com" });
    expect(linked.html).toContain('href="https://laundry.example.com"');
    expect(linked.text).toContain("https://laundry.example.com");
  });

  it("escapes a display name that contains markup", () => {
    const { html } = cycleDoneEmail({ ...base, displayName: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to a neutral greeting for a blank name", () => {
    expect(cycleDoneEmail({ ...base, displayName: "  " }).text).toContain("Hi there,");
  });
});
