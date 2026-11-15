# Copies the Obsidian-like settings and styling into a vault's .atlas folder, or undoes that.
#   apply-kit.ps1                 apply to The Oracle
#   apply-kit.ps1 -Undo           put the vault's previous settings back and remove the snippet
#   apply-kit.ps1 -Vault <folder> use another vault
param(
    [string]$Vault = (Join-Path $env:USERPROFILE 'kDrive\The Oracle'),
    [switch]$Undo
)
$ErrorActionPreference = 'Stop'

$kit     = Split-Path -Parent $PSScriptRoot
$source  = Join-Path $kit 'copy-into-vault\.atlas'
$target  = Join-Path $Vault '.atlas'
$config  = Join-Path $target 'config.toml'
$backup  = Join-Path $target 'config.toml.before-obsidian-kit'
$snippet = Join-Path $target 'snippets\obsidian-look.css'

if (-not (Test-Path -LiteralPath $Vault -PathType Container)) {
    Write-Host "The vault folder was not found: $Vault" -ForegroundColor Red
    exit 1
}

if ($Undo) {
    if (Test-Path -LiteralPath $backup) {
        Copy-Item -LiteralPath $backup -Destination $config -Force
        Write-Host "Your previous Atlas settings are back (from config.toml.before-obsidian-kit)."
    } else {
        Write-Host "No saved copy of the previous settings was found, so the settings were left as they are."
    }
    if (Test-Path -LiteralPath $snippet) {
        $parked = "$snippet.off"
        Move-Item -LiteralPath $snippet -Destination $parked -Force
        Write-Host "The Obsidian-look styling is switched off (renamed to obsidian-look.css.off)."
    }
    exit 0
}

New-Item -ItemType Directory -Force -Path (Join-Path $target 'snippets') | Out-Null
if ((Test-Path -LiteralPath $config) -and -not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $config -Destination $backup
    Write-Host "Kept your current Atlas settings as config.toml.before-obsidian-kit."
}
Copy-Item -LiteralPath (Join-Path $source 'config.toml') -Destination $config -Force
Copy-Item -LiteralPath (Join-Path $source 'snippets\obsidian-look.css') -Destination $snippet -Force
Write-Host "Done: the Obsidian-like settings and styling are in $target"
Write-Host "Open (or reload) Kandinsky on this vault to see them. Undo.cmd takes them back out."
