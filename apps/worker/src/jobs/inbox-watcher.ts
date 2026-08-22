import { createAIProvider } from "@prospection/ai";
import { parsedMailToInbound, processInboundEmail, type InboundDeps } from "@prospection/channels";
import {
  getDb,
  getImapConfig,
  getSettings,
  isAutomationPaused,
  logger,
  type Env,
} from "@prospection/core";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type PgBoss from "pg-boss";
import { QUEUES } from "./queues.js";

/**
 * Inbox watcher (§7.5) : polling IMAP toutes les 2 minutes.
 * Récupère les messages non lus, les parse (mailparser) et les traite
 * (threading, bounces, réponses auto, règles STOP, classification IA).
 * NB : la LECTURE des réponses reste active même en pause générale —
 * le STOP arrête les envois, pas la prise en compte des désinscriptions.
 */
export async function registerInboxWatcherJob(boss: PgBoss, env: Env): Promise<void> {
  const db = getDb(env.DATABASE_URL);

  async function buildDeps(): Promise<InboundDeps> {
    const settings = await getSettings(db);
    const provider = createAIProvider({
      provider: settings.aiProvider,
      model: settings.aiModel,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    });
    const aiAvailable = settings.aiProvider === "anthropic" && Boolean(env.ANTHROPIC_API_KEY);
    return {
      classify: async (input) => {
        if (!aiAvailable) return { classification: "A_VERIFIER", confidence: 0 };
        try {
          return await provider.classify(input);
        } catch (err) {
          logger.warn({ err }, "classification IA indisponible → A_VERIFIER");
          return { classification: "A_VERIFIER", confidence: 0 };
        }
      },
      draftReply: aiAvailable
        ? async ({ conversation }) => {
            const lastEntrant = [...conversation].reverse().find((m) => m.direction === "entrant");
            const out = await provider.personalize({
              prospect: { companyName: "" },
              channel: "email",
              kind: "brouillon_reponse",
              senderActivity: settings.senderActivity,
              conversation,
            });
            return lastEntrant ? { body: out.body } : null;
          }
        : undefined,
      aiModel: settings.aiModel,
    };
  }

  await boss.work(QUEUES.inboxWatcher, async () => {
    const imap = getImapConfig(env);
    if (!imap) {
      logger.debug("inbox-watcher : IMAP non configuré (.env) — polling ignoré");
      return;
    }
    const client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: imap.port === 993,
      auth: { user: imap.user, pass: imap.pass },
      logger: false,
    });
    const deps = await buildDeps();
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const unseen = await client.search({ seen: false });
        if (unseen && unseen.length > 0) {
          logger.info({ count: unseen.length }, "inbox-watcher : nouveaux messages");
          for await (const msg of client.fetch(unseen, { source: true, uid: true })) {
            try {
              const parsed = await simpleParser(msg.source!);
              const result = await processInboundEmail(db, deps, parsedMailToInbound(parsed));
              logger.info({ uid: msg.uid, outcome: result.outcome }, "inbox-watcher : traité");
              await client.messageFlagsAdd({ uid: String(msg.uid) }, ["\\Seen"], { uid: true });
            } catch (err) {
              logger.error({ err, uid: msg.uid }, "inbox-watcher : échec de traitement d'un message");
            }
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      logger.error({ err }, "inbox-watcher : erreur IMAP");
      try {
        await client.close();
      } catch {
        // déjà fermé
      }
    }
  });

  await boss.schedule(QUEUES.inboxWatcher, "*/2 * * * *", undefined, { tz: env.TZ });
  void isAutomationPaused; // la pause n'interrompt pas la lecture (désinscriptions)
}
