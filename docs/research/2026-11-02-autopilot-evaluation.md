# Autopilot evaluation for Skate ATL

Date: 2026-11-02. Subject: Aura Autopilot, https://github.com/ramenvr/autopilot.

## Verdict

Do not adopt Autopilot now. Autopilot plays only Unreal Engine 5, Unity 6, and
Godot 4 projects. Skate ATL is a Three.js game in the browser, so Autopilot cannot
connect to it. Autopilot does nothing for the 55 FPS low tier gate.

Two ideas from Autopilot are useful without Autopilot itself. Copy them into our own
Playwright harness (ideas G1 and X1 below). They cost little and need no account.

Keep the vendored plugin files only as a reference. Remove them if you do not want
them in the repository.

## 1. What Autopilot is

Autopilot is an automated playtest agent from Ramen VR, the company that makes Aura.
It has three parts:

1. An engine plugin inside the game editor (Unreal, Unity, or Godot). The plugin
   connects out over a WebSocket to `ws://127.0.0.1:8765/v1/bridge`.
2. A Python "agent service" (the `autopilot` command). It reads the game source code
   into a "codex", and it runs a coding agent (OpenCode, Claude Code, or Codex).
3. A decision model, "Jev", from TypeSafe (https://typesafe.ai). The coding agent
   writes a Python harness for each request. During play, the harness asks Jev to
   choose each action.

A request is one of four types: exploration, test, verification, or goal. A
verification report gives `CONFIRMED`, `DENIED`, or `INCONCLUSIVE`. A goal report
gives `achieved` or `not_achieved`. Each run records an H.264 MP4 video. Autopilot
keeps a memory folder per game, so later runs reuse what it learned.

For Claude Code, Autopilot gives an MCP server (`autopilot mcp`), a skill
(`autopilot`), and a subagent (`frame-describer`). The subagent describes video
frames without the claim under test, so it cannot confirm what it expects to see.

### License

Apache License 2.0. The engine plugins bundle fonts under the SIL Open Font License.

### Age of the project

| Item | Commit | Date |
| --- | --- | --- |
| First release, tag `v1.0.0-b143178` | `b143178` | 2026-10-29 |
| Tag `v1.0.0-848084e` | `848084e` | 2026-10-30 |
| Newest commit, evaluated here | `31cb1e5` | 2026-11-02 |

Every release is less than 7 days old. AGENTS.md requires dependency versions that
are at least 7 days old. Thus no Autopilot version meets the rule today. The earliest
date that `b143178` meets the rule is 2026-11-05.

The Python dependencies that the package pins are older than 7 days:

| Package | Version | First upload on PyPI |
| --- | --- | --- |
| typesafe-sdk | 0.7.5 | 2026-10-14 |
| requests | 2.34.2 | 2026-05-14 |
| python-dotenv | 1.2.3 | 2026-08-16 |
| websockets | 17.1 | 2026-08-26 |
| anthropic | 1.11.0 | 2026-09-30 |
| claude-agent-sdk | 0.2.164 | 2026-10-06 |
| av | 19.0.2 | 2026-10-21 |

## 2. The official install, and why I did not run it

I read the README, `LICENSE`, `pyproject.toml`, `packaging/standalone/install.sh`,
`autopilot/connect.py`, and the Claude Code plugin files before I installed anything.
The official install for Claude Code has these steps:

1. Download a build for the engine from https://www.tryaura.dev/autopilot/ and add the
   plugin to the Unreal, Unity, or Godot project.
2. Run `install.sh`. The script runs `curl -LsSf https://astral.sh/uv/install.sh | sh`
   and `curl -fsSL https://bun.sh/install | bash` if uv or Bun is not present. It runs
   `uv tool install` for the `autopilot` command, and it writes settings to
   `~/Library/Application Support/Autopilot/autopilot.env`.
3. Open the Autopilot tab in the editor. Sign in with an Aura account, or give your
   own keys ("BYOK"): a `TYPESAFE_API_KEY` and a language model key.
4. Run `autopilot connect claude`. This adds the MCP server at user scope
   (`claude mcp add --scope user`) and writes the skill and the subagent to
   `~/.claude/`. The alternative is `claude plugin install autopilot --marketplace
   ramenvr/autopilot`.

The install needs an account or a key, `curl | sh` scripts, and changes outside this
repository. Step 1 cannot work, because Skate ATL has no engine editor. I stopped and
asked the user. The user chose an offline evaluation with no keys and no global
changes.

## 3. What I installed

1. I cloned the repository at commit `31cb1e5cc02abcce1a91367abb87718803ab983a` into
   the session scratchpad. The clone is not in this repository.
2. I made a Python 3.12 virtual environment in the scratchpad with `uv venv`, and I
   installed the package with `uv pip install "./repo[dev]"`. No file changed outside
   the scratchpad.
3. I copied `plugin/claude-code/` and `LICENSE` without change to
   `.claude/vendor/autopilot/`. Claude Code does not load skills or subagents from
   that folder, and the MCP server is not enabled. See
   `.claude/vendor/autopilot/README.md`.

I ran every command with `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` removed from the
environment, `HOME` set to an empty folder in the scratchpad, and `AUTOPILOT_MEMORY`
set to a scratchpad folder.

## 4. What I ran, and what happened

### 4.1 The test suite of Autopilot

Command: `python -I -m pytest -q -p no:cacheprovider` in the clone. CONTRIBUTING.md
says that these tests need no engine, no key, and no network.

Result: exit code 0.

```
492 passed, 5 skipped in 280.69s (0:04:40)
```

The tests use a simulated game (`tests/conftest.py`, `tests/navsim.py`). They show
that the package works on this Mac. They do not show how well it plays a real game.
While the tests ran, my `play` test in section 4.5 held port 8765. No test failed.

### 4.2 The command line

`autopilot --help` lists 9 commands: `serve`, `play`, `codex`, `run`, `login`,
`logout`, `uninstall`, `mcp`, and `connect`.

### 4.3 The MCP server

I sent `initialize`, `tools/list`, and one `tools/call` to `autopilot mcp` over stdio.
The server answered as `autopilot` version `0.1.0` and listed 14 tools:

| Tool | What it does |
| --- | --- |
| `start_run` | Starts a run on the game open in the editor. |
| `wait` | Waits for a call that is still in progress. |
| `probe` | Runs Python against the live game. |
| `run_harness` | Plays the harness of the request for 5 to 360 seconds. |
| `snapshot` | Gives what the player sees now. |
| `describe_frames` | Fallback: the Autopilot vision model describes frames. |
| `restart_level` | Starts the level again. |
| `report` | Gives the final answer and the outcome. |
| `frames` | Gives up to 12 frames as images, for the describer subagent only. |
| `read_file`, `list_files`, `search` | Read the game folder and the kit. |
| `write_file`, `edit_file` | Write only the harness, `notes.md`, or `lib.py`. |

The call `start_run` with the request "Verify that the skater can grind the rail"
returned an error:

```
Autopilot's agent service isn't running: open the game's project in Unreal, Unity or Godot with the Autopilot plugin, and let the Autopilot tab connect. Then call start_run again.
```

### 4.4 The codex command on this repository

Command: `autopilot codex --project <this worktree>`. Exit code 1. Output:

```
No Unreal, Unity or Godot project at <worktree>
```

### 4.5 The play command on this repository

Command: `autopilot play --project <this worktree> "Verify that the skater can grind a
rail"`. The command printed this line and then waited for an engine plugin:

```
Waiting for the plugin on ws://127.0.0.1:8765/v1/bridge ...
```

No plugin connected, so nothing played. My first `play` process continued to hold
port 8765 after I stopped its shell. I found it with `lsof` and stopped it (PID
34313). Port 8765 is free now.

### 4.6 Files changed in this repository

- `.claude/vendor/autopilot/` (the plugin files, the license, and a README).
- This report.
- `docs/decisions.md` (the decision entry for this evaluation).

No file under `src/`, `levels/`, or `scripts/` changed.

## 5. Where Autopilot can help Skate ATL

Value and cost use three levels: low, medium, and high. "Cost" includes the work,
the money, and the risk.

### 5.1 Gameplay

| ID | Idea | Value | Cost | Needs Autopilot |
| --- | --- | --- | --- | --- |
| G1 | Add verification claims to `npm run playtest`. Each claim gives `CONFIRMED`, `DENIED`, or `INCONCLUSIVE`, with the video time as evidence. Example: "The skater can grind the straight rail and land a 3-link combo." | Medium | Low | No: copy the report format |
| G2 | Add an exploration session: an agent plays the Beltline block freely and logs stuck spots, falls, rails that no approach can reach, and places off the walkable area. | High | High | Yes, with a browser adapter (see 5.3) |
| G3 | Add goal runs for the scoring: for example "Reach 5,000 points in 60 seconds". A goal run shows if a score is reachable, not only if the formula is correct. | Medium | High | Yes, with a browser adapter |
| G4 | Review the move set. Autopilot cannot judge how a move feels. AGENTS.md requires real skaters for this review. | Low | Not applicable | No |

The current playtest (`scripts/playtest.mjs`, `src/playtest/sessions.js`) already
plays 3 scripted sessions and measures falls, snaps, combos, and FPS. Vitest already
tests the scoring as a pure module. G1 adds the most at the lowest cost.

### 5.2 Graphics

| ID | Idea | Value | Cost | Needs Autopilot |
| --- | --- | --- | --- | --- |
| X1 | Add a "blind describer" subagent for playtest screenshots. It gets only the image and neutral questions, never the claim. Use it to check the toon outline, the halftone, the facades, the trees, and the terrain. | High | Low | No: copy the `frame-describer` pattern |
| X2 | Use the run video and frames of Autopilot to find visual faults during free play, for example a tree in a road or a gap under a bridge. | Medium | High | Yes, with a browser adapter |
| X3 | The 55 FPS low tier gate. Autopilot has no profiler, no FPS metric, and no GPU tier control. | None | Not applicable | Not applicable |

X1 works with the screenshots that `npm run playtest` already writes. It reduces
the risk that an agent "sees" the effect that it just coded.

### 5.3 The cost of a browser adapter

CONTRIBUTING.md says that a new engine needs two parts:

1. A plugin in the game. It answers the engine-neutral operations (find objects,
   transforms, the player pose, movement, input, the UI, frames) over the WebSocket,
   and exports the code. The Godot plugin has about 15,705 lines of GDScript, not
   counting tests.
2. An adapter in Python, a subclass of `OpEngine`. The Godot adapter is 253 lines,
   plus 97 lines of kit notes.

A browser version is a large project. It also adds code that is not ours to the
build, and the protocol of Autopilot can change each week at its current age.

## 6. What Autopilot cannot do, and the risks

### Limits

- It cannot connect to a Three.js or browser game.
- It does not measure FPS or frame time.
- It cannot judge how the skating feels.
- It cannot check the political rules (positive portrayal of Atlanta).

### Risks

1. **Data sharing is on by default.** `telemetry.py` shares a run unless the user
   says no in the plugin or sets `AUTOPILOT_SHARE=0`. A shared run sends every
   language model call in full, the decision log, and the video to Aura storage.
   `training.py` says that it removes secrets, paths, and names first, and that it
   never sends the whole codex. I did not verify the removal.
2. **Cost.** Each run uses a decision model (an Aura plan or a TypeSafe key) and a
   language model (Claude Opus by default, with fast mode on: 2 times the price).
3. **Age.** The project is 4 days old, with 7 commits. The 7-day rule fails until
   2026-11-05 at the earliest.
4. **Install scope.** The official install changes the user home folder and runs
   `curl | sh` scripts.
5. **Model-written code.** The harness is code that a model writes. It runs in a
   sandbox (`AUTOPILOT_SANDBOX`). I did not test the sandbox.

## 7. What I verified, and what I did not verify

Verified, with the commands in section 4:

- The license is Apache-2.0.
- The package installs in a local virtual environment with no keys.
- The offline test suite passes: 492 passed, 5 skipped.
- The CLI has 9 commands, and the MCP server lists 14 tools.
- `start_run`, `codex`, and `play` cannot work on this repository.
- The dependency upload dates in section 1.

Not verified:

- No game ran. I did not see a harness, a decision, a report, or a video.
- I did not install the official build, Bun, or OpenCode.
- I did not sign in to Aura, and I did not use a TypeSafe key.
- I did not test the data removal in `redact.py` or the sandbox.
- I did not read every source file. I read the files named in section 2, plus
  `engines/base.py`, `bridge.py`, `telemetry.py`, `training.py`, and parts of `cli.py`
  and `KIT.md`.
- I did not run the Skate ATL playtest or measure FPS. This task did not need it.

## 8. Decision for the user

1. Choose if the vendored files in `.claude/vendor/autopilot/` stay in the
   repository.
2. Choose if G1 and X1 become issues for the M1 playtest work.
3. Look at Autopilot again only if one of these conditions becomes true:
   - Autopilot supports the browser or WebGL.
   - Skate ATL moves to Godot, Unity, or Unreal.
