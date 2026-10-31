# Gera os três .exe (Instalar, Iniciar, Parar) a partir de instalador\launcher\Launcher.cs.
# Usa o compilador C# que já vem no Windows (.NET Framework 4): não precisa instalar nada.
. (Join-Path $PSScriptRoot 'comum.ps1')

$compilador = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compilador)) { Falhar 'Compilador C# do Windows não encontrado.' }
$fonte = Join-Path $PSScriptRoot 'launcher\Launcher.cs'

Passo 'Gerando os executáveis'
foreach ($nome in @('Instalar-Reparo360', 'Iniciar-Reparo360', 'Parar-Reparo360')) {
    $saida = Join-Path $script:Raiz ($nome + '.exe')
    & $compilador /nologo /target:exe /optimize+ /utf8output ("/out:" + $saida) $fonte
    if ($LASTEXITCODE -ne 0) { Falhar ('Falha ao gerar ' + $nome + '.exe') }
    Ok ($nome + '.exe  (' + [math]::Round((Get-Item $saida).Length / 1KB, 1) + ' KB)')
}
