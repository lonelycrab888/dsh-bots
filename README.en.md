# Bots Group Chat for DeepSeek Harness

[简体中文](README.md) · **English**

> **Bring Bots with different responsibilities into one conversation. Let KingBot moderate the discussion and summarize the results.**

`roundtable-bots` adds custom Bots and a group chat mode to DeepSeek Harness. Give each member a name, responsibilities, model, and reasoning effort. Describe a task or `@mention` a member in the native message box, then read each Bot's named replies on a shared timeline.

**Requires DeepSeek Harness `>=0.2.2-rc.1`** (tested on rc.1 and rc.2) · Supports Desktop and Web

## How to use it

<!-- Screenshot placeholder 1: Group chat overview showing message bubbles, topic summary, and native message box. Suggested path: assets/group-chat.png. -->

1. **Choose the King workspace.** Open **Bots**, choose an existing folder or enter its absolute path, then enable it. Memory is stored under `.dsh-bots` in that folder.
2. **Define your members.** Open **Bots** above the workspace list in the sidebar. Create a Bot and enter its name and responsibilities, or ask KingBot to create one in its dedicated conversation. A fresh installation shows only **KingBot**, the coordinator, with no preset child Bots. You create all child Bots yourself; KingBot joins every group automatically.
3. **Start a group chat.** Create a conversation in a workspace other than the dedicated King workspace. Select **群聊** (Group chat) near the message box, choose members, and click **确认成员** (Confirm members). Select **默认** (Default) to use Harness's native conversation behavior.
4. **Send a task.** Describe your goal and let KingBot moderate. Mention one child Bot for a direct reply or mention several to have KingBot moderate among those members.
5. **Read the results.** The bubbles show moderator questions, named member replies, and the coordinator's summary. Type `@` in the composer and choose a Bot from **群聊成员** (Group members).

| What you want | Example prompt |
| --- | --- |
| Ask KingBot to moderate | “Discuss the design of an offline task-list app. Compare implementation options and risks, then summarize the conclusion.” |
| Ask one member | “@Architect Suggest the modules and explain the main technical tradeoffs.” |
| Ask several members | “@Architect @Reviewer Discuss gaps and edge cases in the design.” |
| Pause the group | “Let's stop here. I want to rethink the direction.” |
| Save a personal preference | In the dedicated KingBot conversation, say “Remember that I prefer conclusions first, followed by implementation steps.” |

Create and add the example Bots Architect and Reviewer before mentioning them. With no child Bot mentions, KingBot chooses who to invite from the group.

The group chat fills the available height. The timeline and topic summary follow the message box's width. The native **Team, Trajectory, and Context** views remain available.

## Installation

Configure a working model in Harness's standard API settings first. The plugin uses the host's model configuration. To install from a local package, download `roundtable-bots-0.4.0.tgz`. Build the v0.4.0 package with `npm run build && npm pack`

The plugin appears as `roundtable-bots` in the installed list. To upgrade from the old `dsh-bots` package, quit Harness and switch packages in the same profile.

1. Back up the profile's `cordis.patch.yml`. The default desktop profile stores it at `~/.dsh/profiles/desktop/cordis.patch.yml`.
2. Install `roundtable-bots` with the CLI commands below, then run `dsh plugin --profile desktop remove dsh-bots`. For Desktop, use the bundled CLI path shown below. For Web, use the `web` profile.
3. Find the `id: dsh-bots` entry in the backup and current configuration. Change its `name: dsh-bots` to `name: roundtable-bots` and keep the original `id`, `config`, and other fields. If the entry has no `name`, leave it as is.
4. Reopen Harness. The new package uses the existing workspace memory and the conversation history in the same profile.

### Desktop

Open **Plugins → Add Plugin**, select the **official npm registry** as the installation source, and paste this Git URL into **Package name or address**:

```text
git+https://github.com/lonelycrab888/roundtable-bots.git#main
```

`#main` installs directly from the main branch. The package supports both `rc.1` and `rc.2`. Use the plugin index below to select the latest release compatible with your Harness version.

**Choose the latest compatible release from the index**

1. Enable **Custom plugin indexes** under **Plugins → Installed → Experimental plugins**.
2. Open **Discover**. If an index is already configured, select **Manage index sources…** from the index menu. For a first index, select **Add index source**.
3. Paste the URL below and select **Add**. Close the dialog and open **Bots Group Chat** in the **roundtable-bots** index to see the recommended version.

```text
https://raw.githubusercontent.com/lonelycrab888/roundtable-bots/main/market-index.json
```

Enable **roundtable-bots** in the Plugins panel after installation. If **Bots** does not appear in the sidebar, finish any running tasks, fully quit the desktop app, and reopen it.

The Git URL locates the plugin; the npm registry supplies its dependencies. If GitHub returns a 404 for an npm dependency during installation, check that the repository URL was not entered as the installation source.

### Web CLI

```sh
dsh plugin --profile web add 'git+https://github.com/lonelycrab888/roundtable-bots.git#main'
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

In the same terminal, add the generated package to the appropriate profile. If you downloaded the release package, run `package_file=roundtable-bots-0.4.0.tgz` in the folder containing it and then run the relevant install command.

```sh
# Desktop (default macOS application path)
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/$package_file"

