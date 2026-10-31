# Relatório — Fase 5 (Interfaces, portal do consumidor e PWA)

1. **Fase:** 5
2. **Objetivo:** dashboard, painel web, bancada, portal do consumidor, QR e PWA.
3. **Commit/branch:** `bb8301b` (etapa 1) e o commit desta etapa em `main` (`MayconMeneses/Reparo360`).
4. **Decisões aplicadas:** P-32 (validade e revogação do link), P-33 a P-37 registradas como novas. **P-03 segue aberto: o portal não aprova nem recusa.**

## Resultado dos gates

| Gate | Estado | Evidência (comando observado) |
|---|---|---|
| Typecheck | PASS | `pnpm typecheck`, saída 0 |
| Lint | PASS | `pnpm lint`, saída 0 |
| Testes de domínio | PASS | 51/51 |
| Testes do frontend | PASS | 14/14 (inclui axe e contraste dos temas) |
| Testes de banco | PASS | 63/63 |
| Testes de API | PASS | 195/195 em 18 arquivos |
| Build | PASS | `pnpm build` (API + web). JS principal 318,7 kB (101,5 kB gzip); portal em pacote separado de 4,2 kB (1,6 kB gzip); CSS 4,2 kB (1,4 kB gzip) |
| Limite de linhas (RNF-007) | PASS | 144 arquivos, nenhum acima de 300 |
| Auditoria de dependências | PASS | `pnpm audit` e `pnpm audit --prod`: 0 |
| Backup e restauração | PASS | 28 políticas e flags FORCE idênticas após restaurar |
| Verificação no navegador | PASS (parcial) | interface servida pela API em `localhost`, login real, 10 telas, portal real; ver abaixo |
| Instalação do PWA / service worker | **NOT_RUN** | o navegador do painel não registra service worker (nem um arquivo mínimo de teste); ver P-34 |
| Câmera/leitura de QR no celular, HTTPS real | **NOT_RUN** | exige aparelho e HTTPS |
| Lighthouse / desempenho medido | **NOT_RUN** | ferramenta indisponível nesta sessão (só tamanhos de pacote foram medidos) |
| E2E automatizado (Playwright) | **NOT_RUN** | não foi instalado; a verificação visual foi feita no navegador do painel |
| Aprovação remota (RF-013) | **BLOCKED** | P-03 |
| Agendador de expiração | **NOT_RUN** | P-25 |

**Total: 323 testes, 323 passaram** (51 + 14 + 63 + 195), contra PostgreSQL 17 real e dados sintéticos.

## O que foi entregue
- **Dashboard** (`GET /dashboard`, só proprietário e gerente): 7 indicadores, cada um com fonte, fórmula, unidade, o que entra e o que não entra. Período no fuso de São Paulo (início inclusivo, fim exclusivo). Tempo por etapa por mediana, e uma OS que volta à etapa gera outra amostra. Os números do cenário de teste foram calculados à mão **antes** das consultas. Nenhum indicador apresenta orçamento como faturamento.
- **Configurações da assistência** (`GET/PATCH /tenant`) e listas de **equipamentos** e **orçamentos** (o menu só tem itens com endpoint de verdade).
- **Link do consumidor:** token de 256 bits, só o hash no banco, validade de 30 dias, revogação, um ativo por OS, mostrado uma vez com QR.
- **Portal** (`GET /portal/order`, público e somente leitura): o token vai em **cabeçalho**, lido do **fragmento** da URL (`#t=`), nunca na linha de requisição; redigido dos logs; `Referrer-Policy: no-referrer`; `X-Robots-Tag: noindex`; limite por IP. Falha de qualquer tipo (aleatório, curto, ausente, expirado, revogado, substituído, OS encerrada) responde **exatamente igual**. Só aparecem campos de lista branca; sem aprovar/recusar.
- **Interface web** (`apps/web`, React): login, layout, temas claro/escuro/sistema, dashboard, ordens (com detalhe, link/QR e documentos), clientes, equipamentos, orçamentos, equipe, configurações, **bancada** (minhas ordens, fila, assumir OS, leitura de QR com alternativa manual por protocolo), **etiqueta** imprimível e **portal** em pacote separado. O token CSRF fica só em memória.
- **Servida pela própria API**, no mesmo domínio (cookie `SameSite=Strict`, sem CORS), com manipulador próprio e pequeno (sem dependência extra), proteção contra caminho fora da pasta, arquivos com hash imutáveis, HTML e service worker sem cache, **404 de verdade** para endereços inexistentes e `robots.txt` com `Disallow: /`.
- **PWA:** manifesto, 5 ícones, service worker que **nunca** toca em `/api/` (só `/assets/` e a página-casca) e aviso de nova versão. **Não verificado em instalação real** (ver acima).

## Defeitos e achados corrigidos nesta fase
- **Contraste da borda de campos:** o teste calculado por código achou 1,76:1 no tema claro (o mínimo é 3:1). Criei o token `control-border` e corrigi nos dois temas.
- **Alvos de toque:** medição no navegador achou o resumo "Como é calculado" com 24 px (mínimo 44). Corrigido.
- **Etiqueta sem título (`h1`)** e **telas sem título próprio**: corrigidos (título único por tela).
- **404 só para logados:** quem não estava logado caía no login em endereço inexistente. Corrigido (a página 404 com caminho de volta aparece sempre).
- **Dependência com vulnerabilidade em produção:** o `@fastify/static` trazia o `glob` vulnerável (`pnpm audit --prod` acusou). Substituí por um manipulador próprio e a auditoria zerou. Também forcei `minimatch` corrigido (ferramenta de lint).
- Falhas de teste, corrigidas na causa: teste do dashboard proibia a palavra "faturamento" até no aviso que diz que *não* é faturamento; lint não conhecia as globais do service worker.

