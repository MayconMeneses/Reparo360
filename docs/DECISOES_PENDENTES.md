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
