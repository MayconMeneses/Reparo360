import PDFDocument from "pdfkit";
import { toWinAnsi } from "./pdf-text.js";

export const dateTime = (value: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(value);

export function formatPhone(digits: string): string {
  return digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

/** Peças de desenho compartilhadas pelos documentos. Todo texto passa por `toWinAnsi`. */
export interface Page {
  title(tenantName: string, documentName: string): void;
  field(label: string, value: string): void;
  heading(value: string): void;
  paragraph(value: string): void;
  line(value: string): void;
  /** Faixa de destaque (ex.: versão substituída ou expirada). */
  banner(value: string): void;
}

export interface PdfMeta {
  title: string;
  subject: string;
  issuedAt: Date;
  /** Última linha. Todo documento diz o que NÃO é (fiscal, pagamento etc.). */
  footer: string;
}

/**
 * compress:false mantém o conteúdo auditável nos testes; os documentos têm uma ou duas páginas.
 * O Info (Title/Subject) leva o protocolo em texto puro.
 */
export function renderPdf(meta: PdfMeta, draw: (page: Page) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      compress: false,
      info: { Title: toWinAnsi(meta.title), Subject: toWinAnsi(meta.subject), Creator: "Reparo360", Producer: "Reparo360", CreationDate: meta.issuedAt },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const text = toWinAnsi;
    const page: Page = {
      title(tenantName, documentName) {
        doc.font("Helvetica-Bold").fontSize(16).text(text(tenantName));
        doc.font("Helvetica").fontSize(13).text(text(documentName));
        doc.moveDown(0.5);
      },
      field(label, value) {
        doc.font("Helvetica-Bold").fontSize(10).text(`${text(label)}: `, { continued: true });
        doc.font("Helvetica").text(text(value));
      },
      heading(value) {
        doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).text(text(value));
        doc.moveDown(0.2);
      },
      paragraph(value) {
        doc.font("Helvetica").fontSize(10).text(text(value));
      },
      line(value) {
        doc.font("Helvetica").fontSize(10).text(text(value));
      },
      banner(value) {
        doc.moveDown(0.3).font("Helvetica-Bold").fontSize(11).fillColor("#a00000").text(text(value)).fillColor("#000000");
        doc.moveDown(0.3);
      },
    };
    draw(page);

    doc.moveDown(1.5).font("Helvetica-Oblique").fontSize(8).fillColor("#555555");
    doc.text(text(meta.footer));
    doc.text(`Emitido em ${dateTime(meta.issuedAt)}.`);
    doc.end();
  });
}
