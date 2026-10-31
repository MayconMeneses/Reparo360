# Instalador do Reparo360 (uso local). Seguro para rodar de novo: nunca apaga dados nem sobrescreve o .env.
# Modo sem perguntas (testes/automação): -Silencioso, com MASTER_EMAIL, MASTER_NAME e MASTER_PASSWORD no ambiente.
param([switch]$Silencioso, [switch]$NaoAbrirNavegador)

. (Join-Path $PSScriptRoot 'comum.ps1')
Set-Location $script:Raiz

Write-Host ''
Write-Host '  Reparo360 - instalador' -ForegroundColor White
Write-Host ('  Pasta: ' + $script:Raiz)
Escrever-Log '--- instalação iniciada'

# ---------------------------------------------------------------- 1. Programas necessários
Passo '1/7  Verificando os programas necessários'

if ($script:Raiz.Length -gt 100) {
    Aviso ('O caminho desta pasta é longo (' + $script:Raiz.Length + ' caracteres). O Windows limita caminhos a 260 e a instalação das dependências pode falhar. Se falhar, mova a pasta para algo curto, como C:\Reparo360.')
}
if ($script:Raiz -match 'OneDrive') {
    Aviso 'Esta pasta é sincronizada pelo OneDrive. Funciona, mas a instalação fica lenta e o OneDrive pode travar arquivos. O ideal é uma pasta fora do OneDrive.'
}

function Oferecer-Instalacao([string]$nome, [string]$id) {
    if (-not (Tem-Comando 'winget')) { Falhar ($nome + ' não encontrado e o winget não está disponível. Instale ' + $nome + ' manualmente e rode de novo.') }
    if (-not (Perguntar-SimNao ($nome + ' não foi encontrado. Instalar agora com o winget?') $false $Silencioso)) {
        Falhar ($nome + ' é necessário. Instale e rode o instalador de novo.')
    }
    & winget install -e --id $id --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { Falhar ('A instalação de ' + $nome + ' falhou.') }
    Write-Host ''
    Write-Host ($nome + ' instalado. Feche esta janela e abra o instalador de novo para continuar.') -ForegroundColor Yellow
    exit 0
}

if (-not (Tem-Comando 'node')) { Oferecer-Instalacao 'Node.js' 'OpenJS.NodeJS.LTS' }
$versaoNode = [version]((& node -v).TrimStart('v'))
if ($versaoNode.Major -lt 22) { Falhar ('Node.js 22 ou mais novo é necessário (encontrado ' + $versaoNode + ').') }
Ok ('Node.js ' + $versaoNode)

if (-not (Tem-Comando 'docker')) { Oferecer-Instalacao 'Docker Desktop' 'Docker.DockerDesktop' }
Garantir-Docker $Silencioso

if (-not (Tem-Comando 'pnpm')) {
    Aviso 'pnpm não encontrado. Preparando pelo corepack...'
    if (Tem-Comando 'corepack') { & corepack enable; & corepack prepare 'pnpm@11.24.0' --activate }
    if (-not (Tem-Comando 'pnpm')) { & npm install -g 'pnpm@11.24.0' }
    if (-not (Tem-Comando 'pnpm')) { Falhar 'Não foi possível preparar o pnpm.' }
}
Ok ('pnpm ' + (& pnpm -v))

