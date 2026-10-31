# Relatório — Fase 5B (Telas de operação)

Complemento da Fase 5: a interface passa a cobrir o atendimento completo, sem usar a API diretamente.

## Resultado dos gates

| Gate | Estado | Evidência |
|---|---|---|
| Typecheck, lint, build | PASS | `pnpm typecheck`, `pnpm lint`, `pnpm build`, saída 0 |
| Testes de domínio | PASS | 51/51 |
| Testes do frontend | PASS | 34/34 (dinheiro, ações por papel, formulários, duplicidade, clique duplo, abas, equipe, axe) |
| Testes de banco | PASS | 63/63 |
| Testes de API | PASS | 197/197 (inclui a nova lista de técnicos) |
| Limite de linhas | PASS | 167 arquivos, nenhum acima de 300 |
| Auditoria | PASS | `pnpm audit` e `--prod`: 0 |
| Backup e restauração | PASS | 28 políticas idênticas após restaurar |
| Ciclo completo no navegador | PASS | ver abaixo |

**Total: 345 testes, 345 passaram** (51 + 34 + 63 + 197).

## O que foi entregue
- **Cadastro:** busca de clientes, novo cliente (com aviso de duplicidade sem fusão automática e botão "cadastrar mesmo assim"), página do cliente com equipamentos (IMEI validado) e abertura de OS a partir dali.
- **Nova OS:** cliente, equipamento, defeito, estado físico, acessórios, checklist de entrada (padrão "não testado"), prioridade e técnico (lista nova `GET /technicians`, só id e nome). Cada abertura usa uma `Idempotency-Key`: clique repetido ou queda de rede não duplica a OS.
- **OS em abas:** Resumo (atribuir técnico), Recebimento (fotos e PDF com envio, remoção lógica), Diagnóstico, Orçamento (editor de itens; digita "150,00" e envia 15000 centavos; total só como estimativa, o servidor calcula; enviar, revisar, decisão presencial), Reparo, Testes (rodadas), Entrega, Documentos (PDFs e link/QR do cliente) e Histórico.
- **Ações de estado** mostradas só quando o papel e o estado permitem, com motivo obrigatório e confirmação para ações difíceis de desfazer. É apresentação: o servidor valida de novo.
- **Mensagens de recusa** trazem os motivos do servidor (ex.: "há item não testado").

## Verificado no navegador (dados sintéticos, `http://localhost`)
Fluxo percorrido pela tela: cliente → equipamento (IMEI inválido recusado com mensagem, depois válido) → OS com técnico → diagnóstico → orçamento (estimativa R$ 241,80 / R$ 231,80 conferida contra o valor do servidor) → envio → decisão presencial → **tentativa de iniciar testes sem reparo (recusada)** → reparo → testes → **tentativa de aprovar sem rodada (recusada)** → rodada com item não testado (avisa) → rodada válida → aprovação → entrega (acessório faltando exigiu observação; botão ficou desabilitado até explicar) → encerramento (com aviso de confirmação) → tela somente leitura (sem ações, sem envio de arquivos) e histórico com 13 eventos.

## Defeitos achados e corrigidos
- Tela de login saía com o título "Dashboard". Corrigido.
- Recusa de "aprovar testes" não dizia o motivo. Corrigido (mostra os motivos enviados pelo servidor).
- Observação da entrega aparecia como "motivo" no histórico. Corrigido ("registro").
- Falha de teste minha: telas acumulavam entre testes (faltava limpeza explícita). Corrigido.

## NÃO verificado / limitações
- **Só o papel de proprietário foi percorrido no navegador.** Atendente, técnico e gerente foram cobertos por testes de API e pela lógica de ações, mas **não pela tela**.
- Parte das ações do fluxo foi disparada por script na página (o painel do navegador ficou oculto e sem viewport). Verifiquei o resultado pelo texto da tela e do servidor, mas **não houve captura de imagem nem teste com mouse/teclado reais nesta rodada**.
- Navegação por teclado completa, largura 320 a 1920 e alvos de toque **das telas novas** não foram medidos (só as telas da etapa anterior).
- Upload de foto, remoção de anexo, revisão de orçamento, aprovação de "peça indisponível", recusa de orçamento, cancelamento, retorno de testes reprovados e atribuição por gerente **não foram exercitados na tela** (só por API/testes).
- Sem teste E2E automatizado (Playwright) e sem Lighthouse. PWA instalável e câmera continuam NOT_RUN (P-34).
- Aprovação remota segue BLOQUEADA (P-03); política de privacidade e termos seguem BLOQUEADOS (P-06).
- Quantidade de item só inteira (P-26). Checklists de entrada e de testes usam itens padrão fixos (sem modelos por categoria).
- Tela de equipe só lista (não cria/edita membros pela interface); isso ainda exige a API.

## Próximos passos
Medir as telas novas em 320/768/1920 e por teclado; percorrer atendente e técnico na tela; teste E2E automatizado; depois a Fase 6 (segurança, recuperação e homologação).

## Complemento: verificação por papel, tamanho de tela e teclado

**Medido no navegador** (`http://localhost`, dados sintéticos; medição por código na própria página: rolagem horizontal, alvos de toque, nome acessível e um `h1` por tela):

| Verificação | Resultado |
|---|---|
| Proprietário, 11 telas, em **320, 375, 768, 1280 e 1920 px** | sem falhas |
| Atendente, técnico e gerente, 11 telas, em **375 px** | sem falhas |
| 9 abas da OS em **320 px** (OS em diagnóstico) | sem falhas |
| Formulários de **reparo, testes e entrega** em **320 px** (OS nesses estados) | sem falhas |
| Teclado | link "Ir para o conteúdo" é o primeiro foco; só a aba ativa é tabulável; setas, Home e End movem seleção e foco; painel ligado à aba; regra `:focus-visible` presente |

**Defeitos encontrados nesta verificação e corrigidos**
- Atendente e técnico abriam telas sem permissão digitando o endereço (mostravam busca misturada com erro, ou página sem título). Criada proteção por rota: mostra "Sem permissão" com título. O servidor já recusava os dados; isto corrige a tela.
- Link "Cadastrar novo cliente" com 24 px de altura (mínimo 44). Corrigido.
- Ao trocar de OS, a aba da OS anterior continuava aberta. Agora abre sempre no Resumo.
- A tela de equipe quebraria depois de 10 minutos (a API exige senha recente). Agora pede a senha.

**Tela de equipe (nova):** cadastrar membro, trocar função e desativar/reativar, só para proprietário e gerente. O gerente não vê ações sobre proprietário, outro gerente nem sobre si mesmo, e só pode criar atendente e técnico. A senha inicial vai no corpo da requisição, nunca na URL.

**Ainda NÃO medido / NOT_RUN**
- Gerente, atendente e técnico só em 375 px; **não** em 320, 768, 1280 e 1920 px.
- Contraste **renderizado** (o contraste foi calculado nos tokens, não medido na tela).
- Navegação por teclado feita por eventos de teclado simulados, **não** com um teclado e leitor de tela reais.
- Telas de bancada com a câmera (leitura de QR), upload de foto e PWA instalado continuam sem teste em aparelho.
- Lighthouse e teste E2E automatizado continuam NOT_RUN.
- Ação "Reprovar testes", "Cancelar", "Revisar orçamento", recusa e "peça indisponível" na tela continuam sem exercício manual.
