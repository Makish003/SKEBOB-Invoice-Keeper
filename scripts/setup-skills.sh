#!/usr/bin/env bash
# Установка Motion AI Kit и motion-dev-animations skill для проекта (macOS/Linux/Git Bash)
set -euo pipefail
cd "$(dirname "$0")/.."
echo "0/2 Claude Code project config..."
mkdir -p .claude
[ -f .claude/settings.json ] || cp scripts/templates/claude-settings.json .claude/settings.json
[ -f .mcp.json ] || cp scripts/templates/mcp.json .mcp.json
echo "1/2 Motion AI Kit (/motion skill + MCP motion)..."
npx --yes motion-ai
echo "2/2 motion-dev-animations skill..."
dest=.claude/skills/motion-dev-animations
if [ -d "$dest" ]; then echo "already installed"; else
  mkdir -p .claude/skills
  git clone --depth 1 https://github.com/199-biotechnologies/motion-dev-animations-skill.git "$dest"
  rm -rf "$dest/.git"
fi
echo "Done. Restart Claude Code, then check /mcp and /plugin."
