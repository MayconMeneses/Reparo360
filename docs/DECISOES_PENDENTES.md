# Decisões pendentes

Itens abaixo dependem do dono do produto, jurídico ou comercial. Não foram assumidos. Cada um traz recomendação técnica para destravar o trabalho.

| ID | Decisão | Alternativas | Impacto | Recomendação | Bloqueia |
|---|---|---|---|---|---|
| P-01 | Hospedagem do piloto (provedor, região) | VPS + Docker; PaaS gerenciado; nuvem grande | custo, backup, LGPD (localização dos dados) | PaaS ou VPS no Brasil/região adequada, definir após estimativa | Fase 7 |
| P-02 | Armazenamento de arquivos | S3 AWS; Cloudflare R2; MinIO próprio | custo, backup | S3-compatível gerenciado com bucket privado; MinIO só em dev | Fase 2 (uploads) |
| P-03 | Canal de verificação do consumidor (aprovação remota) | e-mail OTP; WhatsApp Business; SMS | custo, provedor, aceite de contrato | e-mail OTP primeiro (menor custo). Sem provedor, só aprovação presencial | RF-013 em produção |
| P-04 | Nome/domínio, remoto Git e contas | — | publicação | criar após aprovação; nada será publicado sem autorização | publicação |
| P-05 | Conteúdo mínimo legal do orçamento/comprovantes (CDC) | revisão jurídica própria vs. checklist padrão | risco legal | revisão por advogado antes do piloto | Fase 3 final |
| P-06 | Base legal LGPD, papéis controlador/operador, termos e política de privacidade | — | contrato, privacidade | parecer jurídico; plataforma como operadora para dados dos clientes finais é hipótese a validar | piloto |
| P-07 | Formato do protocolo | sequencial por ano `2026-000123`; curto aleatório | usabilidade vs. previsibilidade | sequencial por tenant/ano; não é credencial (RN-001) | Fase 2 |
| P-08 | Senha/PIN de desbloqueio do aparelho | não armazenar; campo temporário criptografado; apenas "informada/não informada" | privacidade | apenas flag "senha informada" no MVP | Fase 2 |
| P-09 | Orçamento sobre diagnóstico apenas "suspeita" | proibir; permitir com autorização explícita | risco comercial | permitir com marcação e autor | Fase 3 |
| P-10 | Limite de desconto por papel | sem limite; % por papel; valor absoluto | controle financeiro | configurável por tenant; padrão: G até 10%, P ilimitado, A 0% | Fase 3 |
| P-11 | Validade padrão do orçamento | 3, 7, 15 dias | conversão | 7 dias configurável | Fase 3 |
| P-12 | Técnico vê fila geral ou só atribuídas | só atribuídas; fila + atribuídas | privacidade vs. produtividade | só atribuídas + fila de não atribuídas sem dados pessoais | Fase 3 |
| P-13 | Técnico pode criar orçamento | sim; só rascunho; não | fluxo | rascunho pelo técnico, envio por atendente/gerente | Fase 3 |
| P-14 | RPO/RTO | a definir com custo e volume | custo de backup | definir após estimar volume do piloto | Fase 6 |
| P-15 | Retenção de dados e fotos | prazos por categoria | LGPD, custo | definir com P-06 | Fase 6 |
| P-16 | Planos e preços | — | comercial | fora do MVP | Fase 8 |
| P-17 | Política de ENTREGUE → ENCERRADA (manual ou automática após N dias) | manual; automática | histórico | manual no MVP | Fase 4 |
| P-18 | Como o novo membro recebe acesso (Fase 1 usa senha inicial definida por quem cadastra) | convite por e-mail com link de definição de senha; senha inicial com troca obrigatória no 1º login | segurança e usabilidade; depende de P-03 | convite por e-mail assim que P-03 estiver decidido. Até lá, senha inicial provisória | produção |
| P-19 | Resposta 409 `EMAIL_JA_CADASTRADO` em cadastro de assistência e de membro revela que o e-mail existe | manter com rate limit; resposta genérica + confirmação por e-mail | enumeração de contas | resposta genérica quando houver canal de e-mail (P-03) | piloto |
| P-20 | Rate limit atual é em memória, por IP, instância única; sem bloqueio por conta | Redis/PostgreSQL para limite compartilhado; atraso progressivo por conta | força bruta distribuída, múltiplas instâncias | limite por conta + armazenamento compartilhado antes de rodar mais de uma instância | Fase 6 |
| P-21 | Recuperação de senha | por e-mail (depende de P-03); presencial pelo proprietário | acesso | por e-mail após P-03 | piloto |

