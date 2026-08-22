import { createAIProvider, neutralTemplate, type PersonalizeInput } from "@prospection/ai";
import {
  EmailChannel,
  planInitialEmails,
  planRelances,
  sendDueEmails,
  type SequencerDeps,
} from "@prospection/channels";
import {
  getDb,
  getSettings,
  getSmtpConfig,
  isAutomationPaused,
  logger,
  type Env,
} from "@prospection/core";
import type PgBoss from "pg-boss";
import { QUEUES } from "./queues.js";

/**
 * Job séquenceur (§7.4) : toutes les 5 minutes —
 * planification des initiaux, des relances, puis envoi des messages dus.
 * STOP vérifié en début de job et re-vérifié avant chaque envoi (dans
 * sendDueEmails).
 */
export async function buildSequencerDeps(env: Env): Promise<SequencerDeps | null> {
  const db = getDb(env.DATABASE_URL);
  const settings = await getSettings(db);
  const smtp = getSmtpConfig(env);

  const provider = createAIProvider({
    provider: settings.aiProvider,
    model: settings.aiModel,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
  });

  // personalize avec repli : IA indisponible → template neutre (jamais bloquant)
  const personalize = async (input: PersonalizeInput) => {
    if (!env.ANTHROPIC_API_KEY || settings.aiProvider !== "anthropic") {
      return neutralTemplate(input);
    }
    try {
      return await provider.personalize(input);
    } catch (err) {
      logger.warn({ err }, "IA indisponible — template neutre utilisé");
      return neutralTemplate(input);
    }
  };

  if (!smtp) return null;

  const channel = new EmailChannel(smtp, {
    unsubscribePublicUrl: env.UNSUBSCRIBE_PUBLIC_URL,
  });

  return {
    personalize,
    sendEmail: (msg) =>
      channel.send({ prospectId: "", channel: "email", body: msg.body, subject: msg.subject, to: msg.to, inReplyTo: msg.inReplyTo }),
    compliance: {
      senderName: smtp.fromName,
      senderActivity: settings.senderActivity,
      unsubscribePublicUrl: env.UNSUBSCRIBE_PUBLIC_URL,
    },
    aiModel: settings.aiModel,
  };
}

export async function registerEmailSequencerJob(boss: PgBoss, env: Env): Promise<void> {
  const db = getDb(env.DATABASE_URL);

  async function tick(): Promise<void> {
    if (await isAutomationPaused(db)) {
      logger.info("email-sequencer : pause générale (STOP) — tick ignoré");
      return;
    }
    const deps = await buildSequencerDeps(env);
    if (!deps) {
      logger.warn("email-sequencer : SMTP non configuré (.env) — aucun envoi possible");
      return;
    }
    const initial = await planInitialEmails(db, deps);
    const relances = await planRelances(db, deps);
    const report = await sendDueEmails(db, deps);
    if (initial || relances || report.sent || report.failed || report.rescheduled) {
      logger.info({ initial, relances, ...report }, "email-sequencer : tick");
    }
  }

  await boss.work(QUEUES.emailSequencer, async () => {
    await tick();
  });
  await boss.work(QUEUES.emailSend, async () => {
    await tick();
  });
  await boss.schedule(QUEUES.emailSend, "*/5 * * * *", undefined, { tz: env.TZ });
}
