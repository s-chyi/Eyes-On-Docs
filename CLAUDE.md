# EyesOnDocs - Claude Code Project Guide

## Project Overview

Doc Update Notification Bot - monitors Microsoft documentation updates and sends notifications. Includes a Python backend, Next.js frontend, and MCP server.

## Repository

- GitHub: joeyzenghuan/Eyes-On-Docs
- Main branch: `main`, working branch: `master`

## Production VM

- Credentials: `.claude/vm_credentials.env` (not committed to git)
- Connect via tmux session `eyesondocs`, window `remote`

## Skills

- **[Deploy to ACA Non-Prod](.claude/skills/deploy-aca-nonprod.md)**: Corp non-prod ACA (Nick sub) deploy — image build, revision rollout, UAMI + Cosmos verification. **This is the current live deploy path.**
- **[Deploy to VM](.claude/skills/deploy-vm.md)**: Legacy VM deploy (Joey's old prod, mostly decommissioned as of 2026-07). Kept for historical reference.

## Current live environment

- Domains: `docs.westiedoubao.com`, `mcp.westiedoubao.com` → corp non-prod ACA (`104.208.123.126`)
- Sub: `NickShieh-Subscription` (`937c6f45-...`), tenant `16b3c013-...`
- RG: `rg-eyesondocs` (eastasia)
- See [Architecture.md](./Architecture.md) for full component diagram.

## Key Paths (VM)

| Component | Path |
|---|---|
| Project root | `/home/joey/DocUpdateNotificationBot` |
| Frontend | `/home/joey/DocUpdateNotificationBot/web` |
| MCP Server | `/home/joey/DocUpdateNotificationBot/mcp_server` |
| Config | `/home/joey/DocUpdateNotificationBot/target_config.json` |

## Key Paths (Local macOS)

| Component | Path |
|---|---|
| Project root | `/Users/joey/gitrepo/DocUpdateNotificationBot2/DocUpdateNotificationBot` |
| Config files | `logs/target_config-*.json` |
