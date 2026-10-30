import PDFDocument from "pdfkit";
import { toWinAnsi } from "./pdf-text.js";

export interface ReceiptData {
  tenantName: string;
  protocol: string;
  receivedAt: Date;
  issuedAt: Date;
  receivedByName: string;
  customerName: string;
  customerPhone: string;
  device: { category: string; brand: string; model: string; color: string | null; serialNumber: string | null; imei: string | null };
  reportedDefect: string;
  physicalCondition: string;
  accessories: string[];
  checklist: Array<{ item: string; result: string }>;
  passwordInformed: boolean;
}

const RESULT_LABEL: Record<string, string> = {
  funcionando: "Funcionando",
  com_defeito: "Com defeito",
  nao_testado: "Não testado",
  nao_aplicavel: "Não se aplica",
};

const dateTime = (value: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(value);

function formatPhone(digits: string): string {
  return digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

export function buildReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // compress:false mantém o conteúdo auditável nos testes; o documento tem uma página.
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      compress: false,
      info: {
        Title: toWinAnsi(`Comprovante de recebimento ${data.protocol}`),
        Subject: data.protocol,
        Creator: "Reparo360",
        Producer: "Reparo360",
        CreationDate: data.issuedAt,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const text = (value: string) => toWinAnsi(value);
    const field = (label: string, value: string) => {
      doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(text(value));
    };
    const heading = (value: string) => {
      doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).text(text(value));
      doc.moveDown(0.2);
    };

    doc.font("Helvetica-Bold").fontSize(16).text(text(data.tenantName));
    doc.font("Helvetica").fontSize(13).text("Comprovante de recebimento");
    doc.moveDown(0.5);
    field("Protocolo", data.protocol);
    field("Recebido em", dateTime(data.receivedAt));
    field("Recebido por", data.receivedByName);

    heading("Cliente");
    field("Nome", data.customerName);
    field("Telefone", formatPhone(data.customerPhone));

    heading("Equipamento");
    field("Tipo", data.device.category);
    field("Marca / modelo", `${data.device.brand} ${data.device.model}`);
    if (data.device.color) field("Cor", data.device.color);
    if (data.device.serialNumber) field("Número de série", data.device.serialNumber);
    if (data.device.imei) field("IMEI", data.device.imei);

    heading("Defeito relatado pelo cliente");
    doc.font("Helvetica").fontSize(10).text(text(data.reportedDefect));

    heading("Estado do equipamento na entrada");
    doc.font("Helvetica").fontSize(10).text(text(data.physicalCondition));
    doc.moveDown(0.3);
    field("Acessórios", data.accessories.length > 0 ? data.accessories.join(", ") : "nenhum informado");
    field("Senha do aparelho informada", data.passwordInformed ? "sim" : "não");

    heading("Checklist de entrada");
    if (data.checklist.length === 0) doc.font("Helvetica").fontSize(10).text("Nenhum item registrado.");
    for (const entry of data.checklist) {
      doc.font("Helvetica").fontSize(10).text(text(`${entry.item}: ${RESULT_LABEL[entry.result] ?? entry.result}`));
    }

    doc.moveDown(1.5).font("Helvetica-Oblique").fontSize(8).fillColor("#555555");
    doc.text("Este comprovante registra o recebimento do equipamento e não é documento fiscal.");
    doc.text(`Emitido em ${dateTime(data.issuedAt)}.`);
    doc.end();
  });
}
