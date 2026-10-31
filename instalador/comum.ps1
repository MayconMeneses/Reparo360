# Funções compartilhadas pelo instalador. Não execute este arquivo direto.
# Compatível com o Windows PowerShell 5.1 (o que vem no Windows).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:PastaLogs = Join-Path $PSScriptRoot 'logs'
$script:ArquivoPid = Join-Path $PSScriptRoot '.servidor.pid'
if (-not (Test-Path $script:PastaLogs)) { New-Item -ItemType Directory -Path $script:PastaLogs | Out-Null }
$script:Log = Join-Path $script:PastaLogs ('instalador-' + (Get-Date -Format 'yyyyMMdd') + '.log')

# O log guarda só os passos. Nunca senhas, chaves, URLs de banco nem a saída do cadastro do Master.
function Escrever-Log([string]$texto) {
    Add-Content -Path $script:Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $texto) -Encoding UTF8
}
function Passo([string]$texto) { Write-Host ''; Write-Host ('==> ' + $texto) -ForegroundColor Cyan; Escrever-Log $texto }
function Ok([string]$texto) { Write-Host ('    OK  ' + $texto) -ForegroundColor Green; Escrever-Log ('OK ' + $texto) }
function Aviso([string]$texto) { Write-Host ('    !   ' + $texto) -ForegroundColor Yellow; Escrever-Log ('AVISO ' + $texto) }
function Falhar([string]$texto) {
    Write-Host ''
    Write-Host ('ERRO: ' + $texto) -ForegroundColor Red
    Escrever-Log ('ERRO ' + $texto)
    Write-Host ('Detalhes dos passos: ' + $script:Log)
    throw $texto
}

function Tem-Comando([string]$nome) { return [bool](Get-Command $nome -ErrorAction SilentlyContinue) }

# Hexadecimal aleatório criptograficamente seguro (2 caracteres por byte).
function Novo-Segredo([int]$bytes) {
    $buffer = New-Object 'byte[]' $bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Perguntar-SimNao([string]$pergunta, [bool]$padrao, [bool]$silencioso) {
    if ($silencioso) { return $padrao }
    $sufixo = if ($padrao) { ' [S/n] ' } else { ' [s/N] ' }
    $resposta = Read-Host ($pergunta + $sufixo)
    if ([string]::IsNullOrWhiteSpace($resposta)) { return $padrao }
    return ($resposta.Trim().ToLower() -in @('s', 'sim', 'y', 'yes'))
}

function Esperar-Ate([scriptblock]$teste, [int]$segundos, [string]$descricao) {
    $limite = (Get-Date).AddSeconds($segundos)
    while ((Get-Date) -lt $limite) {
        try { if (& $teste) { return $true } } catch { }
        Start-Sleep -Seconds 2
    }
    Aviso ('Tempo esgotado esperando: ' + $descricao)
    return $false
}

# Executa um programa e para se ele falhar. A saída vai para a tela (não para o log).
function Executar([string]$programa, [string[]]$argumentos, [string]$erro) {
    Escrever-Log ('executando: ' + $programa + ' ' + ($argumentos[0]))
    & $programa @argumentos
    if ($LASTEXITCODE -ne 0) { Falhar ($erro + ' (código ' + $LASTEXITCODE + ')') }
}

function Ler-Env([string]$caminho) {
    $valores = @{}
    if (-not (Test-Path $caminho)) { return $valores }
    foreach ($linha in Get-Content -Path $caminho -Encoding UTF8) {
        if ($linha -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $valores[$Matches[1]] = $Matches[2] }
    }
    return $valores
}

function Docker-Pronto { & docker info *> $null; return ($LASTEXITCODE -eq 0) }

function Garantir-Docker([bool]$silencioso) {
    if (-not (Tem-Comando 'docker')) {
        Falhar 'Docker não encontrado. Instale o Docker Desktop (https://www.docker.com/products/docker-desktop) e rode este instalador de novo.'
    }
    if (Docker-Pronto) { Ok 'Docker está rodando'; return }
    $executavel = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if ((Test-Path $executavel) -and -not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Aviso 'Abrindo o Docker Desktop (pode levar alguns minutos)...'
        Start-Process -FilePath $executavel
    }
    if (-not (Esperar-Ate { Docker-Pronto } 240 'o Docker ficar pronto')) {
        Falhar 'O Docker não ficou pronto. Abra o Docker Desktop, espere ele terminar de iniciar e rode de novo.'
    }
    Ok 'Docker está rodando'
}

function Banco-Pronto {
    Push-Location $script:Raiz
    try {
        & docker compose exec -T postgres pg_isready -U postgres *> $null
        return ($LASTEXITCODE -eq 0)
    } finally { Pop-Location }
}

function Subir-Banco {
    Push-Location $script:Raiz
    try { Executar 'docker' @('compose', 'up', '-d') 'Não foi possível subir o banco de dados' } finally { Pop-Location }
    if (-not (Esperar-Ate { Banco-Pronto } 120 'o banco aceitar conexões')) { Falhar 'O banco de dados não ficou pronto.' }
    Ok 'Banco de dados pronto'
}

function Servidor-Rodando {
    if (-not (Test-Path $script:ArquivoPid)) { return $false }
    $id = [int](Get-Content $script:ArquivoPid -ErrorAction SilentlyContinue | Select-Object -First 1)
    $processo = Get-Process -Id $id -ErrorAction SilentlyContinue
    return [bool]($processo -and $processo.ProcessName -eq 'node')
}

function Iniciar-Servidor([hashtable]$config) {
    if (Servidor-Rodando) { Ok 'O sistema já estava rodando'; return }
    $entrada = Join-Path $script:Raiz 'apps\api\dist\server.js'
    if (-not (Test-Path $entrada)) { Falhar 'O sistema ainda não foi compilado. Rode o instalador.' }
    $porta = if ($config.ContainsKey('PORT')) { $config['PORT'] } else { '3000' }
    $saida = Join-Path $script:PastaLogs 'servidor.log'
    $erros = Join-Path $script:PastaLogs 'servidor-erros.log'
    $processo = Start-Process -FilePath 'node' -ArgumentList @('--env-file=.env', 'apps/api/dist/server.js') `
        -WorkingDirectory $script:Raiz -WindowStyle Hidden -PassThru -RedirectStandardOutput $saida -RedirectStandardError $erros
    Set-Content -Path $script:ArquivoPid -Value $processo.Id -Encoding ASCII
    $endereco = 'http://127.0.0.1:' + $porta + '/health'
    $subiu = Esperar-Ate { (Invoke-WebRequest -Uri $endereco -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } 60 'o sistema responder'
    if (-not $subiu) { Falhar ('O sistema não respondeu. Veja ' + $erros) }
    Ok ('Sistema rodando em http://localhost:' + $porta)
}
