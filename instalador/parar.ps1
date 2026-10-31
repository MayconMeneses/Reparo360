# Desliga o sistema e o banco. Os dados ficam guardados (nada é apagado).
. (Join-Path $PSScriptRoot 'comum.ps1')
Set-Location $script:Raiz

Passo 'Desligando o Reparo360'
if (Servidor-Rodando) {
    $id = [int](Get-Content $script:ArquivoPid | Select-Object -First 1)
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Remove-Item $script:ArquivoPid -ErrorAction SilentlyContinue
    Ok 'Sistema desligado'
} else {
    Remove-Item $script:ArquivoPid -ErrorAction SilentlyContinue
    Ok 'O sistema já estava desligado'
}

if ((Tem-Comando 'docker') -and (Docker-Pronto)) {
    & docker compose stop
    if ($LASTEXITCODE -eq 0) { Ok 'Banco de dados desligado (os dados continuam guardados)' } else { Aviso 'Não consegui desligar o banco.' }
}
