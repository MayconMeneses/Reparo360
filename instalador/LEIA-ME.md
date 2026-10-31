# Instalador do Reparo360

Instala e liga o sistema **neste computador** (uso local). Tudo fica dentro desta pasta, exceto os anexos, guardados em `%LOCALAPPDATA%\Reparo360\anexos` (fora do OneDrive de propósito).

## Como usar

1. Dê dois cliques em **`Instalar-Reparo360.exe`** (na pasta principal).
2. Responda às perguntas. A mais importante: criar o **administrador Master** (e-mail, nome e senha de pelo menos 14 caracteres).
3. O instalador mostra uma **chave do autenticador**. Cadastre-a no aplicativo autenticador do celular (Google Authenticator, Microsoft Authenticator, Authy…) **na hora**: ela só aparece uma vez.
4. Ao terminar, o sistema abre no navegador em `http://localhost:3000`. A administração fica em `http://localhost:3000/master`.

Depois disso:

| Quero | Use |
|---|---|
| Ligar o sistema de novo (outro dia) | `Iniciar-Reparo360.exe` (ou o atalho na Área de Trabalho) |
| Desligar | `Parar-Reparo360.exe` (os dados ficam guardados) |
| Reinstalar / reparar | `Instalar-Reparo360.exe` de novo. É seguro: não apaga dados e não troca o `.env` |

## O que o instalador faz (em ordem)

1. Confere **Node.js 22+**, **Docker Desktop** e **pnpm**. Se faltar Node ou Docker, oferece instalar pelo `winget` (só com a sua confirmação; depois peça para rodar o instalador de novo).
2. Cria o arquivo `.env` com **senhas e chaves aleatórias** (só se ele não existir; nunca sobrescreve).
3. Sobe o banco PostgreSQL em Docker (acessível só neste computador, porta 54329).
4. Instala as dependências, compila o sistema e cria as tabelas.
5. Cria o administrador Master (se você quiser).
6. Liga o sistema e abre o navegador.

## Requisitos

- Windows 10/11 com internet na primeira instalação (para baixar as dependências).
- **Docker Desktop** instalado e com a virtualização habilitada.
- ~3 GB livres.

## Perguntas comuns

**O Windows avisou "app não reconhecido" (SmartScreen).** Os `.exe` não são assinados digitalmente (assinatura exige um certificado pago). Eles são pequenos lançadores: o código-fonte está em `instalador\launcher\Launcher.cs` e só chamam os scripts `.ps1` desta pasta. Você pode conferir e refazer os `.exe` rodando `instalador\construir-exe.ps1`.

**Perdi o celular com o autenticador.** Rode no PowerShell, na pasta do projeto, definindo as variáveis só para este comando:
`$env:MASTER_EMAIL='...'; $env:MASTER_NAME='...'; $env:MASTER_PASSWORD='...'; $env:MASTER_REENROLL='true'; pnpm master:create`
Isso gera uma chave nova e troca a senha. É por isso que o acesso ao servidor deve ser protegido.

**Onde ficam os dados?** Banco: volume do Docker (`reparo360_pgdata`). Anexos: `%LOCALAPPDATA%\Reparo360\anexos`. Senhas e chaves: arquivo `.env`. **Faça cópia do `.env` e dos dois itens anteriores** (veja `docs/security/BACKUP_RECOVERY.md`; o backup de anexos ainda é manual).

**Isto serve para colocar na internet?** Não como está. É uma instalação local (`localhost`). Para uso real em rede é preciso HTTPS, hospedagem e backup definidos (decisão P-01 em `docs/DECISOES_PENDENTES.md`).

**Como criar uma assistência (cliente)?** Entre em `/master`, use **Criar assistência**. O sistema gera uma senha temporária mostrada uma vez; o proprietário é obrigado a trocá-la no primeiro acesso.

**Desinstalar.** Rode `Parar-Reparo360.exe` e apague a pasta. Isso **não** remove o volume do banco nem os anexos; para apagar tudo de vez, é preciso removê-los de propósito (`docker compose down -v` na pasta do projeto, e a pasta de anexos). Faça isso só se tiver certeza: os dados somem para sempre.

## Arquivos desta pasta

- `instalar.ps1`, `iniciar.ps1`, `parar.ps1`: os scripts que fazem o trabalho.
- `comum.ps1`: funções compartilhadas.
- `launcher\Launcher.cs` e `construir-exe.ps1`: código e receita dos `.exe`.
- `logs\`: registro dos passos do instalador e do servidor (sem senhas). Esta pasta não vai para o Git.
