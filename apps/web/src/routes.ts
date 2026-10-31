/** Endereços que a interface conhece (espelha apps/api/src/web-app.ts). Tudo fora disso é 404. */
const KNOWN = [
  /^\/$/, /^\/portal$/, /^\/ordens$/, /^\/ordens\/[0-9a-f-]{36}$/, /^\/clientes$/, /^\/equipamentos$/, /^\/orcamentos$/, /^\/equipe$/,
  /^\/configuracoes$/, /^\/bancada$/, /^\/etiqueta\/[0-9a-f-]{36}$/,
];
export const isKnownPath = (pathname: string): boolean => KNOWN.some((route) => route.test(pathname));

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Dashboard"], [/^\/ordens$/, "Ordens de serviço"], [/^\/ordens\//, "Ordem de serviço"], [/^\/clientes$/, "Clientes"],
  [/^\/equipamentos$/, "Equipamentos"], [/^\/orcamentos$/, "Orçamentos"], [/^\/equipe$/, "Equipe"], [/^\/configuracoes$/, "Configurações"],
  [/^\/bancada$/, "Bancada"], [/^\/etiqueta\//, "Etiqueta"],
];
/** Título único por tela (WCAG 2.4.2). */
export const titleFor = (pathname: string): string => `${TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Página não encontrada"} — Reparo360`;
