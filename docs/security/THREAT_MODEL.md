# Modelo de ameaças (STRIDE resumido)

Escopo: API, banco, armazenamento de arquivos, portal do consumidor, PWA, painel Master.
Ativos: dados de clientes e aparelhos, orçamentos e decisões, fotos, credenciais/sessões, trilha de auditoria.
Fronteiras de confiança: navegador do consumidor, navegador da equipe, API, banco, storage S3, provedor de envio (futuro).

| ID | Ameaça | Vetor | Controle exigido | Teste |
|---|---|---|---|---|
| SEC-001 | Vazamento entre tenants (BOLA/IDOR) | trocar UUID/consulta sem filtro | `tenant_id` da sessão; autorização por recurso; RLS; FK composta; resposta 404 | CT-SEC-001: Assistência A tenta ler/editar/listar tudo de B por API e SQL |
| SEC-002 | Contornar RLS | role do banco com BYPASSRLS ou contexto vazando na conexão reutilizada | role da aplicação sem privilégio; `SET LOCAL` por transação; migrações com role separada | CT-SEC-002 |
| SEC-003 | Escalação de privilégio | chamar rota sem permissão; mass assignment | checagem no servidor por permissão; schemas estritos (campos não listados rejeitados) | CT-SEC-003 |
| SEC-004 | Roubo/fixação de sessão | XSS, cookie sem flags | cookie opaco `HttpOnly; Secure; SameSite`; rotação no login; revogação; sem `localStorage` | CT-SEC-004 |
| SEC-005 | CSRF | formulário em site terceiro | SameSite + token CSRF em métodos mutáveis; checagem de Origin | CT-SEC-005 |
| SEC-006 | Força bruta / credential stuffing | login, recuperação, verificação do consumidor | rate limit por IP+conta, atraso progressivo, Argon2id, respostas uniformes | CT-SEC-006 |
| SEC-007 | Enumeração de protocolos/tokens | iterar protocolo no portal | token ≥128 bits, hash no banco, protocolo não é credencial, limite de tentativas | CT-SEC-007 |
| SEC-008 | Aprovação fraudulenta ou repetida | reuso de link, replay, versão antiga | verificação do consumidor, vínculo à versão, idempotência, expiração | CT-SEC-008 |
| SEC-009 | Adulteração de valores | enviar total/preço pelo cliente | cálculo no servidor, centavos inteiros, orçamento enviado imutável | CT-SEC-009 |
| SEC-010 | Upload malicioso | arquivo executável/polyglot, XXL | lista positiva, assinatura (magic bytes), limite de tamanho, nome interno, bucket privado, URL temporária só após autorização | CT-SEC-010 |
| SEC-011 | XSS / injeção | campos de texto, nomes de arquivo | escape por padrão no React, CSP estrita, queries parametrizadas | CT-SEC-011 |
| SEC-012 | SSRF | URLs fornecidas pelo usuário | sem fetch de URL arbitrária no MVP | revisão de código |
| SEC-013 | Vazamento de token em log/header | URL com token no portal | token no path com `Referrer-Policy: no-referrer`, redação em logs, `noindex` | CT-SEC-013 |
| SEC-014 | Acesso silencioso do Master | suporte entra em tenant | sem impersonação oculta; grant com prazo, escopo e auditoria | CT-SEC-014 |
| SEC-015 | Dependência vulnerável / supply chain | pacote comprometido | lockfile, `npm audit`, secret scan, revisão de novas dependências | pipeline |
| SEC-016 | Perda ou corrupção de dados | falha, erro humano, ransomware | backup criptografado e imutável, restauração testada, migrações não destrutivas | CT-OPS-001 |
| SEC-017 | Condição de corrida em OS/orçamento | dois técnicos, duplo clique | versão otimista, transações, idempotência | CT-SEC-017 |
| SEC-018 | Segredos expostos | `.env` no repositório | segredos fora do Git, `.env.example` sem valores reais, secret scanning | pipeline |
| SEC-019 | Takeover do Master | senha roubada | MFA obrigatório, reautenticação, auditoria | CT-SEC-019 |

## Premissas e limites
- Sem declaração de conformidade formal (ASVS, LGPD etc.) até haver evidência por requisito.
- DAST só em homologação própria, com dados sintéticos.
- Resposta a incidentes será detalhada em `INCIDENT_RESPONSE.md` na Fase 6, com prazos legais verificados na data.