# ---------------------------------------------------------------- 2. Configuração (.env)
Passo '2/7  Preparando a configuração (.env)'
$arquivoEnv = Join-Path $script:Raiz '.env'
$valores = Ler-Env $arquivoEnv
$criado = $false
if ($valores.Count -eq 0) {
    $criado = $true
    $pastaDados = if ($env:REPARO360_DADOS) { $env:REPARO360_DADOS } else { Join-Path $env:LOCALAPPDATA 'Reparo360' }
    $anexos = ((Join-Path $pastaDados 'anexos') -replace '\\', '/')
    New-Item -ItemType Directory -Force -Path (Join-Path $pastaDados 'anexos') | Out-Null
    $portaBanco = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '54329' }
    $portaSistema = if ($env:PORT) { $env:PORT } else { '3000' }
    $superusuario = Novo-Segredo 24
    $migrador = Novo-Segredo 24
    $aplicacao = Novo-Segredo 24
    $dist = ((Join-Path $script:Raiz 'apps\web\dist') -replace '\\', '/')
    $linhas = @(
        '# Gerado pelo instalador. Contém segredos: não copie, não envie e não versione este arquivo.',
        ('POSTGRES_SUPERUSER_PASSWORD=' + $superusuario),
        ('MIGRATOR_PASSWORD=' + $migrador),
        ('APP_PASSWORD=' + $aplicacao),
        ('POSTGRES_PORT=' + $portaBanco),
        '',
        ('DATABASE_URL=postgres://reparo_app:' + $aplicacao + '@127.0.0.1:' + $portaBanco + '/reparo360_dev'),
        ('MIGRATION_DATABASE_URL=postgres://reparo_migrator:' + $migrador + '@127.0.0.1:' + $portaBanco + '/reparo360_dev'),
        ('TEST_DATABASE_URL=postgres://reparo_app:' + $aplicacao + '@127.0.0.1:' + $portaBanco + '/reparo360_test'),
        ('TEST_MIGRATION_DATABASE_URL=postgres://reparo_migrator:' + $migrador + '@127.0.0.1:' + $portaBanco + '/reparo360_test'),
        '',
        'HOST=127.0.0.1',
        ('PORT=' + $portaSistema),
        'COOKIE_SECURE=true',
        'ALLOW_PUBLIC_ONBOARDING=false',
        ('STORAGE_DIR=' + $anexos),
        ('WEB_DIST=' + $dist),
        'LOG_LEVEL=info',
        '',
        ('MASTER_ENC_KEY=' + (Novo-Segredo 32))
    )
    [System.IO.File]::WriteAllText($arquivoEnv, (($linhas -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    Ok '.env criado com senhas e chaves aleatórias (só existem neste computador)'
    Ok ('Anexos serão guardados em ' + $anexos)
} else {
    Ok '.env já existe e foi mantido'
    $faltando = @()
    if (-not $valores.ContainsKey('MASTER_ENC_KEY')) { $faltando += ('MASTER_ENC_KEY=' + (Novo-Segredo 32)) }
    if (-not $valores.ContainsKey('WEB_DIST')) { $faltando += ('WEB_DIST=' + ((Join-Path $script:Raiz 'apps\web\dist') -replace '\\', '/')) }
    if ($faltando.Count -gt 0) {
        Add-Content -Path $arquivoEnv -Value ("`n" + ($faltando -join "`n")) -Encoding UTF8
        Ok 'Itens que faltavam foram acrescentados ao .env'
    }
}
$valores = Ler-Env $arquivoEnv

# ---------------------------------------------------------------- 3. Banco de dados
Passo '3/7  Subindo o banco de dados (PostgreSQL em Docker)'
Subir-Banco

# ---------------------------------------------------------------- 4. Dependências e compilação
Passo '4/7  Instalando dependências (pode levar alguns minutos)'
Executar 'pnpm' @('install', '--frozen-lockfile') 'A instalação das dependências falhou'
Ok 'Dependências instaladas'

Passo '5/7  Compilando o sistema'
Executar 'pnpm' @('build') 'A compilação falhou'
Ok 'Sistema compilado'

# ---------------------------------------------------------------- 5. Migrações
Passo '6/7  Criando as tabelas do banco'
Executar 'pnpm' @('db:migrate') 'As migrações do banco falharam'
Ok 'Banco atualizado'

# ---------------------------------------------------------------- 6. Master
Passo '7/7  Administrador da plataforma (Master)'
function Ler-SenhaOculta([string]$rotulo) {
    $segura = Read-Host $rotulo -AsSecureString
    $ponteiro = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
}

$existe = $false
try {
    $consulta = 'SELECT count(*) FROM platform_admins'
    $contagem = & docker compose exec -T postgres psql -U postgres -d reparo360_dev -tA -c $consulta 2>$null
    $existe = ([int](($contagem | Select-Object -First 1).Trim()) -gt 0)
} catch { $existe = $false }

if ($existe) {
    Ok 'Já existe um administrador Master (nada a fazer)'
} elseif (Perguntar-SimNao 'Criar agora o administrador Master?' $true $Silencioso) {
    $email = $env:MASTER_EMAIL; $nome = $env:MASTER_NAME; $senha = $env:MASTER_PASSWORD
    if (-not $Silencioso) {
        $email = Read-Host 'E-mail do Master'
        $nome = Read-Host 'Nome do Master'
        do {
            $senha = Ler-SenhaOculta 'Senha do Master (mínimo 14 caracteres)'
            $confirma = Ler-SenhaOculta 'Repita a senha'
            if ($senha.Length -lt 14) { Aviso 'A senha precisa ter ao menos 14 caracteres.' }
            elseif ($senha -ne $confirma) { Aviso 'As senhas não conferem.' }
        } while ($senha.Length -lt 14 -or $senha -ne $confirma)
    }
    if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($nome) -or [string]::IsNullOrWhiteSpace($senha)) {
        Aviso 'Dados do Master incompletos: pulei esta etapa. Depois use: pnpm master:create'
    } else {
        $env:MASTER_EMAIL = $email; $env:MASTER_NAME = $nome; $env:MASTER_PASSWORD = $senha
        try {
            Write-Host ''
            Write-Host '  Cadastre AGORA a chave abaixo no seu aplicativo autenticador (ela aparece só desta vez):' -ForegroundColor Yellow
            Executar 'pnpm' @('master:create') 'Não foi possível criar o Master'
        } finally {
            Remove-Item Env:MASTER_EMAIL, Env:MASTER_NAME, Env:MASTER_PASSWORD -ErrorAction SilentlyContinue
            $senha = $null; $confirma = $null
        }
        Escrever-Log 'Master criado (dados não registrados)'
        Ok 'Master criado'
    }
} else {
    Aviso 'Pulado. Para criar depois: pnpm master:create (veja instalador\LEIA-ME.md)'
}

# ---------------------------------------------------------------- Atalhos e partida
$exeIniciar = Join-Path $script:Raiz 'Iniciar-Reparo360.exe'
if ((Test-Path $exeIniciar) -and (Perguntar-SimNao 'Criar um atalho na Área de Trabalho?' (-not $Silencioso) $Silencioso)) {
    try {
        $atalho = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Reparo360.lnk'))
        $atalho.TargetPath = $exeIniciar; $atalho.WorkingDirectory = $script:Raiz; $atalho.Save()
        Ok 'Atalho criado na Área de Trabalho'
    } catch { Aviso 'Não consegui criar o atalho (sem problema; use Iniciar-Reparo360.exe).' }
}

$porta = if ($valores.ContainsKey('PORT')) { $valores['PORT'] } else { '3000' }
Iniciar-Servidor $valores
Escrever-Log '--- instalação concluída'
Write-Host ''
Write-Host '  Instalação concluída.' -ForegroundColor Green
Write-Host ('  Sistema das assistências:  http://localhost:' + $porta)
Write-Host ('  Administração (Master):    http://localhost:' + $porta + '/master')
Write-Host '  Para abrir de novo depois: Iniciar-Reparo360.exe   |   Para desligar: Parar-Reparo360.exe'
if (-not $NaoAbrirNavegador -and -not $Silencioso) { Start-Process ('http://localhost:' + $porta + '/master') }
