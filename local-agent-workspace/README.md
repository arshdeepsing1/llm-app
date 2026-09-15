# Local workspace

A local browser coding assistant with a Claude-inspired interface, real Databricks
tool calls today, and a Claude Agent SDK adapter for a Claude-enabled workspace.
Application code lives here; the sibling SDK checkout is a dependency.

## Features

- Streamed Markdown chat and multiple persistent conversations.
- Databricks model selection, file listing/reading/searching, file creation and
  exact edits, and shell commands.
- Approval cards with proposed edits and command text. A declined action does not run.
- Per-conversation permissions below the composer: Manual, Auto, Accept edits,
  Plan and Bypass permissions. Access additional local folders through an approval card.
- Stop an agent response, including a running development-mode command or pending approval.
- Resume conversations after refreshing or restarting the app.
- Workspace file explorer, text editor with stale-file detection, Git status/diff,
  and a non-interactive command runner.
- Claude SDK adapter with gateway configuration, resumable SDK sessions, permission
  callbacks, optional MCP configuration, project skills/instructions, and file
  checkpoint recording. The real CLI passes a streaming/resume test against a
  scripted local gateway; live Claude behavior requires a Claude-enabled workspace.
- Responsive desktop/mobile UI, bundled fonts, and no credential storage in the browser.

This release does not include a browser automation engine, OS computer control,
cloud sessions, a scheduler, a full PTY terminal, checkpoint rewind UI, or Anthropic's
account/Dispatch services. Development mode is its own tool loop and does not
implement Claude skills, subagents, or native Claude context management.

## Start on this laptop

The app is configured using an ignored `.env` that points to your existing
credential file. No token is copied into the project.

```bash
cd /Users/sagarsingh/Documents/GitHub/llm-app/local-agent-workspace
/Users/sagarsingh/Documents/wabi-sabi-code/codex-wabisabi-space/.codex_venv/bin/python run.py
```

Open http://127.0.0.1:8765. Use `--port 8766` if that port is occupied.
Stop the local server with Ctrl+C. It must remain running for the UI and agents to work.

## Install / move to another laptop

Tested on macOS with Python 3.12. This version uses `/bin/zsh` for shell tools.
Install Python 3.12+, Node 22.12+ (or Node 24), and pnpm 11.19.0.

Keep this layout:

```text
llm-app/
  claude-agent-sdk-python-main/   # existing SDK source, currently 0.2.152
  local-agent-workspace/         # this application
```

From this directory, using your chosen Python environment:

```bash
python -m pip install -c constraints.txt -e './backend[test]' -e ../claude-agent-sdk-python-main
cd frontend
pnpm install --frozen-lockfile
pnpm run build
cd ..
cp .env.example .env
# Edit .env: set credential file, workspace directory, runtime, and model.
python prepare_claude.py
python run.py
```

`prepare_claude.py` downloads the official wheel for the installed SDK version and
extracts its bundled CLI into `.local/bin/claude`. It does not change your global
Claude command or write into the sibling SDK checkout. This SDK's published wheel
supplies CLI 2.1.259; the checkout's target-version file says 2.1.272. The supplied
CLI passes this app's native transport/resume test; newer SDK features may require
upgrading it. On another OS/CPU, recreate
`.local/bin` and `.local/sdk-wheel`; do not copy a virtual environment or CLI binary.

The credential file is plain assignments, parsed as data (never executed):

```text
DBRICKS_URL=https://your-workspace.cloud.databricks.com
DBRICKS_TOKEN=your-token
```

`DATABRICKS_HOST` and `DATABRICKS_TOKEN` environment variables are also supported.
Shell environment variables override the credential file. Keep `.env`, credentials,
`.local`, and virtual environments out of Git.

### Switch to Claude

1. Open **Settings** and select **Claude Agent SDK**.
2. Set the new credential-file path, project folder, and exact Claude model-service ID.
3. Use the app's prepared CLI or explicitly configure a compatible executable.
4. Save, then start a **new conversation**. Existing sessions keep their runtime,
   workspace and model. Development transcripts are not native Claude SDK sessions.

The adapter uses `HOST/ai-gateway/anthropic`, bearer authentication, the Databricks
coding-agent header, and explicit model mappings. Override the path with
`LOCAL_AGENT_ANTHROPIC_PATH` if your workspace requires a different gateway route.
The saved URL is expected to be the workspace root.