## Verificado no navegador (Claude/Electron, `http://localhost`, contexto seguro)
- Login real e dashboard com os números semeados; 10 telas percorridas sem erro de interface.
- **Larguras 320, 768 e 1920 px:** nenhuma rolagem horizontal em nenhuma das telas (medido por código). **375 e 1280 não foram medidos.**
- Alvos de toque: 90 elementos interativos medidos; os únicos abaixo de 44 px eram os resumos, já corrigidos (**não remedido depois do ajuste**).
- Console: sem erros do app. Os únicos erros foram o 401 esperado de `/me` antes do login e a recusa do service worker pelo próprio navegador do painel.
- Portal aberto pelo link: situação, orçamento, andamento e telefone da assistência; sem nome do cliente, telefone dele ou defeito relatado.
- Capturas de tela ficaram instáveis (painel oculto); a verificação foi feita por leitura de página e medições por código.

## Checklist de 20 itens do site (`site-launch-checklist.md`)

| # | Item | Estado | Evidência |
|---|---|---|---|
| 1 | Política de privacidade | **BLOCKED (P-06/P-33)** | sem texto jurídico; não escrevi |
| 2 | Termos | **BLOCKED (P-06/P-33)** | idem |
| 3 | CTA limpa | OK | login com uma ação principal ("Entrar"); portal sem botões, só o telefone |
| 4 | FAQ | N/A | aplicação privada, sem fluxo de compra |
| 5 | robots.txt | OK | `Disallow: /`; `web.test.ts` e `curl` (200) |
| 6 | sitemap.xml | N/A | aplicação privada e `noindex` |
| 7 | 404 personalizado | OK | status 404 real + página com caminho de volta; `web.test.ts`, `curl`, navegador |
| 8 | Texto alternativo | OK | QR e imagens com `alt`; axe (`image-alt`) sem violações |
| 9 | Analytics | N/A (deliberado) | nenhuma medição instalada |
| 10 | Meta títulos | OK (com ressalva) | título único por tela (teste); páginas são privadas/`noindex`, então o foco é acessibilidade |
| 11 | Meta descrição | N/A | privado/`noindex`; há uma descrição genérica |
| 12 | Open Graph / Twitter Card | N/A | compartilhamento não é um objetivo; o portal tem `noindex` |
| 13 | Favicon | OK | 32, 180, 192, 512 e maskable (`curl`: 200, `image/png`); manifesto aponta para eles |
| 14 | URLs canônicas | N/A | `noindex` e sem conteúdo duplicado |
| 15 | Consentimento de cookies | N/A **com ressalva** | só cookie essencial de sessão, nada não essencial; confirmação jurídica pendente (P-06) |
| 16 | Versão mobile 320–1920 | OK (parcial) | sem rolagem horizontal em 320, 768 e 1920 (medido); 375 e 1280 não medidos |
| 17 | Acessibilidade | OK (parcial) | contraste AA dos dois temas por cálculo; axe estrutural (login e portal) sem violações; foco visível, link de pular, alvos 44 px. **Navegação completa por teclado não foi testada manualmente; contraste real renderizado não foi medido** |
| 18 | Formulários testados | OK (parcial) | login (sucesso, no navegador) e erros (API: 400/401/409/429). Configurações e demais formulários só pela API |
| 19 | Links quebrados | **NOT_RUN** (varredura) | navegação entre as 10 telas e o portal funciona; sem varredura automática |
| 20 | Desempenho | **NOT_RUN** (Lighthouse) | só tamanhos medidos: 101,5 kB gzip o JS principal |

## Limitações e desvios (declarados)
- **PWA:** instalação, offline e service worker **sem verificação real** (P-34). Offline mostra só a casca; sem rede o app cai no login (dados privados nunca são guardados no aparelho).
- **Bancada:** a leitura de QR por câmera usa `BarcodeDetector`, que não existe em todos os navegadores (ex.: Safari no iPhone); a busca manual por protocolo é a alternativa completa. **Não testada em aparelho.**
- **Portal sem decisão** (P-03/P-36); o link do consumidor precisa ser entregue pela assistência (sem envio automático).
- **Dashboard** calcula em memória (P-35); sem medição de desempenho.
- **Telas de escrita** da interface são poucas: a UI cobre consulta, link/QR, assumir OS, login e configurações. Criar cliente, abrir OS, diagnosticar, orçar, reparar e entregar **ainda não têm telas** (existem na API e nos testes). **A Fase 5 não entrega a operação completa pela interface.**
- Testes E2E de interface automatizados (Playwright) não foram feitos; a UI não tem teste de ciclo completo no navegador.
- Mutação não testada nos testes de concorrência (herdado). Pendências herdadas inalteradas: S3, backup de arquivos, EXIF, recuperação de senha, rate limit compartilhado, CI/CD, DAST/SAST, OpenAPI.

## Riscos residuais
Sem telas de escrita, a assistência ainda depende da API para operar. O link do consumidor é uma credencial de leitura: quem o recebe vê o andamento até a expiração ou revogação (mitigado por 30 dias, revogação e encerramento da OS).

## Próximos passos
Telas de operação (cadastro, abertura de OS, diagnóstico, orçamento, reparo, testes e entrega) e teste de ciclo completo no navegador; depois a Fase 6 (segurança, recuperação e homologação). Antes, decidir P-03 (canal de verificação), P-06 (textos legais) e validar P-32.

**Status: PENDENTE** — nenhum gate reprovou e os 323 testes passam, mas há itens NOT_RUN (instalação do PWA, câmera, Lighthouse, E2E), BLOCKED (RF-013, política e termos) e a interface ainda não cobre a operação completa. Não é "APROVADA".
