# Bots Group Chat for DeepSeek Harness

[简体中文](README.md) · **English**

> **Bring Bots with different responsibilities into one conversation. Let Bots King assign tasks and bring the results together.**

`dsh-bots` adds custom Bots and a group chat mode to DeepSeek Harness. Give each member a name, responsibilities, model, and reasoning effort. Describe a task or `@mention` a member in the native message box, then read each Bot's named replies on a shared timeline.

**Current version: `v0.1.0`** · **Desktop tested with DeepSeek Harness `0.2.2-rc.1`** · Supports Desktop and Web

## How to use it

<!-- Screenshot placeholder 1: Group chat overview showing the named replies, bottom member bar, and native message box. Suggested path: assets/group-chat.png. -->

1. **Define your members.** Open **Bots** above the workspace list in the sidebar. Create a Bot and enter its name and responsibilities. **Bots King**, the coordinator, is shown by default and joins every group automatically.
2. **Start a group chat.** Create a conversation and choose a workspace. Select **群聊** (Group chat) near the message box, choose members, and click **确认成员** (Confirm members). Select **默认** (Default) to use Harness's native conversation behavior.
3. **Send a task.** Describe your goal in the native message box and let Bots King assign the work. Use `@name` to restrict which child Bots participate in the current turn.
4. **Read the results.** The timeline shows assignments, named member replies, and the coordinator's summary in order. Click a member below the timeline to insert a mention. The member bar scrolls horizontally when needed.

| What you want | Example prompt |
| --- | --- |
| Let the coordinator assign work | “Design an offline task-list app. Ask members for implementation and acceptance-test suggestions, then summarize the results.” |
| Ask one member | “@Architect Suggest the modules and explain the main technical tradeoffs.” |
| Ask several members | “@Architect @Reviewer Propose a design, then check it for omissions and edge cases.” |
| Ask the coordinator directly | “@Bots King Summarize the conclusions so far without assigning new tasks.” |
| Save a personal preference | “@Bots King Remember that I prefer conclusions first, followed by implementation steps.” |

Create and add the example members to the group before mentioning them. With no mentions, or only `@Bots King`, the coordinator decides whether and whom to delegate to. Mentioning child Bots limits this turn's delegated tasks to those members.

The group chat fills the available height. The timeline and member bar follow the message box's width, with scrolling inside the timeline. The native **Team, Trajectory, and Context** views remain available.

## Installation

Configure a working model in Harness's standard API settings first. The plugin uses the host's model configuration; it does not need a separate API key.

### Desktop

Open **Plugins → Add Plugin**, select the **official npm registry** as the installation source, and paste this Git URL into **Package name or address**:

```text
git+https://github.com/lonelycrab888/dsh-bots.git#v0.1.0
```

Enable **dsh-bots** in the Plugins panel after installation. If **Bots** does not appear in the sidebar, finish any running tasks, fully quit the desktop app, and reopen it.

The Git URL locates the plugin; the npm registry supplies its dependencies. If GitHub returns a 404 for an npm dependency during installation, check that the repository URL was not entered as the installation source.

### Web CLI

```sh
dsh plugin --profile web add 'git+https://github.com/lonelycrab888/dsh-bots.git#v0.1.0'
dsh web
```

The local repository includes compiled files in `lib/`; include them when publishing. Desktop and Web use separate profiles. Bot definitions, long-term memories, and conversation data do not automatically sync between profiles.

### Build a local package

Run these commands from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm pack
```

Add the generated package to the appropriate profile:

```sh
# Desktop (default macOS application path)
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/dsh-bots-0.1.0.tgz"

