import { describe, expect, it } from "vitest";
import { getSmtpConfig, loadConfig } from "../src/config.js";

const BASE = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  AUTH_SECRET: "un-secret-suffisamment-long",
};

describe("loadConfig (Zod)", () => {
  it("refuse un environnement sans DATABASE_URL avec message explicite", () => {
    expect(() => loadConfig({ AUTH_SECRET: BASE.AUTH_SECRET } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });
  it("refuse un AUTH_SECRET trop court", () => {
    expect(() =>
      loadConfig({ ...BASE, AUTH_SECRET: "court" } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_SECRET/);
  });
  it("applique les valeurs par défaut", () => {
    const env = loadConfig(BASE as NodeJS.ProcessEnv);
    expect(env.TZ).toBe("Europe/Paris");
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.AI_MODEL).toBe("claude-haiku-4-5");
    expect(env.SMTP_PORT).toBe(465);
  });
  it("traite les chaînes vides comme absentes", () => {
    const env = loadConfig({ ...BASE, ANTHROPIC_API_KEY: "  " } as NodeJS.ProcessEnv);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("getSmtpConfig", () => {
  it("retourne null si l'email n'est pas configuré", () => {
    const env = loadConfig(BASE as NodeJS.ProcessEnv);
    expect(getSmtpConfig(env)).toBeNull();
  });
  it("retourne la config complète quand tout est présent", () => {
    const env = loadConfig({
      ...BASE,
      SMTP_HOST: "smtp.zoho.eu",
      SMTP_PORT: "465",
      SMTP_USER: "contact@mondomaine.fr",
      SMTP_PASS: "secret",
      MAIL_FROM_NAME: "Jean Dupont",
      MAIL_FROM_ADDRESS: "contact@mondomaine.fr",
    } as NodeJS.ProcessEnv);
    const smtp = getSmtpConfig(env);
    expect(smtp).toEqual({
      host: "smtp.zoho.eu",
      port: 465,
      user: "contact@mondomaine.fr",
      pass: "secret",
      fromName: "Jean Dupont",
      fromAddress: "contact@mondomaine.fr",
    });
  });
});