For SDK MCP servers, set **MCP configuration file** to a JSON file in the standard
Claude format (`{"mcpServers": {...}}`). Project skills/instructions are opt-in in
Settings. Runtime configuration is scoped to this app; global MCP settings are excluded.
Actual availability of models, MCP tools and advanced features depends on your
new workspace, gateway permissions, provider and installed runtime.

Saved UI settings are in `.local/settings.json` and override `.env` defaults. Update
them in Settings after migration, especially absolute paths. To move chat history,
stop both servers and copy `.local/conversations.sqlite3`; SDK sessions additionally
need `.local/claude/` and matching project paths. The app gives the Claude runtime
its own configuration directory, separate from your global Claude settings. Start a new
session if project paths differ rather than assuming seamless cross-laptop resume.

## Working with the app

- **New conversation**: choose a model, then send a task. Enter sends; Shift+Enter adds a line.
  Opening the root URL or clicking **New** starts with an empty context. Sending the
  first message creates a unique session, even if another chat has the same title.
  Select a sidebar conversation to resume it. Each saved chat has a `?session=<uuid>`
  URL, which preserves that selection on refresh and supports browser Back/Forward.
  The header and sidebar show a short session ID to distinguish repeated titles.
  Drafts stay with their conversation while switching chats in the current page;
  unsent drafts are not saved across a page reload.
  The message box stays editable while connecting. The permissions menu opens above
  the composer; clicking the input closes it, and choosing a mode returns focus to chat.
  Open tabs reconnect after a server restart without discarding the current draft.
- **Workspace / Files**: browse a folder, edit UTF-8 text files up to 80 KB, or use
  the plus button to reference the file in chat. Save detects concurrent disk edits.
- **Workspace / Changes**: inspect Git status and tracked-file diffs. Untracked
  paths appear in status; their contents are available in Files.
- **Workspace / Terminal**: run a command explicitly; results appear after it exits.
  This is a 60-second command runner, not an interactive terminal or server manager.
- **Approvals**: approve or decline model-proposed writes and commands. An unanswered
  approval expires after five minutes; a browser refresh retains it while the server runs.
- **Other folders**: ask, for example, `Are there any CSV files in
  /Users/sagarsingh/Downloads?`. The agent can list, read and search absolute or `~/`
  paths. The first file-tool request outside the project opens a folder-access card.
  Approving it grants that directory (and its children) to this conversation, including
  after refresh/restart. File-edit approval still follows the selected mode.
  Declining does not grant access. Start a new conversation for a fresh set of grants.
  macOS can separately block protected folders such as Downloads, Desktop and Documents.
  If the tool reports “macOS denied access,” open **System Settings → Privacy &
  Security → Files and Folders**, enable the folder for the app that launches the
  Python server (such as Terminal or Codex), then restart the server. Chat permission
  modes cannot override macOS privacy controls.
- **Folder access** (above the chat input): enter `~/Downloads` or another folder,
  click **Check access**, then **Allow folder** when the server can read it. This
  grants access only to the current conversation; before the first message it creates
  that conversation for you. The check reads no file contents and does not itself
  grant access. Remove additional grants in the same dialog. When macOS blocks access,
  expand **Python used by this server** to see the actual executable and compare it
  with the permission you enabled. Browser folder approval does not grant macOS access
  to a separate Python process.
- **Stop**: cancel the current agent turn. Approved writes that already happened are
  retained. The app does not promise to undo arbitrary shell side effects.

### Conversation storage

The default state directory is `local-agent-workspace/.local/`, overridable with
`LOCAL_AGENT_STATE_DIR`:

- `conversations.sqlite3`: the app's chat history. The `sessions` table has one row
  per UUID; its `data` column is JSON containing display events, the Databricks
  message/tool history (`wire`), model, workspace, permissions, folder grants, and
  the native Claude session ID (`sdk_id`, when applicable). Same titles never merge
  sessions. Browser storage is not the source of conversation history.
- `claude/projects/<encoded-project-path>/<sdk-session-id>.jsonl`: native Claude
  transcripts when using the Claude Agent SDK runtime. The app sets
  `CLAUDE_CONFIG_DIR` to `.local/claude`; ordinary Claude Code defaults to
  `~/.claude/projects/`. Databricks development chats do not create native JSONL files.
