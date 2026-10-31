# Relatório — Fase 5B (Telas de operação)

Complemento da Fase 5: a interface passa a cobrir o atendimento completo, sem usar a API diretamente.

## Resultado dos gates

| Gate | Estado | Evidência |
|---|---|---|
| Typecheck, lint, build | PASS | `pnpm typecheck`, `pnpm lint`, `pnpm build`, saída 0 |
| Testes de domínio | PASS | 51/51 |
| Testes do frontend | PASS | 29/29 (dinheiro, ações por papel, formulários, duplicidade, clique duplo, abas, axe) |
| Testes de banco | PASS | 63/63 |
| Testes de API | PASS | 197/197 (inclui a nova lista de técnicos) |
| Limite de linhas | PASS | 167 arquivos, nenhum acima de 300 |
| Auditoria | PASS | `pnpm audit` e `--prod`: 0 |
| Backup e restauração | PASS | 28 políticas idênticas após restaurar |
| Ciclo completo no navegador | PASS | ver abaixo |

**Total: 340 testes, 340 passaram.**

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