# Web
dsh plugin --profile web add "$PWD/$package_file"
```

## Talk to KingBot directly

After choosing a workspace, click **与 KingBot 对话** (Talk to KingBot) to open or resume its single dedicated conversation. It uses the native Harness Agent, conversation history, streaming, tools and approval flow. You can discuss any topic and ask for normal Agent tasks. Bot creation and group creation/messaging are additional tools.

For example: “Create two child Bots, one for architecture and one for quality assurance. Choose their names and describe their capabilities.” The host validates the proposed definitions and saves them with fresh IDs. Select the new members when creating a group; they do not automatically join existing groups.

<!-- Screenshot placeholder 5: The dedicated King conversation showing a request to create child Bots and the resulting confirmation. Suggested path: assets/king-chat.png. -->

**The dedicated workspace is reserved for KingBot.** New ordinary conversations and group chats are rejected there. Existing group history remains readable, but those groups cannot continue running. Create group chats in other workspaces.

The first setup imports legacy saved memories once. Switching the King workspace selects an independent memory store in the new folder; the old folder's data is preserved and is not merged automatically. Groups in every workspace use the currently selected King workspace's memory store.

## Bot definitions and model settings

<!-- Screenshot placeholder 2: The Bots page showing KingBot, child Bot cards, the member limit, model selectors, and reasoning effort selectors. Suggested path: assets/bot-library.png. -->

The Bot directory shows avatars and names; click either to open settings. KingBot occupies its own row, and each row of child Bots is centered. Avatars have transparent backgrounds. KingBot uses a dark whale in light mode and a white whale in dark mode, with a gold crown in both. The current account avatar appears in direct chats and group chats. The disabled-Bot filter and reset action sit below the directory. Each child Bot has a name and responsibilities.

| Setting | Behavior |
| --- | --- |
| **Name and responsibilities** | Names must be unique and contain at most 24 characters, using Chinese characters, Latin letters, digits, underscores, or hyphens. Responsibilities can contain up to 6,000 characters |
| **Maximum child Bots per group** | Choose 1–12; the initial default is 4. KingBot joins automatically and does not count toward the limit |
| **Model** | Follows the current conversation by default. You can assign a host-configured model to KingBot or any child Bot |
| **Reasoning effort** | After choosing a model, select one of its native effort levels or use the model default. Following the current conversation also inherits its reasoning effort |
| **Disable and restore** | Disabled Bots are excluded from new group selections. Enable “Show disabled Bots” to restore them |
| **Delete** | After confirmation, removes the definition and permanently retires its ID. Recreating the same name generates a new ID |

Model and reasoning options come from the host's standard API configuration. After changing that configuration, click **刷新配置** (Refresh configuration) to reload the choices. If a model exposes no effort choices, the effort selector is disabled with an explanation. Switching models clears the previously selected effort to avoid an incompatible value.

**Names, responsibilities, and member limits apply to new groups. Model and effort settings are read on the next Bot execution and also apply to existing groups.** Existing groups retain a snapshot of their members' responsibilities; editing or disabling a definition does not rewrite historical members or replies. The library holds up to 20 child Bots, including disabled ones.

### Deleting and recreating Bots

Click **删除** (Delete) on a child Bot card, review the notice, then choose **确认删除** (Confirm deletion). KingBot cannot be deleted.

- Deletion revokes the Bot's dispatch eligibility across all groups and cancels group turns currently running. Existing groups retain historical replies. The `@` menu drops the deleted Bot.
- On its next execution, KingBot starts a fresh coordination session without injecting group context from before deletion. Retired IDs in personal memory are replaced with “∅” (deleted ID); unrelated preferences remain intact.
- Recreating the same name generates a new identity. Create a new group and select the new Bot; it does not inherit the deleted Bot's session or identity.
- Internal retirement records keep old IDs unavailable for reuse. These records are not supplied as the coordinator's memory. Historical logs remain, so “forgetting” means removing IDs from model context and dispatch, not erasing every historical record from disk.

Upgrading does not clear existing Bot definitions or personal memories. If old members reappear after reinstalling into a previously used profile, delete them from the library. A fresh profile starts with no child Bots and no preloaded long-term memories.

## How KingBot moderates group chats

Send a message in the group. KingBot selects one speaker at a time, reads the actual response, and decides whom to invite next or when to close. Use `@Architect @Reviewer` to limit participants. With one named Bot, that Bot responds directly.

To redirect an active discussion, enter a new instruction and use Harness's Steer message action. With the default queue preference, press `Command+Enter` on macOS or `Ctrl+Enter` on Windows and Linux. Plain Enter queues the message. Steering stops the active reply and lets KingBot continue using the new instruction and completed contributions. You can also ask KingBot to pause in your own words. It will ask what to do next, or proceed with a concrete replacement task you supplied.

You can start a new task directly in the same group. To continue an earlier discussion, say “Please continue with the previous proposal.” Each member can speak up to twice per discussion. The design draws on Grok Bot's targeted mentions and visible handoffs. [Grok Bot group chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration)

### Runtime and waiting

**The total runtime limit is disabled by default.** Continued output is not interrupted merely for exceeding 120 seconds. User steering and stopping take priority. Published replies and valid partial output are retained; operations with uncertain results require verification before retrying.

`memberLimits` configuration values use milliseconds:

| Setting | Default | Meaning |
| --- | --- | --- |
| `childTotal` | `0` | Disable the total runtime limit |
| `firstToken` | `120000` | Wait for the first model event |
| `modelQuiet` | `90000` | Wait for meaningful generation progress |
| `hostQuiet` | `45000` | Show a waiting notice without cancelling or duplicating the child |

Tools retain their own timeouts and permissions. Provider and Harness limits still apply. A stalled reply is marked incomplete and can be continued.

### Files, web tools, and skills

Drop a document into the native composer, describe what to check, and send. Use `@name` to choose who replies. If the desktop composer inserts only `@/absolute/path` or `@"absolute path with spaces"`, the plugin saves the file as an attachment. Supported documents include text, Word `.docx`, and PDFs with a text layer, up to 20 MB each. Each import failure is reported separately, and the remaining attachments are still available. Follow-ups on the same topic can reuse those attachments. Scanned PDFs need text recognition first.

KingBot private chat runs in its native root Agent with its normal approval policy. Delegated group participants inherit their conversation's Harness Agent preset, working directory, and sandbox policy. The preset and host configuration determine which tools are available, including file tools from `@deepseek-ai/dsh-tool-fs` and available `web_search` and `web_fetch` tools. Web search uses the provider and credentials configured in Harness. Delegated sessions use Harness's noninteractive approval policy. Operations that require interactive approval are denied.

Bots can load `SKILL.md` with `skill` and open referenced files with `read`. `@deepseek-ai/dsh-agent-instructions` loads workspace instructions such as `AGENTS.md` according to the host configuration, with a default limit of 65,536 bytes.

## Ask KingBot to set up a group and follow through

In the dedicated conversation, ask KingBot to discuss an earlier topic with a group and return a result. KingBot creates the group through a tool when the request is sufficiently specified, and asks for missing information when needed. You can name members yourself or ask for a group without a task.

Existing groups remain accessible on later turns and after a restart. Ask KingBot to check progress, forward a literal notice, update requirements, continue the discussion, or start a new task. The host retains confirmed group and workspace identities and asks when a target is ambiguous. Updates stop the old run while preserving context; a new task gets its own goal. Host receipts confirm delivery, and results return to the originating private conversation.

For a pending proposal, provide the missing workspace or revise the members in chat. You can also confirm or cancel it in the receipts panel.

KingBot adds an **打开群聊** (Open group) button to the original conversation. When the approved group has a task, KingBot moderates the discussion and posts the resulting conclusion there. A group created without a task waits for a message.

## How memory works

<!-- Screenshot placeholder 4: KingBot's memory manager showing the memory and automatic-update switches, active entries, and removed entries. Suggested path: assets/king-memory.png. -->

| Data | Where it is saved | Across group chats? |
| --- | --- | --- |
| Bot definitions and model choices | Plugin configuration in the current profile | Groups in the same profile can reuse definitions |
| Group history and Bot child sessions | Their own group conversation | Child Bots do not automatically read other groups' histories |
| KingBot's personal long-term memory | SQLite database in the selected King workspace | Shared by the dedicated King conversation and groups in other workspaces |

Original group messages and attachment references remain in the host journal. Interrupting execution does not clear that history. Each Bot restores the current task, latest user guidance, source-linked extracts and recent originals for its own group, and can retrieve exact older messages or attachments when needed. Long histories use token-budgeted extraction and retrieval. Extracts are lossy, not full-text model memory; precise values and corrections retain their sources. New tasks do not automatically inherit old constraints. Group working memory is isolated from other groups and is not promoted to KingBot’s personal long-term memory.

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
dsh plugin --profile web remove roundtable-bots
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

`npm run smoke` and `npm run smoke:native` use Chrome, the Playwright CLI and a deterministic model stub in an isolated Web profile to check native conversation continuity, file reads, search, Bot creation, group creation and retry, message delivery, and memory after restart.

The reset feature was checked through the UI in an isolated profile with synthetic data, including separate member, memory, and association resets and recovery from a missing workspace directory.

## v0.4.0 private conversations

KingBot private chat uses the native Harness Agent in the root conversation, including streaming, tools, approvals, workspace instructions and context management. Responses use natural language. Bot creation and group creation/messaging are additional tools. Fully specified group requests execute immediately. Missing workspaces produce a pending proposal. Existing private-chat records and group receipts remain accessible in an expandable panel and are supplied as bounded background context.

Run `npm run smoke:native` to check native chat, file reading, Bot and group creation, delivery and memory after restart with the deterministic fixture model.

Group recovery in v0.4.0 binds confirmations to the active topic, includes the previous moderator proposal when continuing, and preserves drafting requests despite pending operations. Reading and discussion can continue while uncertain state-changing operations await verification. Classifier failures report a technical failure and retain progress.