- `settings.json`: app settings, separate from conversation history.

New sessions have empty message history, fresh permissions and no Claude resume ID.
Project files are shared on disk when chats select the same workspace; starting a
new chat does not copy or isolate the project filesystem. Stop the server before
copying the database for migration so SQLite's live WAL files are settled.

### Permission modes

Choose a mode beneath the chat input. Existing conversations default to Manual.
Changes are saved per conversation; stop an active response before switching modes.

| Mode | Agent behavior |
| --- | --- |
| Manual | Read approved folders; ask before edits and commands. |
| Auto | Accept file edits and exact `pwd`, `ls`, `ls -la` commands; ask for other commands/actions. |
| Accept edits | Accept file edits; ask before commands and other actions. |
| Plan | Read/search approved folders and describe a plan; block file changes, shell commands and delegation. |
| Bypass permissions | Run actions and access external folders without approval cards. Credential/generated-file exclusions still apply to file tools. |

Auto uses the app's explicit local rules, not Anthropic's model-based permission
classifier. Both runtimes use this same policy; the Claude SDK adapter enforces it
through PreToolUse hooks and permission callbacks, with native runtime restrictions
still applicable. Manually saving in the editor or clicking Run in the terminal is
an explicit user action outside the agent's permission mode.

## Local access and limits

The server binds to `127.0.0.1`, checks Host/Origin, and uses a random local access
token to protect its API/WebSocket. Databricks credentials stay server-side. File
tools resolve paths and symlinks before checking the project and approved additional
folders. Bypass mode skips that folder boundary; credential files and generated
directories remain excluded. This is a trusted single-user local app, not a multi-user sandbox.
Commands allowed by the selected mode execute with your OS permissions and can reach beyond the project.
The development shell strips model credentials from its inherited environment;
the Claude runtime necessarily receives gateway credentials to make model calls.

The model agent allows up to 16 model steps per user turn, 8,192 output tokens per
development request, 80 KB file/command output, and a 60-second command timeout.
History is retained without automatic development-mode compaction; start a new
conversation if you reach your model's context limit. Databricks inference is billed
to your workspace. Other model endpoints must support streaming and function calling.

## Development and checks

```bash
# In this directory, with the chosen Python environment:
python run.py --reload
# In a second terminal:
cd frontend && pnpm dev
# Development UI: http://127.0.0.1:5173 (API/WebSocket proxy to port 8765)

# Tests (no paid model calls):
(cd backend && python -m pytest -q)
# Typecheck and production bundle:
(cd frontend && pnpm run build)
# Browser API recovery tests (Node 24):
(cd frontend && node --test tests/api.test.mjs)
```

Tests cover all permission modes, approved/denied external CSV listings, persisted
folder grants, shell classification, SDK permission hooks, approval allow/deny,
browser-controlled folder checks/grants/removal, OS-denied access,
cancellation (including process-group termination), path/symlink/secret boundaries,
credential-free shell environment, restart recovery, API access control, WebSocket
snapshots, stale editor writes, SDK gateway/resume configuration, and native CLI
streaming/resumption against scripted responses (the last test skips if the app CLI
has not been prepared). None of these automated tests calls a paid model.
Frontend API tests verify that expired local tokens refresh once and that other
errors never replay a potentially completed action.

After a production frontend rebuild, refresh the browser. When building the first
bundle after starting the backend, restart the backend to register static assets.

## Architecture

- `backend/local_agent/api.py`: local API, WebSocket stream, workspace endpoints.
- `backend/local_agent/agents.py`: shared session/approval events and two agent runtimes.
- `backend/local_agent/tools.py`: scoped file tools and cancellable shell commands.
- `backend/local_agent/permissions.py`: shared mode rules and model instructions.
- `backend/local_agent/store.py`: SQLite conversation storage.
- `backend/local_agent/config.py`: external credentials and portable configuration.
- `frontend/src/`: React interface, conversation state, editor, settings and styling.
- `design/`: original visual concept and extracted design tokens.

Provider documentation:
[Databricks function calling](https://docs.databricks.com/aws/en/machine-learning/model-serving/function-calling),
[Databricks Claude gateway](https://docs.databricks.com/aws/en/ai-gateway/coding-agent-integration-model-services),
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview),
[SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).
