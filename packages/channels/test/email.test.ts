import { describe, expect, it, vi } from "vitest";
import { hasComplianceFooter, withComplianceFooter } from "../src/compliance.js";
import { EmailChannel, type MailTransport } from "../src/email.js";

const SMTP = {
  host: "smtp.test",
  port: 465,
  user: "u",
  pass: "p",
  fromName: "Jean Test",
  fromAddress: "jean@mondomaine.fr",
};

describe("conformité CNIL / L.34-5 CPCE", () => {
  it("le pied contient identité, mention d'information et STOP", () => {
    const body = withComplianceFooter("Bonjour, message de test.", {
      senderName: "Jean Test",
      senderActivity: "Vidéos courtes",
    });
    expect(body).toContain("Jean Test — Vidéos courtes");
    expect(body).toContain("coordonnées professionnelles");
    expect(body).toContain("droits");
    expect(body).toContain("répondez STOP");
    expect(hasComplianceFooter(body)).toBe(true);
  });

  it("URL one-click ajoutée uniquement si configurée (VPS futur)", () => {
    const opts = { senderName: "J", senderActivity: "V" };
    expect(withComplianceFooter("x", opts)).not.toContain("un clic");
    expect(
      withComplianceFooter("x", { ...opts, unsubscribePublicUrl: "https://ex.fr/u/1" }),
    ).toContain("https://ex.fr/u/1");
  });
});

describe("EmailChannel (Nodemailer)", () => {
  it("envoie avec List-Unsubscribe mailto STOP et retourne le Message-ID", async () => {
    const sendMail = vi.fn(async (_mail: unknown) => ({ messageId: "<abc@smtp.test>" }));
    const channel = new EmailChannel(SMTP, { transport: { sendMail } as unknown as MailTransport });
    const result = await channel.send({
      prospectId: "p1",
      channel: "email",
      subject: "Objet",
      body: "Corps",
      to: "contact@cible.fr",
    });
    expect(result).toEqual({ ok: true, smtpMessageId: "<abc@smtp.test>" });
    const mail = sendMail.mock.calls[0]![0] as unknown as {
      from: { name: string; address: string };
      headers: Record<string, string>;
    };
    expect(mail.from).toEqual({ name: "Jean Test", address: "jean@mondomaine.fr" });
    expect(mail.headers["List-Unsubscribe"]).toBe("<mailto:jean@mondomaine.fr?subject=STOP>");
  });

  it("threading de la relance : In-Reply-To + References", async () => {
    const sendMail = vi.fn(async (_mail: unknown) => ({ messageId: "<r@smtp.test>" }));
    const channel = new EmailChannel(SMTP, { transport: { sendMail } as unknown as MailTransport });
    await channel.send({
      prospectId: "p1",
      channel: "email",
      body: "Relance",
      to: "contact@cible.fr",
      inReplyTo: "<initial@smtp.test>",
    });
    const mail = sendMail.mock.calls[0]![0] as unknown as { inReplyTo: string; references: string };
    expect(mail.inReplyTo).toBe("<initial@smtp.test>");
    expect(mail.references).toBe("<initial@smtp.test>");
  });

  it("erreur SMTP → SendResult ok:false sans exception", async () => {
    const sendMail = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const channel = new EmailChannel(SMTP, { transport: { sendMail } as unknown as MailTransport });
    const result = await channel.send({
      prospectId: "p1",
      channel: "email",
      body: "x",
      to: "a@b.fr",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});
