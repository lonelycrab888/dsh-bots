# Bots Group Chat for DeepSeek Harness

[简体中文](README.md) · **English**

> **Bring Bots with different responsibilities into one conversation. Let Bots King assign tasks and bring the results together.**

`dsh-bots` adds custom Bots and a group chat mode to DeepSeek Harness. Give each member a name, responsibilities, model, and reasoning effort. Describe a task or `@mention` a member in the native message box, then read each Bot's named replies on a shared timeline.

**Current version: `v0.2.0`** · **Desktop tested with DeepSeek Harness `0.2.2-rc.1`** · Supports Desktop and Web

## New in v0.2.0

- **A dedicated King conversation**: Choose a workspace and talk directly to Bots King using the native composer.
- **King-created members**: Ask Bots King to name child Bots, describe their capabilities, and save them to the library.
- **Memory across workspaces**: Group chats in other workspaces share memory with the dedicated King conversation, without a fixed entry-count or group-count limit.
- **Workspace cleanup and recovery**: Disabling or uninstalling hides the Bots workspace. Re-enabling or reinstalling restores it while preserving memory and history.

## How to use it

<!-- Screenshot placeholder 1: Group chat overview showing the named replies, bottom member bar, and native message box. Suggested path: assets/group-chat.png. -->

1. **Choose the King workspace.** Open **Bots**, choose an existing folder or enter its absolute path, then enable it. Memory is stored under `.dsh-bots` in that folder.
2. **Define your members.** Open **Bots** above the workspace list in the sidebar. Create a Bot and enter its name and responsibilities, or ask Bots King to create one in its dedicated conversation. A fresh installation shows only **Bots King**, the coordinator, with no preset child Bots. You create all child Bots yourself; Bots King joins every group automatically.
3. **Start a group chat.** Create a conversation in a workspace other than the dedicated King workspace. Select **群聊** (Group chat) near the message box, choose members, and click **确认成员** (Confirm members). Select **默认** (Default) to use Harness's native conversation behavior.
4. **Send a task.** Describe your goal in the native message box and let Bots King assign the work. Use `@name` to restrict which child Bots participate in the current turn.
5. **Read the results.** The timeline shows assignments, named member replies, and the coordinator's summary in order. Click a member below the timeline to insert a mention. The member bar scrolls horizontally when needed.

| What you want | Example prompt |
| --- | --- |
| Let the coordinator assign work | “Design an offline task-list app. Ask members for implementation and acceptance-test suggestions, then summarize the results.” |
| Ask one member | “@Architect Suggest the modules and explain the main technical tradeoffs.” |
| Ask several members | “@Architect @Reviewer Propose a design, then check it for omissions and edge cases.” |
| Ask the coordinator directly | “@Bots King Summarize the conclusions so far without assigning new tasks.” |
| Save a personal preference | “@Bots King Remember that I prefer conclusions first, followed by implementation steps.” |

Architect and Reviewer are examples, not preinstalled Bots. Create and add the example members to the group before mentioning them. With no mentions, or only `@Bots King`, the coordinator decides whether and whom to delegate to. Mentioning child Bots limits this turn's delegated tasks to those members.

The group chat fills the available height. The timeline and member bar follow the message box's width, with scrolling inside the timeline. The native **Team, Trajectory, and Context** views remain available.

## Installation

Configure a working model in Harness's standard API settings first. The plugin uses the host's model configuration; it does not need a separate API key.

### Desktop

Open **Plugins → Add Plugin**, select the **official npm registry** as the installation source, and paste this Git URL into **Package name or address**:

```text
git+https://github.com/lonelycrab888/dsh-bots.git#main
```

Enable **dsh-bots** in the Plugins panel after installation. If **Bots** does not appear in the sidebar, finish any running tasks, fully quit the desktop app, and reopen it.

The Git URL locates the plugin; the npm registry supplies its dependencies. If GitHub returns a 404 for an npm dependency during installation, check that the repository URL was not entered as the installation source.

### Web CLI

```sh
dsh plugin --profile web add 'git+https://github.com/lonelycrab888/dsh-bots.git#main'
dsh web
```

The local repository includes compiled files in `lib/`; include them when publishing. Desktop and Web use separate profiles. Bot definitions and conversations do not automatically sync between profiles. Memory is shared only when profiles explicitly select the same workspace directory.

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
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/dsh-bots-0.2.0.tgz"

