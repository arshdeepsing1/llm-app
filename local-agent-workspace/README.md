# Local workspace

A local browser coding assistant powered by Databricks model serving, with streamed
chat, local file tools, shell commands, and per-conversation permissions.
The application is self-contained in this folder, with a Python backend and React frontend.

## Features

- Streamed Markdown chat and multiple persistent conversations.
- Databricks model selection, numbered line-range reads, paginated regex/literal
  search, file creation and exact edits, and shell commands with live output.
- Approval cards with proposed edits and command text. A declined action does not run.
- Per-conversation permissions below the composer: Manual, Auto, Accept edits,
  Plan and Bypass permissions. Access additional local folders through an approval card.
- Stop an agent response, including its foreground command or pending approval.
- Managed background jobs with explicit Stop, output retrieval, status/history,
  per-command time/output limits, and cleanup on normal server shutdown.
- Resume conversations after refreshing or restarting the app.
- Configurable context budgeting, automatic summaries of older turns, and a visible
  context meter. Full conversation history stays on disk.
- Automatic workspace-scoped `AGENTS.md` and `CLAUDE.md` guidance loading.
- Workspace file explorer, text editor with stale-file detection, Git status/diff,
  and a non-interactive command runner.
- File checkpoints with reviewed, reversible restore and managed Git worktrees.
- Explicit MCP servers, workspace skills, and approval-controlled tool lifecycle hooks.
- Persistent tasks with dependencies and bounded subagents in separate conversations.
- Collapsible activity and persisted provider reasoning summaries when returned by the endpoint.
- Responsive desktop/mobile UI, bundled fonts, and no credential storage in the browser.

This release does not include a browser automation engine, OS computer control,
cloud sessions, a scheduler, a full PTY terminal, or an OS execution sandbox.

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

Tested on macOS with Python 3.12. Shell tools select zsh, bash, or sh, in that order.
Install Python 3.12+, Node 24.15+ (or Node 22.22.2+), and pnpm 11.19.0.
The Node minimum includes the frontend test dependencies. Git is needed for the
Changes panel and worktrees. Native Windows is not supported by the POSIX
filesystem/process handling; use a Linux
environment such as WSL for that platform. Linux/WSL have not yet been validated.

Copy the `local-agent-workspace` folder, including `backend`, `frontend`, and the
setup files at its root. No sibling repository is required. Recreate the Python
environment and `frontend/node_modules` on the destination system instead of
copying them from another laptop.

