$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $project 'dist'
$release = Join-Path $project 'release'
$source = Join-Path $PSScriptRoot 'windows-installer/Program.cs'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
if (-not (Test-Path -LiteralPath (Join-Path $framework 'csc.exe'))) {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319'
}
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'O compilador do .NET Framework para Windows é necessário para gerar o instalador.'
}

$package = Get-Content -Raw -LiteralPath (Join-Path $project 'package.json') | ConvertFrom-Json
$manifest = Get-Content -Raw -LiteralPath (Join-Path $extension 'manifest.json') | ConvertFrom-Json
if ($manifest.name -ne 'Ponto para WhatsApp Web' -or $manifest.version -ne $package.version) {
    throw 'A compilação em dist não corresponde à versão atual. Execute npm run build.'
}
foreach ($entry in @('background.js', 'cloud.html', 'voice.html', 'vendor/wppconnect-wa.js', 'vendor/voice-resampler.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $extension $entry) -PathType Leaf)) {
        throw "O arquivo $entry está ausente em dist. Execute npm run build."
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Directory]::CreateDirectory($release) | Out-Null
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('ponto-pack-' + [Guid]::NewGuid().ToString('N') + '.zip')
$installer = Join-Path $release 'Ponto-Instalador-Windows.exe'
$temporaryExe = Join-Path $release ('ponto-build-' + [Guid]::NewGuid().ToString('N') + '.exe')
$previousExe = Join-Path $release ('ponto-previous-' + [Guid]::NewGuid().ToString('N') + '.exe')

try {
    [System.IO.Compression.ZipFile]::CreateFromDirectory($extension, $temporary, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $references = @('System.IO.Compression.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll') |
        ForEach-Object { '/reference:' + (Join-Path $framework $_) }
    & $compiler '/nologo' '/target:winexe' '/codepage:65001' '/optimize+' @references "/out:$temporaryExe" "/resource:$temporary,Ponto.Extension.zip" $source
    if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação do instalador.' }
    if (Test-Path -LiteralPath $installer) {
        [System.IO.File]::Replace($temporaryExe, $installer, $previousExe)
    } else {
        [System.IO.File]::Move($temporaryExe, $installer)
    }
    $checksum = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksum + '  Ponto-Instalador-Windows.exe' | Set-Content -Encoding ascii -LiteralPath (Join-Path $release 'SHA256SUMS.txt')
    Write-Host "Instalador pronto em $installer"
} finally {
    foreach ($file in @($temporary, $temporaryExe, $previousExe)) {
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
    }
}
