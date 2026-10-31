# Liga o banco e o sistema e abre o navegador. Pode ser rodado a qualquer momento.
param([switch]$NaoAbrirNavegador)

. (Join-Path $PSScriptRoot 'comum.ps1')
Set-Location $script:Raiz

$arquivoEnv = Join-Path $script:Raiz '.env'
if (-not (Test-Path $arquivoEnv)) { Falhar 'O sistema ainda não foi instalado. Rode Instalar-Reparo360.exe primeiro.' }
$valores = Ler-Env $arquivoEnv

Passo 'Ligando o Reparo360'
Garantir-Docker $false
Subir-Banco
# Aplica qualquer atualização de tabelas pendente (não faz nada se já está em dia).
Executar 'pnpm' @('db:migrate') 'As migrações do banco falharam'
Iniciar-Servidor $valores

$porta = if ($valores.ContainsKey('PORT')) { $valores['PORT'] } else { '3000' }
Write-Host ''
Write-Host ('  Reparo360 rodando em http://localhost:' + $porta) -ForegroundColor Green
if (-not $NaoAbrirNavegador) { Start-Process ('http://localhost:' + $porta) }