# Web
dsh plugin --profile web add "$PWD/dsh-bots-0.2.0.tgz"
```

## Talk to Bots King directly

After choosing a workspace, click **与 Bots King 对话** (Talk to Bots King) to open or resume its single dedicated conversation. It uses the native composer and stop control and requires no child Bots.

For example: “Create two child Bots, one for architecture and one for quality assurance. Choose their names and describe their capabilities.” The host validates the proposed definitions and saves them with fresh IDs. Select the new members when creating a group; they do not automatically join existing groups.

<!-- Screenshot placeholder 5: The dedicated King conversation showing a request to create child Bots and the resulting confirmation. Suggested path: assets/king-chat.png. -->

**The dedicated workspace is reserved for Bots King.** New ordinary conversations and group chats are rejected there. Existing group history remains readable, but those groups cannot continue running. Create group chats in other workspaces.

The first setup imports legacy saved memories once. Switching the King workspace selects an independent memory store in the new folder; the old folder's data is preserved and is not merged automatically. Groups in every workspace use the currently selected King workspace's memory store.

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
| **Delete** | After confirmation, removes the definition and permanently retires its ID. Recreating the same name generates a new ID |

Model and reasoning options come from the host's standard API configuration. After changing that configuration, click **刷新配置** (Refresh configuration) to reload the choices. If a model exposes no effort choices, the effort selector is disabled with an explanation. Switching models clears the previously selected effort to avoid an incompatible value.

**Names, responsibilities, and member limits apply to new groups. Model and effort settings are read on the next Bot execution and also apply to existing groups.** Existing groups retain a snapshot of their members' responsibilities; editing or disabling a definition does not rewrite historical members or replies. The library holds up to 100 Bots, including disabled ones.

### Deleting and recreating Bots

Click **删除** (Delete) on a child Bot card, review the notice, then choose **确认删除** (Confirm deletion). Bots King cannot be deleted.

- Deletion revokes the Bot's dispatch eligibility across all groups and cancels group turns currently running. Existing groups retain historical replies, but no longer offer that Bot in the member bar.
- On its next execution, Bots King starts a fresh coordination session without injecting group context from before deletion. Retired IDs in personal memory are replaced with “∅” (deleted ID); unrelated preferences remain intact.
- Recreating the same name generates a new identity. Create a new group and select the new Bot; it does not inherit the deleted Bot's session or identity.
- Internal retirement records keep old IDs unavailable for reuse. These records are not supplied as the coordinator's memory. Historical logs remain, so “forgetting” means removing IDs from model context and dispatch, not erasing every historical record from disk.

Upgrading does not clear existing Bot definitions or personal memories. If old members reappear after reinstalling into a previously used profile, delete them from the library. A fresh profile starts with no child Bots and no preloaded long-term memories.

## How Bots King assigns tasks

<!-- Screenshot placeholder 3: A complete turn showing the user's goal, Bots King's assignments, member replies, and the final summary. Suggested path: assets/task-dispatch.png. -->

Bots King interprets the goal and plans tasks around the current members' responsibilities. Child Bots run **sequentially**. Later members can refer to earlier members' results from the same turn, and Bots King summarizes at the end. Each child Bot receives at most one task per turn. The coordinator can answer simple requests directly.

The plugin checks the plan's members, task count, and mention restrictions. It attempts one correction for an invalid plan, then reports an error if validation still fails. Failed member tasks retain their error information for the coordinator to explain in its summary.

A typical turn makes one planning request, one execution request per participating member, and one summary request. Token use depends on the task and number of members. **Manually defining Bots, selecting members, and changing settings do not call a model. Asking Bots King to create members in conversation does call a model.**

Use Harness's native stop button to cancel the current turn. Tasks that have not started will not be dispatched. Restarting restores members and history without automatically rerunning interrupted tasks.

## How memory works

<!-- Screenshot placeholder 4: Bots King's memory manager showing the memory and automatic-update switches, active entries, and removed entries. Suggested path: assets/king-memory.png. -->

| Data | Where it is saved | Across group chats? |
| --- | --- | --- |
| Bot definitions and model choices | Plugin configuration in the current profile | Groups in the same profile can reuse definitions |
| Group history and Bot child sessions | Their own group conversation | Child Bots do not automatically read other groups' histories |
| Bots King's personal long-term memory | SQLite database in the selected King workspace | Shared by the dedicated King conversation and groups in other workspaces |

Long-term memory stores explicit requests, stable preferences, and lasting background information. **It does not automatically memorize the full text of every past group chat.** When memory and automatic updates are enabled, memories are extracted from the current user message and retain the supporting original text. Child Bot output is not automatically treated as a fact about the user. Only Bots King reads shared memory directly, though it may include relevant information in an assignment.

Open **Bots → Bots King → 管理工作区记忆** (Manage workspace memory) to search, browse pages, add, edit, pin, archive, restore, and export entries. You can disable memory entirely or turn off automatic updates separately. You can also ask in a group chat:

```text
@Bots King Remember: when proposing a solution, give the conclusion first and then the implementation steps.
@Bots King Forget my earlier preference about response formatting.
```

There is no fixed total-entry limit and no limit tied to the number of group chats. Each entry can contain up to **600 characters**, with up to 3 automatic updates per turn. Local SQLite/FTS5 storage retrieves a bounded selection of pinned, matching, and recent entries for each request. Search uses keywords and Chinese bigrams rather than vector embeddings. See [memory design and references](MEMORY-DESIGN.md).

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

Disabling or uninstalling removes the Bots entry, group chat overlay, styles, and listeners, restoring the native conversation layout. The plugin does not overwrite global API, model, or Agent Loop configuration. The dedicated Bots workspace is also removed from the sidebar; its visible sessions are temporarily archived to prevent them from appearing as ungrouped sessions. Re-enabling or reinstalling restores the workspace and its previously visible sessions. Previously archived sessions stay archived. Workspace files, King memory, and conversation history are preserved.

**Bot definitions, long-term memory, and group history are retained and can be restored after reinstallation.** This does not erase historical data or undo host settings you changed yourself while using the plugin.

## Development and verification

`npm run typecheck` checks types. `npm test` covers configuration validation, member selection, mention routing, task plans, memory, model and effort persistence, and activation cleanup. `npm run build` generates release files.

Automated coverage includes persistence and retrieval beyond 32 memories, reopening the database, revision conflicts, member creation and retired IDs, dedicated workspace restrictions, and workspace recovery after disabling. All 35 tests passed before release. Desktop checks on the host version listed above covered the native composer, King-created members, group dispatch, memory across workspaces, application restart, disabling, and uninstall/reinstall recovery.

`scripts/smoke.mjs` provides isolated Web model-stub tests and requires Chrome and the Playwright CLI. The full Web flow and all model combinations were not revalidated for this release; desktop results do not establish coverage for those combinations.
