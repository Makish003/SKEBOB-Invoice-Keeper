# Установка Motion AI Kit и motion-dev-animations skill для проекта (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "0/2 Claude Code project config (.claude/settings.json, .mcp.json)..."
New-Item -ItemType Directory -Force -Path ".claude" | Out-Null
if (-not (Test-Path ".claude\settings.json")) { Copy-Item "scripts\templates\claude-settings.json" ".claude\settings.json" }
if (-not (Test-Path ".mcp.json")) { Copy-Item "scripts\templates\mcp.json" ".mcp.json" }

Write-Host "1/2 Motion AI Kit (/motion skill + MCP motion)..."
npx --yes motion-ai

Write-Host "2/2 motion-dev-animations skill..."
$dest = ".claude\skills\motion-dev-animations"
if (Test-Path $dest) {
    git -C $dest pull --ff-only
} else {
    New-Item -ItemType Directory -Force -Path ".claude\skills" | Out-Null
    git clone --depth 1 https://github.com/199-biotechnologies/motion-dev-animations-skill.git $dest
    Remove-Item -Recurse -Force "$dest\.git"
}
Write-Host "Done. Restart Claude Code, then check /mcp and /plugin."