# Web
dsh plugin --profile web add "$PWD/dsh-bots-0.1.0.tgz"
```

## Bot definitions and model settings

<!-- Screenshot placeholder 2: The Bots page showing Bots King, child Bot cards, the member limit, model selectors, and reasoning effort selectors. Suggested path: assets/bot-library.png. -->

Each child Bot has a name and responsibilities. Long descriptions scroll within their cards, while model settings, reasoning effort, and action buttons stay aligned.

| Setting | Behavior |
| --- | --- |
| **Name and responsibilities** | Names must be unique and contain at most 24 characters, using Chinese characters, Latin letters, digits, underscores, or hyphens. Responsibilities can contain up to 6,000 characters |
| **Maximum child Bots per group** | Choose 1–12; the initial default is 4. Bots King joins automatically and does not count toward the limit |
| **Model** | Follows the current conversation by default. You can assign a host-configured model to Bots King or any child Bot |
| **Reasoning effort** | After choosing a model, select one of its native effort levels or use the model default. Following the current conversation also inherits its reasoning effort |
| **Disable and restore** | Disabled Bots are excluded from new group selections. Enable “Show disabled Bots” to restore them |

Model and reasoning options come from the host's standard API configuration. After changing that configuration, click **刷新配置** (Refresh configuration) to reload the choices. If a model exposes no effort choices, the effort selector is disabled with an explanation. Switching models clears the previously selected effort to avoid an incompatible value.

**Names, responsibilities, and member limits apply to new groups. Model and effort settings are read on the next Bot execution and also apply to existing groups.** Existing groups retain a snapshot of their members' responsibilities; editing or disabling a definition does not rewrite historical members or replies. The library holds up to 100 Bots, including disabled ones.

## How Bots King assigns tasks

<!-- Screenshot placeholder 3: A complete turn showing the user's goal, Bots King's assignments, member replies, and the final summary. Suggested path: assets/task-dispatch.png. -->

Bots King interprets the goal and plans tasks around the current members' responsibilities. Child Bots run **sequentially**. Later members can refer to earlier members' results from the same turn, and Bots King summarizes at the end. Each child Bot receives at most one task per turn. The coordinator can answer simple requests directly.

The plugin checks the plan's members, task count, and mention restrictions. It attempts one correction for an invalid plan, then reports an error if validation still fails. Failed member tasks retain their error information for the coordinator to explain in its summary.

A typical turn makes one planning request, one execution request per participating member, and one summary request. Token use depends on the task and number of members. **Defining Bots, selecting members, and changing settings do not call a model.**

Use Harness's native stop button to cancel the current turn. Tasks that have not started will not be dispatched. Restarting restores members and history without automatically rerunning interrupted tasks.

## How memory works

<!-- Screenshot placeholder 4: Bots King's memory manager showing the memory and automatic-update switches, active entries, and removed entries. Suggested path: assets/king-memory.png. -->

| Data | Where it is saved | Across group chats? |
| --- | --- | --- |
| Bot definitions and model choices | Plugin configuration in the current profile | Groups in the same profile can reuse definitions |
| Group history and Bot child sessions | Their own group conversation | Child Bots do not automatically read other groups' histories |
| Bots King's personal long-term memory | Plugin configuration in the current profile | Shared by Bots King across groups in that profile |

Long-term memory stores explicit requests, stable preferences, and lasting background information. **It does not automatically memorize the full text of every past group chat.** By default, memories are extracted from the current user message and retain the supporting original text. Child Bot output is not automatically treated as a fact about the user. Only Bots King reads shared memory directly, though it may include relevant information in an assignment.

Open **Bots → Bots King → 管理长期记忆** (Manage long-term memory) to view, add, edit, remove, or restore entries. You can disable memory entirely or turn off automatic updates separately. You can also ask in a group chat:

```text
@Bots King Remember: when proposing a solution, give the conclusion first and then the implementation steps.
@Bots King Forget my earlier preference about response formatting.
```

Memory supports up to **32 active entries**, each containing at most **600 characters**. Active and removed entries together are limited to 128, with up to 3 updates per turn. When capacity is reached, the plugin asks you to manage existing entries instead of silently evicting them. Concurrent changes are checked against the configuration revision; refresh and retry after a conflict.

Removing an entry stops future shared-memory injection but does not delete the original conversation. That group may still know the information from its own context. Disabling memory stops injection while retaining saved entries.

## Current scope

- **Text group chats and sequential assignments.** Bot tool calls are disabled in this version. Bots cannot directly run terminal commands, edit files, or use search tools through this plugin. Parallel dispatch, attachments, Markdown rendering, streaming replies, and workflow dependency graphs are not yet supported.
- **Host Agent runtime.** Bots King and child Bots use separate persistent Agent sessions. Using the host's Agent runtime does not enable all tools or change global Agent Loop settings.
- **Native controls.** The plugin uses the native message box, stop control, and model configuration, and preserves native views such as Team. Enhancement Switches is not required.
- **History compatibility.** Two-Bot group histories from early development prototypes are supported. Sending another message in an old group adds Bots King automatically. The legacy `@主Bot` mention remains supported.

## Disable or uninstall

Disable or uninstall the plugin in the desktop **Plugins** panel. For Web CLI:

```sh
dsh plugin --profile web remove dsh-bots
```

Disabling or uninstalling removes the Bots entry, group chat overlay, styles, and listeners, restoring the native conversation layout. The plugin does not overwrite global API, model, or Agent Loop configuration.

**Bot definitions, long-term memory, and group history are retained and can be restored after reinstallation.** This does not erase historical data or undo host settings you changed yourself while using the plugin.

## Development and verification

`npm run typecheck` checks types. `npm test` covers configuration validation, member selection, mention routing, task plans, memory, model and effort persistence, and activation cleanup. `npm run build` generates release files.

`scripts/smoke.mjs` provides isolated Web tests with a model stub and requires Chrome and the Playwright CLI. This version passed 21 automated tests, plus desktop checks for cards, effort persistence, the native Team view, and disable/uninstall behavior. Alignment after dragging the message-box width still needs manual verification; a reliable desktop automation result has not yet been obtained.
