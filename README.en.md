# Bots Group Chat for DeepSeek Harness

[简体中文](README.md) · **English**

> **Bring Bots with different responsibilities into one conversation. Let KingBot moderate the discussion and summarize the results.**

`dsh-bots` adds custom Bots and a group chat mode to DeepSeek Harness. Give each member a name, responsibilities, model, and reasoning effort. Describe a task or `@mention` a member in the native message box, then read each Bot's named replies on a shared timeline.

**Current version `v0.3.4`** · **DeepSeek Harness `0.2.2-rc.1` and `0.2.2-rc.2`** · Supports Desktop and Web

## Fixes in v0.3.4

- In the dedicated chat, KingBot creates or reuses child Bots and revises group proposals in natural language. A short confirmation shows the workspace and members, with task details available on demand. The confirmation button and a written reply apply to the same proposal.
- You can stop, redirect, or mention one Bot while KingBot or a member is working. KingBot pauses dispatch and asks when it detects a possible interruption but cannot determine the intent.
- A failed moderation request is retried. KingBot can continue with an eligible speaker and mark missing contributions or evidence in the summary.
- Group chats import each attachment independently, so usable documents remain available. Bots explain unavailable tools, sandbox denials, and operations that require interactive approval.

## Fixes in v0.3.3

- KingBot prioritizes requests to pause or change direction. It keeps completed replies and asks what to do next, or starts the replacement task the user supplied.
- Mentioning one child Bot gives that Bot the turn. A single mention during a discussion can interrupt the active turn. Each Bot uses its configured identity and role, with chat context scoped to the group.
- KingBot and child Bots inherit the conversation's Harness tool preset and working directory when executing tasks, including file tools, available web tools, and skills.
- A document dropped into the desktop composer becomes a readable attachment even when the composer inserts only its absolute path.

## Fixes in v0.3.2

- If KingBot tries to close a discussion early, it retries with the current list of eligible speakers. If the retry is unusable, an eligible Bot contributes and KingBot moderates the next exchange.
- Harness's steer action interrupts the active group reply and carries completed contributions into the next discussion.
- New tasks in the same group start with their own context. Explicit follow-ups retain the relevant discussion.
- Bots can read uploaded text files, Word (.docx), and PDFs with a text layer. The timeline renders Markdown headings, lists, tables, and code blocks.

## New in v0.3.1

- **KingBot moderates group chats by default.** It listens to each contribution before choosing the next speaker, asking a follow-up question, or closing the discussion.
- **Create groups from the dedicated conversation.** KingBot proposes members, suggests new Bots when needed, and waits for confirmation of the destination workspace. For a task, it leads the group and returns the conclusion to the original conversation.
- **More natural Bot creation.** KingBot accepts conversational batch requests, normalizes separators in names, and skips existing members on retry.
- **Compatibility with rc.1 and rc.2.** Existing conversations retain their identities, members, and context. An rc.1-specific `v0.2.2` release is also available.

## New in v0.2.1

- **Selective reset**: Independently reset Bot members, King memory, and old conversation associations, with typed `RESET` confirmation.
- **A fresh execution context**: Retire old IDs and stop injecting pre-reset history. Interrupted resets can resume.
- **Workspace recovery**: Keep the Bots page available when its directory was deleted, and avoid restoring sessions tied to the old location of a moved folder.

## New in v0.2.0

- **A dedicated King conversation**: Choose a workspace and talk directly to KingBot using the native composer.
- **King-created members**: Ask KingBot to name child Bots, describe their capabilities, and save them to the library.
- **Memory across workspaces**: Group chats in other workspaces share memory with the dedicated King conversation, without a fixed entry-count or group-count limit.
- **Workspace cleanup and recovery**: Disabling or uninstalling hides the Bots workspace. Re-enabling or reinstalling restores it while preserving memory and history.

## How to use it

<!-- Screenshot placeholder 1: Group chat overview showing the named replies, bottom member bar, and native message box. Suggested path: assets/group-chat.png. -->