On the new laptop, open a terminal in `local-agent-workspace`. For a fresh
macOS/Linux/WSL setup, create a local Python environment and install the backend:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -c constraints.txt -e ./backend
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend run build
cp .env.example .env
```

Edit `.env` before starting: set `LOCAL_AGENT_ENV_FILE` to the credential file's
absolute path on this laptop, `LOCAL_AGENT_WORKSPACE` to an existing project
folder, and `LOCAL_AGENT_MODEL` to your Databricks endpoint name. The example
paths must be replaced. The installation command installs runtime libraries
automatically; add `./backend[test]` instead of `./backend` only if you need to
run the backend tests.

The credential file is plain assignments, parsed as data (never executed):

```text
DBRICKS_URL=https://your-workspace.cloud.databricks.com
DBRICKS_TOKEN=your-token
```

`DATABRICKS_HOST` and `DATABRICKS_TOKEN` environment variables are also supported.
Shell environment variables override the credential file. Keep `.env`, credentials,
`.local`, and virtual environments out of Git.

For each normal start, open a terminal in `local-agent-workspace` and run:

```bash
.venv/bin/python run.py
```

Open http://127.0.0.1:8765 and leave that terminal running. This one Python process
serves the built frontend and backend; no separate Node/pnpm server is needed.
Use `.venv/bin/python run.py --port 8766` to select another port.

To stop the whole server, press **Ctrl+C once in that terminal** and wait for
shutdown to finish. Normal shutdown cancels active agent turns and managed command
jobs and closes the conversation database. Closing the browser does not stop the
server. The chat's **Stop** button stops only that response and its foreground
work, not the server or unrelated background jobs. Restart with the same command;
saved conversations remain available. Dependency installation and frontend build
are one-time setup steps unless their source/dependencies change.

Saved UI settings are in `.local/settings.json` and override `.env` defaults. Update
the credential-file path, project folder, and model in **Settings** after migration,
then start a new conversation. Existing conversations keep their workspace and model.
The credential URL must be the Databricks workspace root, and the selected serving
endpoint must support streaming and function calling.

If you copy an already-built `frontend/dist`, running the app requires Python and
its runtime dependencies only (`python -m pip install -c constraints.txt -e ./backend`).
Node and pnpm are needed to rebuild or develop the frontend, not to serve that bundle.
Git and a supported shell are still needed for their respective tools.
The backend installation automatically installs FastAPI, Uvicorn, HTTPX, regex,
MCP (`mcp==2.2.0`), and the MCP HTTP transport dependency HTTPX2. No Claude SDK,
Claude CLI, or sibling SDK checkout is required. An optional MCP server may have
its own runtime requirements, such as Node; install those only for the servers you choose.

To move chat history, stop both servers and copy `.local/conversations.sqlite3`.
Existing conversations retain their absolute project paths and folder grants;
start a new conversation if those paths differ on the destination laptop.

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
  Unsaved editor text stays with its conversation when closing the workspace panel,
  attaching a file, or switching chats. Text entered during a save remains unsaved
  until the next save. Editor drafts are kept in the current page, not across reloads.
- **Workspace / Changes**: inspect Git status and tracked-file diffs. Untracked
  paths appear in status; their contents are available in Files.
- **Workspace / Terminal**: run a command explicitly and see output while it runs.
  Set the timeout (1–3,600 seconds, default 60) and retained output limit
  (1,024–1,000,000 bytes, default 80,000). A foreground job disables Run until it
  finishes; **Run in background** lets you launch another command. Select a job
  to inspect output, or use **Stop job**. History survives closing/reopening the
  panel and refreshing the browser. Jobs belong to the selected conversation;
  commands launched before creating a chat belong to the selected workspace.
  This remains a noninteractive command runner: stdin is closed, with no PTY.
  Closing the panel does not cancel a job. Errors pause polling until **Refresh jobs**.
- **Approvals**: approve or decline model-proposed writes, commands, MCP calls, and hooks. An unanswered
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
- **Stop**: cancel the current agent turn and its foreground command. Background
  jobs continue; stop them individually in Terminal. Approved writes and completed
  shell side effects are retained. Stop also cancels its active subagent. Deleting a
  conversation removes its jobs, tasks, and file checkpoint copies; edited files stay
  on disk. Child conversations remain separately available in the sidebar.

### Conversation storage

The default state directory is `local-agent-workspace/.local/`, overridable with
`LOCAL_AGENT_STATE_DIR`:

- `conversations.sqlite3`: the app's chat history. The `sessions` table has one row
  per UUID; its `data` column is JSON containing display events, the Databricks
  message/tool history (`wire`), model, workspace, permissions, and folder grants.
  The separate `jobs` table stores command metadata, states, and bounded output.
  At most four jobs run at once; the latest 100 finished jobs are retained across
  all conversations/workspaces. Same titles never merge sessions. Browser storage
  is not the source of conversation history.
- `tasks`, `checkpoints`, and `worktrees` tables: structured task state, file recovery
  copies, and app-owned worktree metadata. File recovery copies contain original
  file bytes, so protect this local database like the project files themselves.
- `settings.json`: app settings, separate from conversation history.
- `extensions.json`: explicitly configured MCP servers and lifecycle hooks.
- `worktrees/`: actual app-created Git worktrees; copying the database alone does
  not migrate these checkouts or their Git registrations.

New sessions have empty message history and fresh permissions.
Project files are shared on disk when chats select the same workspace; starting a
new chat does not copy or isolate the project filesystem. Stop the server before
copying the database for migration so SQLite's live WAL files are settled.

### Context and project instructions

**Settings → Context budget (tokens)** defaults to 32,768. Set it at or below your
endpoint's actual context limit; the app cannot infer a serving endpoint's limit
from its name. Changes apply on the next turn, including existing conversations.
Each request reserves 8,192 tokens for the reply and 2,048 for provider overhead.
The meter estimates the last prepared model input using serialized UTF-8 byte
counts plus framing overhead. This deliberately conservative estimate can compact
earlier than a model tokenizer would; it is not provider usage or billing data.

When older turns no longer fit, the same endpoint summarizes them in bounded
requests. The newest turn and its complete tool exchanges are retained verbatim;
the preceding turn is also retained when space allows. Summaries persist across
restarts, while the full display transcript and original model/tool history remain
in SQLite. Summary requests are additional billed inference. A failed or stopped
summary leaves the previous summary state intact and performs no tools. Summaries
can lose details; they are not an exact substitute for the original transcript.
If the latest turn, tool output, or project guidance alone is too large, the app
reports an error instead of silently cutting it. Increase the budget only within
your endpoint's limit, or start a new conversation with a smaller request. There
is no manual `/compact` command or model tokenizer integration. Retained job output
is paginated; discarded process output cannot be recovered.

At each model request the app rereads root `AGENTS.md`, then `CLAUDE.md`. File tools
also discover guidance in the target directory and its ancestors, from broader
to more specific scopes. These encountered scopes persist for the conversation;
their guidance applies only to their own directories. More specific rules refine
broader rules; user instructions and enforced tool permissions retain precedence.
`CLAUDE.md` is just a supported text filename: it does not enable Claude mode or
require the Claude SDK. README files, imports, skills, parent directories outside
the selected workspace, and external-folder guidance are not automatically loaded.
Shell commands receive root guidance and scopes already encountered by file tools;
the app does not infer new instruction scopes from arbitrary shell command text.

If a write or command encounters newly loaded or changed guidance, that action is
deferred until a new model request includes it. Guidance is checked again after
approval. The combined wrapped guidance is limited to 16,000 UTF-8 bytes; unreadable,
excluded, or oversized files are omitted whole, with warnings in the model input
and expandable context details. Warnings do not permanently block subsequent
actions. Context details list loaded filenames, compactions, and estimated usage.

### Agent tools: recovery and worktrees

Open **Agent tools** in the header. **Recovery** lists checkpoints created before
successful `write_file`, `edit_file`, and editor saves. Preview the reverse diff,
then click **Restore checkpoint**. Restoring verifies the current file's content,
mode, type, location, and access scope; conflicting external changes are rejected.
A restore creates a reverse checkpoint, so it can be undone. Restoring creation
of a new file removes that file. Stop active workspace turns and commands first.
Checkpoints belong to the conversation (or the default-workspace scope for saves
before a chat exists). Deleting a conversation deletes its checkpoint copies.

Recovery covers regular UTF-8 files up to 80 KB. It preserves existing bytes and
permissions, uses atomic replacement, and pins directories during writes. It does
not snapshot shell commands, MCP servers, hooks, Git operations, or whole folders.
It is not a substitute for Git/backups, nor a filesystem lock against unrelated
processes writing at the exact moment of replacement. Changes to newly created
parent directories are not rolled back. Reopen an editor file after a restore to
load the restored content; unsaved browser drafts are intentionally preserved.

**Worktrees** creates a fresh branch from the repository's committed HEAD. Dirty
source files stay in the original checkout and are not copied. **Open conversation**
starts a new Manual-mode conversation in that worktree. Removal only accepts
app-owned clean worktrees, rejects modified/untracked/ignored files and worktrees
used by any saved conversation or running command, and keeps the branch and its
commits. Delete the worktree's conversations and choose another default workspace
before removal. Git hooks, filters, and fsmonitor are disabled for managed worktree
operations. This is deliberate workspace isolation, not automatic per-task copies.

### Agent tools: MCP, skills, and hooks

**Extensions** edits the global explicit configuration. Saving enabled MCP servers
authorizes their startup for tool discovery on each turn; **Test saved configuration**
connects and lists tools without model inference. Servers can run over stdio
(command and argument array) or Streamable HTTP (URL). Use absolute executable and
script paths. Project files cannot automatically register or launch servers.
No custom environment, authentication headers, OAuth, resource browsing, or MCP
prompt workflow is implemented in this release. Keep credentials out of this JSON.

```json
{
  "servers": [
    {"id": "example", "name": "Example", "transport": "stdio",
     "command": "/absolute/path/to/server", "args": [], "enabled": false}
  ],
  "hooks": [
    {"id": "check", "event": "before_tool", "command": "your-check-command",
     "timeout_seconds": 10, "enabled": false}
  ]
}
```

The model sees names such as `mcp__example__tool`. MCP calls require their own
approval in Manual, Auto, and Accept edits; Plan blocks them and Bypass permits
them. MCP servers and hook commands have the user's OS/network access, not the
file tools' folder restrictions. Credential environment variables are stripped
from local server/hook processes. Up to four servers, 32 tools, and 16 KB of tool
schemas are supported; each call has a 60-second deadline and bounded 8 KB result.
Connections close at turn end or cancellation. A discovery failure is reported,
not silently interpreted as an empty working integration.

Install workspace skills at `.agents/skills/<skill-id>/SKILL.md`. Optional simple
frontmatter supplies `name` and `description`. Enable a discovered skill in the
panel, begin a message with `/skill <skill-id>`, or ask the model to use its
`list_skills` / `use_skill` tools. Selection persists per chat, instructions reload
on each model request, and a newly selected/changed skill must reach the model
before a write, command, or MCP call. At most three selected skills fit a combined
8 KB instruction budget. Skills never override user instructions or permissions;
this version has no marketplace, installer, dependency execution, or automatic
matching engine.

Hooks support `before_tool` and `after_tool`. Each enabled hook receives JSON on
stdin with the event, conversation ID, tool, arguments, and (after execution) result.
Each hook separately asks for approval except in Bypass; Plan skips hooks. A declined
or failing before-hook blocks the tool. An after-hook failure displays a warning
while retaining the completed action/result. Hooks have a 1–30 second timeout and
bounded output. They do not recursively invoke hooks. Enable only commands you
intend to run for every applicable tool; configuration can change only while agent
turns are idle.

### Agent tools: tasks, subagents, and activity

**Tasks** shows persisted tasks, descriptions, status, and dependencies. Add them
manually or let the model use `create_task`, `list_tasks`, and `update_task`. A
conversation holds up to 50 tasks; dependencies must belong to the same chat,
cannot form cycles, and must finish before dependent work starts or completes.
These planning records are available in Plan mode.

The model can use `delegate_task` for one concrete task with explicitly supplied
context. The child has a separate transcript/context and inherits workspace,
model, permission mode, and folder grants. Files remain shared: choose independent
work to avoid conflicting edits. One child runs per parent, at most three globally;
children have 1–8 model steps (default six), cannot delegate again, and cannot start
managed background jobs. The parent waits for a bounded result and an honest
completed/failed/cancelled status. **Open subagent** opens the child to review its
work or approve actions; **Back to parent conversation** returns to the parent.
Stop cancels both parent and active child. This is bounded delegation, not a
multi-agent team scheduler or automatic task assignment.

**Activity** collapses a list of actual tool actions and their states; existing
approval cards remain usable independently. A separate **Provider reasoning
summary** disclosure appears only when the Databricks stream supplies documented
`reasoning` content blocks with `summary_text` entries. Summaries persist with the
conversation, display separately from the answer, and have a 12,000-character
limit. Opaque/encrypted reasoning is ignored. Summaries are not replayed as model
history, and the app never fabricates hidden reasoning. Endpoint support varies;
ordinary responses legitimately have no reasoning disclosure. There is no
reasoning-effort setting yet.

### Permission modes

Choose a mode beneath the chat input. Existing conversations default to Manual.
Changes are saved per conversation; stop an active response before switching modes.

| Mode | Agent behavior |
| --- | --- |
| Manual | Read approved folders; ask before edits and commands. |
| Auto | Accept file edits and exact `pwd`, `ls`, `ls -la` commands; ask for other commands/actions. |
| Accept edits | Accept file edits; ask before commands and other actions. |
| Plan | Read/search approved folders and describe a plan; block file changes and shell commands. |
| Bypass permissions | Run actions and access external folders without approval cards. Credential/generated-file exclusions still apply to file tools. |

Inspecting/stopping existing jobs, skills, structured tasks, and delegation are available
in every mode. Delegated tools still follow the child's inherited permission mode.
Starting a background job follows the same command approval rules as foreground
execution. Changing modes does not cancel a previously authorized background job.
Auto uses the app's explicit local rules. Manually saving in the editor or clicking
Run in the terminal is an explicit user action outside the agent's permission mode.

## Local access and limits

The server binds to `127.0.0.1`, checks Host/Origin, and uses a random local access
token to protect its API/WebSocket. Databricks credentials stay server-side. File
tools resolve paths and symlinks before checking the project and approved additional
folders. Bypass mode skips that folder boundary; credential files and generated
directories remain excluded. This is a trusted single-user local app, not a multi-user sandbox.
Commands allowed by the selected mode execute with your OS permissions and can reach beyond the project.
The shell strips model credentials from its inherited environment.

The model agent allows up to 16 model steps per user turn and 8,192 output tokens per
request. The editor and file edits retain their 80 KB limit. Agent reads use
`read_file(path, start_line=1, max_lines=200)` and return numbered lines plus
`next_line`; `max_lines` can be 1–1,000. Reads scan at most 8 MB from the start of
a regular UTF-8 file, reject lines over 128 KB, and return at most 8 KB of serialized
JSON per page. They can therefore inspect larger source files without loading
those files into the editor. File reads, search results, and job-output pages have
explicit continuation markers. The filesystem can change between pages.

`search_files` supports literal search by default, `regex=true`, `case_sensitive`,
`context_lines` (0–5), `offset` (0–10,000), and `max_results` (1–100, default 50).
Results identify file/line, adjacent lines, clipped excerpts, omitted files, and
`next_offset`. Query length is capped at 1,000 characters. Search skips binary,
excluded, unreadable, and over-2-MB files; scan limits are 16 MB of file content,
5,000 files, 2,000 directories, and three seconds. Regex matches have an additional
50 ms timeout. Limit errors ask for a narrower query rather than claiming no matches.
The Python `regex==2026.9.10` dependency enforces regex timeouts and is installed
by the normal backend installation command.

`run_command` accepts `timeout_seconds`, `max_output_bytes`, and `background`.
It returns a job ID and the first output page. `list_jobs`, `get_job_output`, and
`stop_job` inspect, paginate, and stop jobs in the same conversation. The job's
exit code and state distinguish success, failure, timeout, and cancellation.
Only the configured prefix of output is retained; excess output is drained and
reported as truncated. Foreground cancellation, timeouts, command completion,
and normal app shutdown clean up the command's process group. Use managed
background mode instead of shell `&`, detached daemons, or commands that escape
the process group. This is process supervision, not an OS sandbox. After an
abnormal server death, previously running jobs are marked **interrupted** and
never replayed; their outcome and surviving processes must be checked manually.
Automatic compaction adds bounded summary requests beyond those 16 model steps.
Databricks inference is billed to your workspace. Endpoints must support streaming,
function calling, and non-streamed text responses for summarization.

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
# Frontend API and React regression tests (Node 24):
(cd frontend && pnpm test)
```

