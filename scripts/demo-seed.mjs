/* global fetch */
// Dados FICTÍCIOS de demonstração, criados só pela API (as mesmas regras e permissões do sistema).
// Uso: DEMO_EMAIL=... DEMO_PASSWORD=... [BASE_URL=http://localhost:4310] node scripts/demo-seed.mjs
// A conta é a do proprietário de uma assistência nova (veja "Demonstração" no README). Nada é gravado em arquivo;
// a senha do técnico de demonstração é aleatória e só existe durante a execução.
import { randomBytes } from "node:crypto";

const base = (process.env.BASE_URL ?? "http://localhost:4310").replace(/\/$/, "");
const email = process.env.DEMO_EMAIL;
const password = process.env.DEMO_PASSWORD;
if (!email || !password) {
  console.error("Defina DEMO_EMAIL e DEMO_PASSWORD (conta do proprietário da assistência de demonstração).");
  process.exit(1);
}

async function login(userEmail, userPassword) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  if (res.status !== 200) throw new Error(`login de ${userEmail} falhou (${res.status})`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { csrfToken } = await res.json();
  return async (method, path, body) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", origin: base, cookie, "x-csrf-token": csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    const json = text ? JSON.parse(text) : null;
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return json;
  };
}

const owner = await login(email, password);
const techEmail = `tecnico.${randomBytes(3).toString("hex")}@reparo360.invalid`;
const techPassword = `Demo-${randomBytes(12).toString("base64url")}-tec`;
const tech = await owner("POST", "/team/members", { name: "Rafael Técnico", email: techEmail, password: techPassword, role: "tecnico" });
const technician = await login(techEmail, techPassword);

const inspection = (defect) => ({
  physicalCondition: defect,
  accessories: ["carregador"],
  checklist: [{ item: "Tela", result: "com_defeito" }, { item: "Câmera", result: "nao_testado" }],
  passwordInformed: false,
});

async function open({ name, phone, device, defect, assign }) {
  const customer = await owner("POST", "/customers", { name, phone, confirmDuplicate: true });
  const dev = await owner("POST", `/customers/${customer.id}/devices`, device);
  const order = await owner("POST", "/work-orders", {
    customerId: customer.id, deviceId: dev.id, reportedDefect: defect, inspection: inspection(defect),
    ...(assign ? { technicianId: tech.userId } : {}),
  });
  return { id: order.id, name };
}

async function step(session, orderId, action) {
  const { version } = await session("GET", `/work-orders/${orderId}`);
  await session("POST", `/work-orders/${orderId}/transitions`, { action, expectedVersion: version });
}

const diagnose = (orderId, findings) =>
  technician("POST", `/work-orders/${orderId}/diagnostics`, {
    nature: "confirmado", symptoms: "Defeito relatado pelo cliente", checksPerformed: "Testes de bancada e inspeção visual", findings,
  });

async function sendQuote(orderId, items) {
  const draft = await owner("POST", `/work-orders/${orderId}/quotes`, {
    items, discountCents: 0, paymentTerms: "À vista ou cartão em até 3x", estimatedDays: 3,
  });
  const sent = await owner("POST", `/quotes/${draft.id}/submit`, { revision: draft.revision });
  return sent.quote.id;
}

const parts = (part, cents) => [
  { kind: "peca", description: part, quantity: 1, unitPriceCents: cents },
  { kind: "servico", description: "Mão de obra", quantity: 1, unitPriceCents: 6000 },
];

const phone = (n) => `(85) 99999-${String(n).padStart(4, "0")}`;

// 1) Só recebida.
await open({ name: "Ana Souza", phone: phone(101), device: { category: "celular", brand: "Samsung", model: "Galaxy A54" }, defect: "Tela trincada, touch falhando" });

// 2) Em diagnóstico.
const bruno = await open({ name: "Bruno Lima", phone: phone(102), device: { category: "notebook", brand: "Dell", model: "Inspiron 15" }, defect: "Não liga depois de queda", assign: true });
await step(owner, bruno.id, "iniciar_diagnostico");

// 3) Aguardando aprovação do orçamento.
const carla = await open({ name: "Carla Mendes", phone: phone(103), device: { category: "celular", brand: "Apple", model: "iPhone 12" }, defect: "Bateria descarrega rápido", assign: true });
await step(owner, carla.id, "iniciar_diagnostico");
await diagnose(carla.id, "Bateria com desgaste acima de 80%");
await sendQuote(carla.id, parts("Bateria", 18000));

// 4) Em reparo (orçamento aprovado em pessoa).
const diego = await open({ name: "Diego Rocha", phone: phone(104), device: { category: "notebook", brand: "Lenovo", model: "IdeaPad 3" }, defect: "Teclado com teclas sem resposta", assign: true });
await step(owner, diego.id, "iniciar_diagnostico");
await diagnose(diego.id, "Flat do teclado danificado");
const quote = await sendQuote(diego.id, parts("Teclado", 21000));
await owner("POST", `/quotes/${quote}/decision`, { decision: "aprovado", confirmedByName: "Diego Rocha" });

// 5) Pronta para retirada (reparo feito e testes aprovados).
const elaine = await open({ name: "Elaine Prado", phone: phone(105), device: { category: "tablet", brand: "Samsung", model: "Galaxy Tab A8" }, defect: "Não carrega", assign: true });
await step(owner, elaine.id, "iniciar_diagnostico");
await diagnose(elaine.id, "Conector de carga com mau contato");
const quote2 = await sendQuote(elaine.id, parts("Conector de carga", 9000));
await owner("POST", `/quotes/${quote2}/decision`, { decision: "aprovado", confirmedByName: "Elaine Prado" });
await technician("POST", `/work-orders/${elaine.id}/repairs`, { procedure: "Troca do conector de carga e limpeza", outcome: "concluido" });
await step(technician, elaine.id, "iniciar_testes");
await technician("POST", `/work-orders/${elaine.id}/test-checks`, {
  items: [{ item: "Carga", result: "aprovado" }, { item: "Tela", result: "aprovado" }, { item: "Câmera", result: "nao_aplicavel" }],
});
await step(technician, elaine.id, "aprovar_testes");

console.log("Dados de demonstração criados: 5 clientes, 5 ordens em etapas diferentes e 1 técnico fictício.");
