# Bots Group Chat for DeepSeek Harness

[简体中文](README.md) · **English**

**Standard Agent conversations for every Bot, shared group memory, and collaboration led by King Arthur.**

Chat, write, analyze, search, and work with files in DeepSeek Harness. When a task needs collaboration, ask King Arthur to create Bots, set up a group, and send messages. In groups, King Arthur selects speakers by responsibility, follows up on existing work, and summarizes the results.

**Requires:** DeepSeek Harness `>=0.2.2-rc.2` (current validation baseline: rc.2) · Desktop / Web

The declared range has no upper bound: it accepts later RCs of `0.2.2` and later stable versions. Future host API compatibility still needs validation. Under [npm SemVer rules](https://github.com/npm/node-semver#prerelease-tags), prereleases on a different major/minor/patch tuple, such as `0.3.0-rc.1`, require an explicit range; a lower bound alone cannot admit every future prerelease. Development dependencies remain pinned for reproducible builds.

[Installation](#installation) · [Memory](#how-memory-works)

## Features

- **Download files in group chats.** Local file links support workspace-relative and absolute paths, `file://`, `sandbox:`, and names with spaces or Chinese characters. Uploaded attachments are downloadable and survive restarts. Linked files must still exist on the host and follow host access and size limits; stored uploads are limited to 20 MB. Web links continue to open normally.

- **No manual chats in the King workspace.** Its New Session button is disabled; toolbar and shortcut requests are blocked before contacting the host. Open existing Bot chats through Roundtable, or create ordinary chats and groups in another workspace. Automatic Bot creation, Clear page and King memory reset remain available.

- **King Arthur stays first in its workspace.** Creating or clearing child chats, restarting, and manual reordering preserve King Arthur at the top of its workspace session list.

- **Native private chat for every Bot.** Creation automatically adds one standard Agent conversation in the King workspace. Existing Bots receive one after upgrading. Reopening reuses it; clearing archives the old window and replaces its context. King Arthur retains all management and group tools.
- **Three memory layers.** Each Bot has its own personal memory, access to shared group history, and the current native window context.
- **Visible model reasoning in groups.** Expand the reasoning returned by the model while it streams, or revisit it after restart. Models that do not return reasoning show no reasoning panel.

- **Native Agent conversations.** King Arthur private chat uses Harness streaming, tools, approvals, workspace instructions, and context management. Bot creation and group operations are additional tools.
- **Better group continuation.** Accepting the moderator's suggestion includes its previous proposal. Verification acknowledgements select the active topic, and new drafting requests and corrections reach later assignments.
- **Discuss while verification is pending.** Reading and drafting remain available; new state-changing operations wait for verification. Fixed persistence of verified operations that have no target path.
- **Clearer failure handling.** Intent-classifier failures preserve progress and report the technical failure. The extra group receipts/history panel has been removed from private chat.

- **Memory reset and clear page.** Resetting memory archives the old private chat and starts a fresh context. The private chat's Clear page action starts a blank conversation while keeping long-term memory.
- **Short social replies.** Greetings, thanks, and presence checks receive a short King Arthur reply without creating a discussion task. Concrete requests and child Bot mentions keep their normal routing.

## How to use it

1. **Choose the King workspace.** Open **Roundtable**, choose an existing folder or enter its absolute path, then enable it. Memory is stored under `.dsh-bots` in that folder.
2. **Define your members.** Open **Roundtable** above the workspace list in the sidebar. Create a Bot and enter its name and responsibilities, or ask King Arthur to create one in its dedicated conversation. A fresh installation shows only **King Arthur**, the coordinator, with no preset child Bots. You create all child Bots yourself; King Arthur joins every group automatically.
3. **Start a group chat.** Create a conversation in a workspace other than the dedicated King workspace. Select **群聊** (Group chat) near the message box, choose members, and click **确认成员** (Confirm members). Select **默认** (Default) to use Harness's native conversation behavior.
4. **Send a task.** Describe your goal and let King Arthur moderate. Mention one child Bot for a direct reply or mention several to have King Arthur moderate among those members.
5. **Read the results.** The bubbles show moderator questions, named member replies, and the coordinator's summary. Type `@` in the composer and choose a Bot from **群聊成员** (Group members).

| What you want | Example prompt |
| --- | --- |
| Ask King Arthur to moderate | “Discuss the design of an offline task-list app. Compare implementation options and risks, then summarize the conclusion.” |
| Ask one member | “@Architect Suggest the modules and explain the main technical tradeoffs.” |
| Ask several members | “@Architect @Reviewer Discuss gaps and edge cases in the design.” |
| Pause the group | “Let's stop here. I want to rethink the direction.” |
| Save a personal preference | In the dedicated King Arthur conversation, say “Remember that I prefer conclusions first, followed by implementation steps.” |

Create and add the example Bots Architect and Reviewer before mentioning them. With no child Bot mentions, King Arthur chooses who to invite from the group.

The group chat fills the available height. The timeline and topic summary follow the message box's width. The native **Team, Trajectory, and Context** views remain available.

## Installation

Configure a working model in Harness's standard API settings first. The plugin uses the host configuration and does not need a separate API key.

### Install a local release package

For a local package, download `roundtable-bots-x.x.x.tgz` from the repository’s Releases. Replace `x.x.x` below with the version you downloaded. Quit Harness, open a terminal in the download directory, and run the command for your profile:

```sh
# macOS Desktop (default application path)
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/roundtable-bots-x.x.x.tgz"

# Web
dsh plugin --profile web add "$PWD/roundtable-bots-x.x.x.tgz"
```

Reopen Harness and enable **roundtable-bots** in Plugins. Upgrading the same package preserves Bot definitions, conversations, and workspace memory. Desktop and Web use separate profiles and need separate installations.

### Desktop

Open **Plugins → Add Plugin**, select the **official npm registry** as the installation source, and paste this Git URL into **Package name or address**:

```text
git+https://github.com/lonelycrab888/roundtable-bots.git#main
```

`#main` installs directly from the main branch. The minimum host version is `0.2.2-rc.2`; later versions follow the compatibility range above. Use the plugin index below to select the latest release compatible with your Harness version.

**Choose the latest compatible release from the index**

1. Enable **Custom plugin indexes** under **Plugins → Installed → Experimental plugins**.
2. Open **Discover**. If an index is already configured, select **Manage index sources…** from the index menu. For a first index, select **Add index source**.
3. Paste the URL below and select **Add**. Close the dialog and open **Bots Group Chat** in the **roundtable-bots** index to see the recommended version.

```text
https://raw.githubusercontent.com/lonelycrab888/roundtable-bots/main/market-index.json
```

Enable **roundtable-bots** in the Plugins panel after installation. If **Roundtable** does not appear in the sidebar, finish any running tasks, fully quit the desktop app, and reopen it.

The Git URL locates the plugin; the npm registry supplies its dependencies. If GitHub returns a 404 for an npm dependency during installation, check that the repository URL was not entered as the installation source.

### Web CLI

```sh
dsh plugin --profile web add 'git+https://github.com/lonelycrab888/roundtable-bots.git#main'
dsh web
```

The local repository includes compiled files in `lib/`; include them when publishing. Desktop and Web use separate profiles. Bot definitions and conversations do not automatically sync between profiles. Memory is shared only when profiles explicitly select the same workspace directory.

### Migrate from the old dsh-bots package

**If your installed plugin is older than v0.4.0, we recommend uninstalling it and reinstalling roundtable-bots.** Back up the configuration and retain the original workspace and memory files. After reinstalling, start a new standard dsh conversation and send:

> 我的dsh-bots版本更新了，原插件改名为roundtable-bots，请帮我把之前的记录、记忆文件等适配回新roundtable-bots。

This asks dsh to adapt previous records and memory files from the renamed `dsh-bots` plugin to `roundtable-bots`.

**Note: This does not affect existing Bots' memories, but we strongly recommend recreating child Bots.** Do not delete the workspace's `.dsh-bots` directory or clear memories during reinstallation and migration. The steps below provide a manual configuration reference.

The plugin appears as `roundtable-bots` in the installed list. To upgrade from the old `dsh-bots` package, quit Harness and switch packages in the same profile.

1. Back up the profile's `cordis.patch.yml`. The default desktop profile stores it at `~/.dsh/profiles/desktop/cordis.patch.yml`.
2. Run `dsh plugin --profile desktop remove dsh-bots` to uninstall the old package, then install `roundtable-bots` with the CLI commands above. For Desktop, use the bundled CLI path shown above. For Web, use the `web` profile.
3. Find the `id: dsh-bots` entry in the backup and current configuration. Change its `name: dsh-bots` to `name: roundtable-bots` and keep the original `id`, `config`, and other fields. If the entry has no `name`, leave it as is.
4. Reopen Harness. The new package uses the existing workspace memory and the conversation history in the same profile.

### Build a local package

Run these commands from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
package_file="$(npm pack --silent)"
```

In the same terminal, add the generated package to the appropriate profile. If you downloaded the release package, run `package_file=roundtable-bots-x.x.x.tgz` in the folder containing it and then run the relevant install command.

```sh
# Desktop (default macOS application path)
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD/$package_file"

# Web
dsh plugin --profile web add "$PWD/$package_file"
```

## Talk to King Arthur directly

After choosing a workspace, click **与 King Arthur 对话** (Talk to King Arthur) to open or resume its single dedicated conversation. It uses the native Harness Agent, conversation history, streaming, tools and approval flow. You can discuss any topic and ask for normal Agent tasks. Bot creation and group creation/messaging are additional tools. Private chat shows the native conversation without an extra receipts/history panel. Earlier private-chat records and group receipts remain available to King Arthur as bounded background context.

For example: “Create two child Bots, one for architecture and one for quality assurance. Choose their names and describe their capabilities.” The host validates the proposed definitions and saves them with fresh IDs. Select the new members when creating a group; they do not automatically join existing groups.

**The dedicated workspace is reserved for King Arthur.** New ordinary conversations and group chats are rejected there. Existing group history remains readable, but those groups cannot continue running. Create group chats in other workspaces.

The first setup imports legacy saved memories once. Switching the King workspace selects an independent memory store in the new folder; the old folder's data is preserved and is not merged automatically. Groups in every workspace use the currently selected King workspace's memory store.

### Clear the private conversation

Click **清空页面 → 确认清空页面** (Clear page → Confirm) above the King Arthur composer. The current conversation is archived and a blank one opens in the same workspace with the same Agent preset and selected model. Earlier messages, tool results, and group receipts are not copied into its context. Long-term memory, Bot definitions, and groups are retained. The old conversation remains available in the host archive for reference and cannot run as the active King Arthur conversation.

To also erase long-term memory, select **主 Bot 记忆** (King memory) under **Roundtable → 重置 Bots 数据**. After resetting, the fresh King Arthur conversation opens automatically. This prevents old messages from making the Agent appear to remember deleted memory. Stop active tasks before either action.

## Bot definitions and model settings

The Bot directory shows avatars and names; click either to open settings. King Arthur occupies its own row, and each row of child Bots is centered. Avatars have transparent backgrounds. King Arthur uses a dark whale in light mode and a white whale in dark mode, with a gold crown in both. The current account avatar appears in direct chats and group chats. The disabled-Bot filter and reset action sit below the directory. Each child Bot has a name and responsibilities.

| Setting | Behavior |
| --- | --- |
| **Name and responsibilities** | Names must be unique and contain at most 24 characters, using Chinese characters, Latin letters, digits, underscores, or hyphens. Responsibilities can contain up to 6,000 characters |
| **Maximum child Bots per group** | Choose 1–12; the initial default is 4. King Arthur joins automatically and does not count toward the limit |
| **Model** | Follows the current conversation by default. You can assign a host-configured model to King Arthur or any child Bot |
| **Reasoning effort** | After choosing a model, select one of its native effort levels or use the model default. Following the current conversation also inherits its reasoning effort |
| **Disable and restore** | Disabled Bots are excluded from new group selections. Enable “Show disabled Bots” to restore them |
| **Delete** | After confirmation, removes the definition and permanently retires its ID. Recreating the same name generates a new ID |

Model and reasoning options come from the host's standard API configuration. After changing that configuration, click **刷新配置** (Refresh configuration) to reload the choices. If a model exposes no effort choices, the effort selector is disabled with an explanation. Switching models clears the previously selected effort to avoid an incompatible value.

**Names, responsibilities, and member limits apply to new groups. Model and effort settings are read on the next Bot execution and also apply to existing groups.** Existing groups retain a snapshot of their members' responsibilities; editing or disabling a definition does not rewrite historical members or replies. The library holds up to 20 child Bots, including disabled ones.

### Deleting and recreating Bots

Click **删除** (Delete) on a child Bot card, review the notice, then choose **确认删除** (Confirm deletion). King Arthur cannot be deleted.

- Deletion revokes the Bot's dispatch eligibility across all groups and cancels group turns currently running. Existing groups retain historical replies. The `@` menu drops the deleted Bot.
- On its next execution, King Arthur starts a fresh coordination session without injecting group context from before deletion. Retired IDs in personal memory are replaced with “∅” (deleted ID); unrelated preferences remain intact.
- Recreating the same name generates a new identity. Create a new group and select the new Bot; it does not inherit the deleted Bot's session or identity.
- Internal retirement records keep old IDs unavailable for reuse. These records are not supplied as the coordinator's memory. Historical logs remain, so “forgetting” means removing IDs from model context and dispatch, not erasing every historical record from disk.

Upgrading does not clear existing Bot definitions or personal memories. If old members reappear after reinstalling into a previously used profile, delete them from the library. A fresh profile starts with no child Bots and no preloaded long-term memories.

## How King Arthur moderates group chats

Send a message in the group. King Arthur selects one speaker at a time, reads the actual response, and decides whom to invite next or when to close. Use `@Architect @Reviewer` to limit participants. With one named Bot, that Bot responds directly.

To redirect an active discussion, enter a new instruction and use Harness's Steer message action. With the default queue preference, press `Command+Enter` on macOS or `Ctrl+Enter` on Windows and Linux. Plain Enter queues the message. Steering stops the active reply and lets King Arthur continue using the new instruction and completed contributions. You can also ask King Arthur to pause in your own words. It will ask what to do next, or proceed with a concrete replacement task you supplied.

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

King Arthur private chat runs in its native root Agent with its normal approval policy. Delegated group participants inherit their conversation's Harness Agent preset, working directory, and sandbox policy. The preset and host configuration determine which tools are available, including file tools from `@deepseek-ai/dsh-tool-fs` and available `web_search` and `web_fetch` tools. Web search uses the provider and credentials configured in Harness. Delegated sessions use Harness's noninteractive approval policy. Operations that require interactive approval are denied.

Bots can load `SKILL.md` with `skill` and open referenced files with `read`. `@deepseek-ai/dsh-agent-instructions` loads workspace instructions such as `AGENTS.md` according to the host configuration, with a default limit of 65,536 bytes.

## Ask King Arthur to set up a group and follow through

In the dedicated conversation, ask King Arthur to discuss an earlier topic with a group and return a result. King Arthur creates the group through a tool when the request is sufficiently specified, and asks for missing information when needed. You can name members yourself or ask for a group without a task.

Existing groups remain accessible on later turns and after a restart. Ask King Arthur to check progress, forward a literal notice, update requirements, continue the discussion, or start a new task. The host retains confirmed group and workspace identities and asks when a target is ambiguous. Updates stop the old run while preserving context; a new task gets its own goal. Host receipts confirm delivery, and results return to the originating private conversation.

For a pending proposal, provide the missing workspace or revise the members in chat. Ask King Arthur to confirm or cancel it in the conversation.

Open the group from its Harness workspace or session search. If it has a task, King Arthur moderates the discussion and associates its results with the originating private conversation; ask for progress or conclusions there. A group created without a task waits for a message.

## How memory works

Each Bot uses three memory layers in a new conversation:

| Layer | Storage | Behavior |
| --- | --- | --- |
| Its own private-chat long-term memory | `.dsh-bots/king-memory.sqlite` for King Arthur; a separate `bot-<id>-memory.sqlite` for each child in the King workspace | Preferences and lasting background survive window replacement; each Bot retrieves its own entries |
| Shared memory from all groups | `.dsh-bots/group-memory.sqlite` in each group's workspace | Every Bot can retrieve group messages across registered workspaces, with workspace, group and message provenance |
| Current window context | Native Harness session journal | Standard Agent management of current messages, attachments and tool results |

Personal memory updates require evidence from the current user message. Private conversations are not automatically copied into shared group memory. A Bot can also recall its own personal memory while participating in a group. Current user instructions take precedence over historical information.

Public group messages are saved automatically, and existing group journals are indexed after upgrading. Full originals remain on disk; models retrieve bounded excerpts. Use `messageId` with `nextOffset` for the rest of a long message, and `nextPage` for more records. Directed private messages and model reasoning are excluded from the shared index. Incomplete replies retain their status. Group task progress and execution contexts remain independent, allowing concurrent work in multiple groups.

Manage entries in **Roundtable → King Arthur → 管理工作区记忆** or **Roundtable → a child Bot → 管理独聊记忆**. Both support search, editing, pinning, archiving, restoring and export. Personal-memory and automatic-update switches apply to all Bots' private memories; shared group history remains available. Ask any Bot to remember a lasting preference or forget an existing entry in its private conversation.

Personal memory has no fixed entry-count limit. Each entry supports **600 characters**, with up to three automatic updates per turn. SQLite/FTS5 uses keywords and Chinese bigrams rather than vector search. Only selected excerpts enter model context. See [memory design and references](MEMORY-DESIGN.md).

**Clear page** archives the current window and creates a blank context, retaining personal and shared group memories. Each Bot has one current private conversation; older windows are history only. **Reset King memory** clears King Arthur's personal entries and replaces its window, retaining child memories and shared group history. Removing a memory does not delete original chat messages.

## v0.4.3: memory use in long group chats

The main Bot is now **King Arthur**. Existing private conversations, internal IDs and memory stores are retained; old main-chat titles update when opened. Mentions support `@King Arthur`, including the space, and legacy main-Bot names remain compatible.

Cold group journals are streamed from current JSONL / Zstd storage instead of loading every event at once. A persisted revision cache skips unchanged journals, and concurrent index refreshes share one scan. Shared originals stay in workspace SQLite; chunked indexing and SQL substring reads limit temporary allocations. Context checkpoints and retrieval candidates also have limits.

The group timeline displays the latest 80 messages. Use **更早记录** for an older page and **返回最新** to resume live messages. Downloads remain available on older pages. Topic summaries fetch bounded previews from the full history, so completed counts remain correct even when evidence is outside the current page. Reasoning is stored as increments with a 32768-character group preview per reply; the host retains the complete model process in the member's native session.

Unreadable or incomplete historical logs are skipped individually, so a missing inherited boundary cannot abort a new main-Agent conversation after a full reset. Original files remain intact; changed revisions retry immediately, while unchanged failures wait at least 30 seconds between scans. Archived sessions are excluded, nested forks use their final inherited boundary, and old reset epochs remain isolated.

Upgrade the same package and restart Harness. Existing memory databases and original journals are retained; the first lookup builds missing indexes. These changes do not cap all host memory use or rewrite existing native session logs. If the host still runs out of memory while loading native conversations, a new diagnostic log is needed to locate that remaining cause.

## Current scope

- **Group timeline.** Group chats support document attachments and Markdown replies. Bot replies appear when complete.
- **Group context.** Each discussion uses its own Bot execution sessions. Follow-ups draw on relevant messages in the current group's history.
- **Native controls.** The plugin uses the native message box, stop control, and model configuration, and preserves native views such as Team. Enhancement Switches is not required.
- **History compatibility.** Two-Bot group histories from early development prototypes are supported. Sending another message in an old group adds King Arthur automatically. The legacy `@主Bot` mention remains supported.

## Disable or uninstall

Disable or uninstall the plugin in the desktop **Plugins** panel. For Web CLI:

```sh
dsh plugin --profile web remove roundtable-bots
```

Disabling or uninstalling removes the Bots entry, group chat overlay, styles, and listeners, restoring the native conversation layout. The plugin does not overwrite global API, model, or Agent Loop configuration. The dedicated Bots workspace is also removed from the sidebar; its visible sessions are temporarily archived to prevent them from appearing as ungrouped sessions. Re-enabling or reinstalling restores the workspace and its previously visible sessions. Previously archived sessions stay archived. Workspace files, King memory, and conversation history are preserved.

**Bot definitions, long-term memory, and group history are retained and can be restored after reinstallation.** This does not erase historical data or undo host settings you changed yourself while using the plugin.

## Reset Bots data

Open **Roundtable → King Arthur → 重置 Bots 数据** (Reset Bots data), select the items to reset, type `RESET`, and confirm. Nothing is selected by default. Stop active Bot tasks before resetting.

| Option | Result |
| --- | --- |
| **Bots members** | Deletes all child Bots, including disabled ones, while retaining King, its model, and the group size limit. Old IDs remain retired; recreated names receive new IDs |
| **King memory** | Clears active, archived, and pinned entries, their index and prior audit contents in the selected workspace, plus legacy migration entries. Archives the old private chat and creates a fresh context. Memory switches remain unchanged. Select a workspace first |
| **Old conversation associations** | Unbinds the dedicated workspace and King conversation, archives its sessions, and makes old groups read-only. Choosing a workspace again creates a fresh dedicated King conversation |

Only selected items are reset. Resetting associations alone preserves memory; selecting the original folder reconnects that memory store. Bot execution contexts are renewed without injecting pre-reset history. Interrupted resets retain their pending intent and resume after restart; Bot execution stays paused until completion, and the reset panel also offers a retry.

**Reset cannot be undone through the plugin, but it does not delete original chat logs, exported files, or memory files in other workspace folders.** Selecting all options starts over; removing historical files from disk remains a separate host operation. If the workspace directory was manually deleted, startup clears the invalid association and retains Bot definitions so you can select an existing directory again. The plugin does not silently create a folder.

## Development and verification

`npm run typecheck` checks types. `npm test` covers configuration validation, member selection, mention routing, task plans, memory, model and effort persistence, and activation cleanup. `npm run build` generates release files.

Automated coverage includes persistence and retrieval beyond 32 memories, reopening the database, revision conflicts, member creation and retired IDs, dedicated workspace restrictions, and workspace recovery after disabling.

`npm run smoke` (also available as `npm run smoke:native`) uses Chrome, the Playwright CLI, and an isolated Web profile. It checks native conversation continuity, file reads, search, Bot and group creation, message delivery, memory after restart, continuation among several old topics, pending operations, intent-classifier failure, clear page, context isolation after memory reset, and group greetings. It also checks downloaded bytes and filenames, uploaded files after restart, manual New Session blocking in the King workspace, automatic unique child windows, personal memory isolation, cross-group retrieval and reasoning persistence. The deterministic model fixture verifies execution paths, not real-model response quality.

The current implementation passed type checking, 104 automated tests, and this integration suite. Reset behavior was also checked through the UI in an isolated profile with synthetic data.

`npm run test:memory` streams a synthetic legacy journal of about 325 MiB decompressed under a 96 MiB V8 heap limit. This checks plugin replay allocations, not total host memory. The browser smoke test also covers 80-message paging, downloads from older pages and cold-journal recall after restart.
