import { dateTime, formatPhone, renderPdf } from "./pdf-layout.js";

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

export const CHECKLIST_LABEL: Record<string, string> = {
  funcionando: "Funcionando",
  com_defeito: "Com defeito",
  nao_testado: "Não testado",
  nao_aplicavel: "Não se aplica",
};

export function buildReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return renderPdf(
    {
      title: `Comprovante de recebimento ${data.protocol}`,
      subject: data.protocol,
      issuedAt: data.issuedAt,
      footer: "Este comprovante registra o recebimento do equipamento e não é documento fiscal.",
    },
    (p) => {
      p.title(data.tenantName, "Comprovante de recebimento");
      p.field("Protocolo", data.protocol);
      p.field("Recebido em", dateTime(data.receivedAt));
      p.field("Recebido por", data.receivedByName);

      p.heading("Cliente");
      p.field("Nome", data.customerName);
      p.field("Telefone", formatPhone(data.customerPhone));

      p.heading("Equipamento");
      p.field("Tipo", data.device.category);
      p.field("Marca / modelo", `${data.device.brand} ${data.device.model}`);
      if (data.device.color) p.field("Cor", data.device.color);
      if (data.device.serialNumber) p.field("Número de série", data.device.serialNumber);
      if (data.device.imei) p.field("IMEI", data.device.imei);

      p.heading("Defeito relatado pelo cliente");
      p.paragraph(data.reportedDefect);

      p.heading("Estado do equipamento na entrada");
      p.paragraph(data.physicalCondition);
      p.field("Acessórios", data.accessories.length > 0 ? data.accessories.join(", ") : "nenhum informado");
      p.field("Senha do aparelho informada", data.passwordInformed ? "sim" : "não");

      p.heading("Checklist de entrada");
      if (data.checklist.length === 0) p.line("Nenhum item registrado.");
      for (const entry of data.checklist) p.line(`${entry.item}: ${CHECKLIST_LABEL[entry.result] ?? entry.result}`);
    },
  );
}