1. **Choose the King workspace.** Open **Bots**, choose an existing folder or enter its absolute path, then enable it. Memory is stored under `.dsh-bots` in that folder.
2. **Define your members.** Open **Bots** above the workspace list in the sidebar. Create a Bot and enter its name and responsibilities, or ask KingBot to create one in its dedicated conversation. A fresh installation shows only **KingBot**, the coordinator, with no preset child Bots. You create all child Bots yourself; KingBot joins every group automatically.
3. **Start a group chat.** Create a conversation in a workspace other than the dedicated King workspace. Select **群聊** (Group chat) near the message box, choose members, and click **确认成员** (Confirm members). Select **默认** (Default) to use Harness's native conversation behavior.
4. **Send a task.** Describe your goal and let KingBot moderate. Mention one child Bot for a direct reply or mention several to have KingBot moderate among those members.
5. **Read the results.** The timeline shows moderator questions, named member replies, and the coordinator's summary in order. Click a member below the timeline to insert a mention. The member bar scrolls horizontally when needed.

| What you want | Example prompt |
| --- | --- |
| Ask KingBot to moderate | “Discuss the design of an offline task-list app. Compare implementation options and risks, then summarize the conclusion.” |
| Ask one member | “@Architect Suggest the modules and explain the main technical tradeoffs.” |
| Ask several members | “@Architect @Reviewer Discuss gaps and edge cases in the design.” |
| Pause the group | “Let's stop here. I want to rethink the direction.” |
| Save a personal preference | In the dedicated KingBot conversation, say “Remember that I prefer conclusions first, followed by implementation steps.” |

Create and add the example Bots Architect and Reviewer before mentioning them. With no child Bot mentions, KingBot chooses who to invite from the group.

The group chat fills the available height. The timeline and member bar follow the message box's width, with scrolling inside the timeline. The native **Team, Trajectory, and Context** views remain available.

## Installation