Tests cover all permission modes, approved/denied external CSV listings, persisted
folder grants, shell classification, approval allow/deny,
browser-controlled folder checks/grants/removal, OS-denied access,
cancellation (including process-group termination), path/symlink/secret boundaries,
credential-free shell environment, restart recovery, API access control, WebSocket
snapshots, and stale editor writes. None of these automated tests calls a paid model.
Frontend tests verify that expired local tokens refresh once and that other
errors never replay a potentially completed action, that editor drafts survive saves
and navigation, and that delayed permission responses or deleted conversation URLs
do not corrupt the active view. Backend regressions additionally cover credential
path aliases, unreadable configuration recovery, cancellation during startup or
after a child process outlives its shell, and recovery of completed tool results
after interrupted delivery.

After a production frontend rebuild, refresh the browser. When building the first
bundle after starting the backend, restart the backend to register static assets.

## Architecture

- `backend/local_agent/api.py`: local API, WebSocket stream, workspace endpoints.
- `backend/local_agent/agents.py`: session/approval events and the Databricks tool loop.
- `backend/local_agent/tools.py`: scoped file queries/edits and tool definitions.
- `backend/local_agent/jobs.py`: streamed processes, managed jobs, and cleanup.
- `backend/local_agent/permissions.py`: shared mode rules and model instructions.
- `backend/local_agent/store.py`: SQLite conversation storage.
- `backend/local_agent/config.py`: external credentials and portable configuration.
- `backend/local_agent/context.py`: request estimates and bounded history compaction.
- `backend/local_agent/instructions.py`: scoped project guidance loading.
- `backend/local_agent/recovery.py` / `worktrees.py`: file recovery and Git worktrees.
- `backend/local_agent/extensions.py` / `mcp_client.py`: skills, hooks, MCP lifecycle.
- `backend/local_agent/planning.py` / `feature_tools.py`: tasks and delegated workers.
- `backend/local_agent/feature_api.py`: scoped feature endpoints.
- `backend/local_agent/reasoning.py`: provider reasoning-summary extraction.
- `frontend/src/`: React interface, conversation state, editor, settings and styling.
- `design/`: original visual concept and extracted design tokens.

Provider documentation:
[Databricks function calling](https://docs.databricks.com/aws/en/machine-learning/model-serving/function-calling),
[reasoning models](https://docs.databricks.com/aws/en/machine-learning/model-serving/query-reason-models),
and [official Python MCP transports](https://py.sdk.modelcontextprotocol.io/client/transports/).