## Atualizações da Fase 2 (2026-10-30)

| ID | Situação | Observação |
|---|---|---|
| P-07 | **Decidido** (recomendação seguida) | Protocolo `AAAA-NNNNNN`, sequencial por empresa e ano, ano no fuso America/Sao_Paulo. Não é credencial. |
| P-08 | **Decidido** (recomendação seguida) | Só a marca "senha informada". A senha nunca é recebida nem armazenada; o campo extra é rejeitado. |
| P-02 | **Parcial** | Interface de armazenamento + adaptador em disco privado (fora do OneDrive). **Adaptador S3 não implementado nem testado** (NOT_RUN). Segue aberto até P-01 (hospedagem). |
| P-12 | **Adiado para a Fase 3** | Técnico vê só OS atribuídas. A fila de OS sem técnico (sem dados pessoais) depende da transição "assumir OS" da máquina de estados. |
| P-22 | Novo | Varredura de arquivos órfãos (queda do processo entre gravar o arquivo e confirmar a transação) e política de retenção de anexos excluídos logicamente. |
| P-23 | Novo | Remoção de EXIF/GPS das fotos e verificação de malware nos anexos (spec 22.3). Exige biblioteca de imagem; não implementado. |
| P-24 | Novo | Conteúdo jurídico do comprovante (cláusulas, prazo de guarda do equipamento). Depende de P-05. O comprovante atual só registra o recebimento e informa que não é documento fiscal. |

## Atualizações da Fase 3 (2026-10-30)

| ID | Situação | Observação |
|---|---|---|
| P-03 | **Segue aberto. RF-013 (aprovação remota) BLOQUEADO** | Sem provedor de envio, o sistema não simula códigos. Só existe a aprovação **presencial**. O esquema aceita `channel = 'remoto'`, mas nada o grava. |
| P-09 | **Decidido** (recomendação seguida) | Orçar sobre diagnóstico apenas "suspeita" exige `authorizeSuspicion` explícito; fica gravado quem autorizou (`suspicion_authorized_by`). Diagnóstico inconclusivo nunca sustenta orçamento. |
| P-10 | **Decidido com desvio** | Padrões: proprietário sem limite, gerente até 10%, atendente e técnico 0%. A recomendação pedia valor **configurável por empresa**; hoje os limites são constantes no domínio (`maxDiscountPercent`). Configuração por empresa exige `tenant_settings` (pendente). |
| P-11 | **Decidido** (recomendação seguida) | Validade padrão de 7 dias (1 a 30 no envio). Configuração por empresa pendente (mesmo motivo de P-10). |
| P-12 | **Entregue** | Fila de OS recebidas e sem técnico (sem nome do cliente e sem o texto livre do defeito) + "assumir OS" com disputa resolvida por atualização condicional. |
| P-13 | **Decidido** (recomendação seguida) | Técnico cria e edita **rascunho**; enviar, revisar e decidir ficam com atendente/gerente/proprietário. |
| P-25 | Novo | Agendador da expiração automática de orçamentos. Hoje a expiração ocorre na tentativa de decisão ou por `POST /quotes/expire-due`. Sem agendador, um orçamento vencido sem ninguém tocar continua `enviado` e a OS em `AGUARDANDO_APROVACAO`. |
| P-26 | Novo | Quantidade de item só inteira (sem horas fracionadas). Confirmar se a mão de obra por hora fracionada é necessária. |
| P-27 | Novo | Versão do orçamento para o consumidor (PDF "orçamento" e "registro de aprovação") e elementos exigidos pelo CDC dependem de P-05 (revisão jurídica). |