Configure a working model in Harness's standard API settings first. The plugin uses the host's model configuration. To install from a local package, download `dsh-bots-0.3.4.tgz` from the [v0.3.4 release](https://github.com/lonelycrab888/dsh-bots/releases/tag/v0.3.4).

To upgrade, quit Harness, run `add` against the same profile, then reopen Harness. The plugin keeps using the existing Bot configuration, memory database, and conversation history.

### Desktop

Open **Plugins → Add Plugin**, select the **official npm registry** as the installation source, and paste this Git URL into **Package name or address**:

```text
git+https://github.com/lonelycrab888/dsh-bots.git#main
```

`#main` installs directly from the main branch. Its v0.3.4 package supports both `rc.1` and `rc.2`. Use the plugin index below to select the latest release compatible with your Harness version.

**Choose the latest compatible release from the index**

1. Enable **Custom plugin indexes** under **Plugins → Installed → Experimental plugins**.
2. Open **Discover**. If an index is already configured, select **Manage index sources…** from the index menu. For a first index, select **Add index source**.
3. Paste the URL below and select **Add**. Close the dialog and open **Bots Group Chat** in the **dsh-bots** index to see the recommended version.

```text
https://raw.githubusercontent.com/lonelycrab888/dsh-bots/main/market-index.json
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
package_file="$(npm pack --silent)"
```

In the same terminal, add the generated package to the appropriate profile. If you downloaded the release package, run `package_file=dsh-bots-0.3.4.tgz` in the folder containing it and then run the relevant install command.

```sh
# Desktop (default macOS application path)
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/$package_file"

# Web
dsh plugin --profile web add "$PWD/$package_file"
```

## Talk to KingBot directly

After choosing a workspace, click **与 KingBot 对话** (Talk to KingBot) to open or resume its single dedicated conversation. It uses the native composer and stop control and requires no child Bots.

For example: “Create two child Bots, one for architecture and one for quality assurance. Choose their names and describe their capabilities.” The host validates the proposed definitions and saves them with fresh IDs. Select the new members when creating a group; they do not automatically join existing groups.

<!-- Screenshot placeholder 5: The dedicated King conversation showing a request to create child Bots and the resulting confirmation. Suggested path: assets/king-chat.png. -->

**The dedicated workspace is reserved for KingBot.** New ordinary conversations and group chats are rejected there. Existing group history remains readable, but those groups cannot continue running. Create group chats in other workspaces.

The first setup imports legacy saved memories once. Switching the King workspace selects an independent memory store in the new folder; the old folder's data is preserved and is not merged automatically. Groups in every workspace use the currently selected King workspace's memory store.

## Bot definitions and model settings

<!-- Screenshot placeholder 2: The Bots page showing KingBot, child Bot cards, the member limit, model selectors, and reasoning effort selectors. Suggested path: assets/bot-library.png. -->

Each child Bot has a name and responsibilities. Long descriptions scroll within their cards, while model settings, reasoning effort, and action buttons stay aligned.

| Setting | Behavior |
| --- | --- |
| **Name and responsibilities** | Names must be unique and contain at most 24 characters, using Chinese characters, Latin letters, digits, underscores, or hyphens. Responsibilities can contain up to 6,000 characters |
| **Maximum child Bots per group** | Choose 1–12; the initial default is 4. KingBot joins automatically and does not count toward the limit |
| **Model** | Follows the current conversation by default. You can assign a host-configured model to KingBot or any child Bot |
| **Reasoning effort** | After choosing a model, select one of its native effort levels or use the model default. Following the current conversation also inherits its reasoning effort |
| **Disable and restore** | Disabled Bots are excluded from new group selections. Enable “Show disabled Bots” to restore them |
| **Delete** | After confirmation, removes the definition and permanently retires its ID. Recreating the same name generates a new ID |

Model and reasoning options come from the host's standard API configuration. After changing that configuration, click **刷新配置** (Refresh configuration) to reload the choices. If a model exposes no effort choices, the effort selector is disabled with an explanation. Switching models clears the previously selected effort to avoid an incompatible value.

**Names, responsibilities, and member limits apply to new groups. Model and effort settings are read on the next Bot execution and also apply to existing groups.** Existing groups retain a snapshot of their members' responsibilities; editing or disabling a definition does not rewrite historical members or replies. The library holds up to 100 Bots, including disabled ones.

### Deleting and recreating Bots

Click **删除** (Delete) on a child Bot card, review the notice, then choose **确认删除** (Confirm deletion). KingBot cannot be deleted.

- Deletion revokes the Bot's dispatch eligibility across all groups and cancels group turns currently running. Existing groups retain historical replies, but no longer offer that Bot in the member bar.
- On its next execution, KingBot starts a fresh coordination session without injecting group context from before deletion. Retired IDs in personal memory are replaced with “∅” (deleted ID); unrelated preferences remain intact.
- Recreating the same name generates a new identity. Create a new group and select the new Bot; it does not inherit the deleted Bot's session or identity.
- Internal retirement records keep old IDs unavailable for reuse. These records are not supplied as the coordinator's memory. Historical logs remain, so “forgetting” means removing IDs from model context and dispatch, not erasing every historical record from disk.

Upgrading does not clear existing Bot definitions or personal memories. If old members reappear after reinstalling into a previously used profile, delete them from the library. A fresh profile starts with no child Bots and no preloaded long-term memories.

## How KingBot moderates group chats

Send a message in the group. KingBot selects one speaker at a time, reads the actual response, and decides whom to invite next or when to close. Use `@Architect @Reviewer` to limit participants. With one named Bot, that Bot responds directly.

To redirect an active discussion, enter a new instruction and use Harness's Steer message action. With the default queue preference, press `Command+Enter` on macOS or `Ctrl+Enter` on Windows and Linux. Plain Enter queues the message. Steering stops the active reply and lets KingBot continue using the new instruction and completed contributions. You can also ask KingBot to pause in your own words. It will ask what to do next, or proceed with a concrete replacement task you supplied.

You can start a new task directly in the same group. To continue an earlier discussion, say “Please continue with the previous proposal.” Each member can speak up to twice per discussion. The design draws on Grok Bot's targeted mentions and visible handoffs. [Grok Bot group chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration)

### Files, web tools, and skills

Drop a document into the native composer, describe what to check, and send. Use `@name` to choose who replies. If the desktop composer inserts only `@/absolute/path` or `@"absolute path with spaces"`, the plugin saves the file as an attachment. Supported documents include text, Word `.docx`, and PDFs with a text layer, up to 20 MB each. Each import failure is reported separately, and the remaining attachments are still available. Follow-ups on the same topic can reuse those attachments. Scanned PDFs need text recognition first.

KingBot and child Bots inherit the conversation's Harness Agent preset, working directory, and sandbox policy when executing tasks. The preset and host configuration determine which tools are available, including file tools from `@deepseek-ai/dsh-tool-fs` and available `web_search` and `web_fetch` tools. Web search uses the provider and credentials configured in Harness. Delegated sessions use Harness's noninteractive approval policy. Operations that require interactive approval are denied.

Bots can load `SKILL.md` with `skill` and open referenced files with `read`. `@deepseek-ai/dsh-agent-instructions` loads workspace instructions such as `AGENTS.md` according to the host configuration, with a default limit of 65,536 bytes.

## Ask KingBot to set up a group and follow through

In the dedicated conversation, ask KingBot to discuss an earlier topic with a group and return a result. KingBot briefly confirms the title and members and proposes specific roles to fill any gaps. You can name members yourself or ask for a group without a task.

1. Review the members and expand **查看群聊任务** (View group task) when there is a task. Say “Replace the reviewer with the statistician” to update the roster.
2. Reply `Workspace: name or path` to choose or change the workspace. Use the full path to distinguish duplicate names.
3. Click **确认建群** (Confirm group) or reply `Confirm group` to approve the destination and any proposed new Bots. Click **取消方案** (Cancel proposal) or reply `Cancel group` to cancel.

KingBot adds an **打开群聊** (Open group) button to the original conversation. When the approved group has a task, KingBot moderates the discussion and posts the resulting conclusion there. A group created without a task waits for a message.

## How memory works

<!-- Screenshot placeholder 4: KingBot's memory manager showing the memory and automatic-update switches, active entries, and removed entries. Suggested path: assets/king-memory.png. -->

| Data | Where it is saved | Across group chats? |
| --- | --- | --- |
| Bot definitions and model choices | Plugin configuration in the current profile | Groups in the same profile can reuse definitions |
| Group history and Bot child sessions | Their own group conversation | Child Bots do not automatically read other groups' histories |
| KingBot's personal long-term memory | SQLite database in the selected King workspace | Shared by the dedicated King conversation and groups in other workspaces |

Long-term memory stores explicit requests, stable preferences, and lasting background information. **It does not automatically memorize the full text of every past group chat.** When memory and automatic updates are enabled, memories are extracted from the current user message and retain the supporting original text. Child Bot output is not automatically treated as a fact about the user. Only KingBot reads shared memory directly, though it may include relevant information in an assignment.

Open **Bots → KingBot → 管理工作区记忆** (Manage workspace memory) to search, browse pages, add, edit, pin, archive, restore, and export entries. You can disable memory entirely or turn off automatic updates separately. With memory and automatic updates enabled, you can say in the dedicated KingBot conversation:

```text
Remember: when proposing a solution, give the conclusion first and then the implementation steps.
Forget my earlier preference about response formatting.
```

There is no fixed total-entry limit and no limit tied to the number of group chats. Each entry can contain up to **600 characters**, with up to 3 automatic updates per turn. Local SQLite/FTS5 storage retrieves a bounded selection of pinned, matching, and recent entries for each request. Search uses keywords and Chinese bigrams rather than vector embeddings. See [memory design and references](MEMORY-DESIGN.md).

Removing an entry stops future shared-memory injection but does not delete the original conversation. That group may still know the information from its own context. Disabling memory stops injection while retaining saved entries.

## Current scope

- **Group timeline.** Group chats support document attachments and Markdown replies. Bot replies appear when complete.
- **Group context.** Each discussion uses its own Bot execution sessions. Follow-ups draw on relevant messages in the current group's history.
- **Native controls.** The plugin uses the native message box, stop control, and model configuration, and preserves native views such as Team. Enhancement Switches is not required.
- **History compatibility.** Two-Bot group histories from early development prototypes are supported. Sending another message in an old group adds KingBot automatically. The legacy `@主Bot` mention remains supported.

## Disable or uninstall

Disable or uninstall the plugin in the desktop **Plugins** panel. For Web CLI:

```sh
dsh plugin --profile web remove dsh-bots
```

Disabling or uninstalling removes the Bots entry, group chat overlay, styles, and listeners, restoring the native conversation layout. The plugin does not overwrite global API, model, or Agent Loop configuration. The dedicated Bots workspace is also removed from the sidebar; its visible sessions are temporarily archived to prevent them from appearing as ungrouped sessions. Re-enabling or reinstalling restores the workspace and its previously visible sessions. Previously archived sessions stay archived. Workspace files, King memory, and conversation history are preserved.

**Bot definitions, long-term memory, and group history are retained and can be restored after reinstallation.** This does not erase historical data or undo host settings you changed yourself while using the plugin.

## Reset Bots data

Open **Bots → KingBot → 重置 Bots 数据** (Reset Bots data), select the items to reset, type `RESET`, and confirm. Nothing is selected by default. Stop active Bot tasks before resetting.

| Option | Result |
| --- | --- |
| **Bots members** | Deletes all child Bots, including disabled ones, while retaining King, its model, and the group size limit. Old IDs remain retired; recreated names receive new IDs |
| **King memory** | Clears active, archived, and pinned entries, their index and prior audit contents in the selected workspace, plus legacy migration entries. Memory switches remain unchanged. Select a workspace first |
| **Old conversation associations** | Unbinds the dedicated workspace and King conversation, archives its sessions, and makes old groups read-only. Choosing a workspace again creates a fresh dedicated King conversation |

Only selected items are reset. Resetting associations alone preserves memory; selecting the original folder reconnects that memory store. Bot execution contexts are renewed without injecting pre-reset history. Interrupted resets retain their pending intent and resume after restart; Bot execution stays paused until completion, and the reset panel also offers a retry.

**Reset cannot be undone through the plugin, but it does not delete original chat logs, exported files, or memory files in other workspace folders.** Selecting all options starts over; removing historical files from disk remains a separate host operation. If the workspace directory was manually deleted, startup clears the invalid association and retains Bot definitions so you can select an existing directory again. The plugin does not silently create a folder.

<!-- Screenshot placeholder 6: Reset panel with three independent choices and the RESET confirmation field. Suggested path: assets/reset-data.png. -->

## Development and verification

`npm run typecheck` checks types. `npm test` covers configuration validation, member selection, mention routing, task plans, memory, model and effort persistence, and activation cleanup. `npm run build` generates release files.

Automated coverage includes persistence and retrieval beyond 32 memories, reopening the database, revision conflicts, member creation and retired IDs, dedicated workspace restrictions, and workspace recovery after disabling.

`npm run smoke` uses Chrome, the Playwright CLI, and a local model stub in an isolated Web profile to check installation, group creation, dynamic moderation, pausing, mentions, returning results, recovery after restart, and context isolation across groups. It compares file reads, skill references, `AGENTS.md`, and `web_search` with a test provider in native sessions and group chats.

The v0.2.1 reset feature was checked through the UI in an isolated profile with synthetic data, including separate member, memory, and association resets and recovery from a missing workspace directory.
