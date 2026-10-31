import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "../config.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Falha fechada: sem envio configurado, `enabled` é falso e a aprovação remota não existe. */
export interface Mailer {
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
}

class DisabledMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error("envio de e-mail não configurado");
  }
}

class SmtpMailer implements Mailer {
  readonly enabled = true;
  private readonly transport: Transporter;

  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}

/** O coletor de testes fica fora de `src`: não existe caminho de produção que o instancie. */
export function createMailer(config: Config): Mailer {
  return config.smtpUrl && config.mailFrom ? new SmtpMailer(config.smtpUrl, config.mailFrom) : new DisabledMailer();
}
