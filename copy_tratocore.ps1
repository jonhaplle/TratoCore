$ErrorActionPreference = 'Stop'
$source = (Split-Path -Parent $MyInvocation.MyCommand.Path)
$target = 'C:\TratoCore'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$excludeDirs = @('.git','node_modules','storage','backups')
$excludeFiles = @('.env')
Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    if ($excludeDirs -contains $_.Name) { return }
    if ($excludeFiles -contains $_.Name) { return }
    if ($_.Extension -eq '.zip') { return }
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
}
Write-Host 'Arquivos copiados com sucesso.'
