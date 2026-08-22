import type { OutboundMessage, SendResult, SmtpConfig } from "@prospection/core";
import nodemailer from "nodemailer";
import type { OutreachChannel } from "./types.js";

/** Sous-ensemble du transport Nodemailer — injectable pour les tests. */
export interface MailTransport {
  sendMail(mail: {
    from: { name: string; address: string };
    to: string;
    subject?: string;
    text: string;
    headers?: Record<string, string>;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string }>;
}

export interface EmailSendExtras {
  to: string;
  /** Message-ID du message initial (relance : threading propre). */
  inReplyTo?: string;
}

/**
 * EmailChannel — seul canal en mode `auto` de la V1 (§5).
 * En-tête List-Unsubscribe: <mailto:…?subject=STOP> sur chaque envoi.
 */
export class EmailChannel implements OutreachChannel {
  readonly id = "email" as const;
  readonly mode = "auto" as const;
  private readonly transport: MailTransport;

  constructor(
    private readonly smtp: SmtpConfig,
    opts: { transport?: MailTransport; unsubscribePublicUrl?: string } = {},
  ) {
    this.unsubscribePublicUrl = opts.unsubscribePublicUrl;
    this.transport =
      opts.transport ??
      nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });
  }

  private readonly unsubscribePublicUrl?: string;

  async send(msg: OutboundMessage & EmailSendExtras): Promise<SendResult> {
    try {
      const listUnsubscribe = [
        `<mailto:${this.smtp.fromAddress}?subject=STOP>`,
        this.unsubscribePublicUrl ? `<${this.unsubscribePublicUrl}>` : null,
      ]
        .filter(Boolean)
        .join(", ");

      const info = await this.transport.sendMail({
        from: { name: this.smtp.fromName, address: this.smtp.fromAddress },
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
        headers: {
          "List-Unsubscribe": listUnsubscribe,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        inReplyTo: msg.inReplyTo,
        references: msg.inReplyTo,
      });
      return { ok: true, smtpMessageId: info.messageId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
