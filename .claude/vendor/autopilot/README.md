# Autopilot plugin files (vendored for review, not enabled)

These files are the Claude Code plugin of Autopilot, copied without change from
`plugin/claude-code/` of https://github.com/ramenvr/autopilot.

- Commit: `31cb1e5cc02abcce1a91367abb87718803ab983a` (2026-11-02, "feat: background
  research agent, flexible frame describer LLM, bugfixes (#18)").
- License: Apache-2.0 (`LICENSE` in this folder).
- Evaluation: `docs/research/2026-11-02-autopilot-evaluation.md`.

## Status

Claude Code does not load this folder. Claude Code loads skills only from
`.claude/skills/` and subagents only from `.claude/agents/`. The `.mcp.json` file in
`claude-code-plugin/` is not the project `.mcp.json`, so this folder does not enable
the `autopilot` MCP server in this project.

This covers the project scope only. `autopilot connect claude` registers the
`autopilot` MCP server at user scope and installs the `autopilot` skill and the
`frame-describer` subagent in `~/.claude` (or in `CLAUDE_CONFIG_DIR`). User scope
applies to every project, this one included. If someone ran that command on a
computer, check the user configuration there (`claude mcp list`, `~/.claude/skills`,
`~/.claude/agents`) or run `autopilot connect claude --remove`.

Keep these files disabled. Autopilot plays only Unreal 5, Unity 6, and Godot 4
projects. Skate ATL is a Three.js game, so the skill tells the agent to stop.

## To enable it (not recommended now)

All of these conditions must be true before you enable it:

1. A Skate ATL build runs in Unreal, Unity, or Godot, or an Autopilot adapter for the
   browser exists.
2. The Autopilot release is at least 7 days old (AGENTS.md rule).
3. The user has an Aura account or a TypeSafe API key in the Autopilot settings file.

Then follow the README of the release. Do not copy these files into
`.claude/skills/` or `.claude/agents/` before that.
