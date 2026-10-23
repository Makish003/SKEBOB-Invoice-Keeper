# Установка скиллов для Claude Code (один раз)

## 1. Внутри Claude Code (открыть в D:\hack, вводить по одной команде)

```text
/plugin marketplace add alirezarezvani/claude-skills
/plugin install engineering-skills@claude-code-skills
/plugin install engineering-advanced-skills@claude-code-skills
/plugin install karpathy-coder@claude-code-skills
/plugin install zero-hallucination-coder@claude-code-skills
/plugin install docker-development@claude-code-skills
/plugin install a11y-audit@claude-code-skills
/plugin install pw@claude-code-skills
/plugin install handoff-engineering@claude-code-skills
/plugin install demo-video@claude-code-skills

/plugin marketplace add plugin87/ux-ui-agent-skills
/plugin install ux-ui-agent-skills@ux-ui-agent-skills

/plugin marketplace add anthropics/skills
/plugin install example-skills@anthropic-agent-skills
```

`example-skills` даёт `frontend-design` и `webapp-testing`. После установки — перезапустить Claude Code.

## 2. В PowerShell (в D:\hack)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-skills.ps1
```

Скрипт копирует `scripts/templates/` → `.claude/settings.json` (разрешения, запрет чтения `.env`) и `.mcp.json`, ставит Motion AI Kit (`/motion` + MCP `motion`) и скилл `motion-dev-animations` в `.claude/skills/`.

## 3. Проверка
- `/plugin` — все плагины включены.
- `/mcp` — сервер `motion` подключён (он же прописан в `.mcp.json`).
- `/skills` (или спросить «какие скиллы доступны») — видны `karpathy-coder`, `senior-backend`, `ux-ui-agent-skills:design-doctrine`, `motion-dev-animations`, `motion`.

## Примечания
- Плагин ux-ui-agent-skills ставит хуки (Stop-хук проверяет гейты дизайна). Если он мешает бэкенд-агенту (BACK),
  отключите плагин в его сессии: `/plugin` → ux-ui-agent-skills → Disable. FRONT держит его включённым.
- Имена `a11y-audit` и `grill-me` есть в двух наборах — вызывайте с префиксом плагина (`ux-ui-agent-skills:a11y-audit`).
- Для гейтов XIAS нужен Node ≥ 20 и Playwright Chromium: `npx playwright install chromium` (делает FRONT при F-02).
