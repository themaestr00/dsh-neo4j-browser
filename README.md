# Neo4j Browser for DeepSeek Harness

Open **Neo4j Browser** as a full page from the left sidebar, or choose **Neo4j Browser** on the right sidebar's **Start** page to keep it beside the conversation. This is an independent Neo4j-style browser, not the official Neo4j Browser application.

## Install

In the Harness **Plugins** page, install this Git bundle:

```text
git+ssh://git@github.com/themaestr00/dsh-neo4j-browser.git
```

Alternatively, clone the repository and install its absolute directory through the Harness Plugin Manager:

```sh
git clone git@github.com:themaestr00/dsh-neo4j-browser.git
cd dsh-neo4j-browser
npm ci --ignore-scripts
npm test
```

The installable bundle includes a prebuilt, self-contained browser artifact; installation does not require a compiler, CDN or build script. Development changes require `npm run build` (also run by `npm test`) before packing or installing. Enable the bundle, restart the Harness Host if installation reports `restart-required`, then refresh the Web page. Neo4j credentials are entered in the plugin UI, not in repository files.

## Open beside the conversation

1. Open the right sidebar from the conversation header.
2. On **Start**, choose the **Neo4j Browser** card.
3. Connect to Neo4j or reuse the connection already established in the full-page browser.

The page uses the standard sidebar tab registry, so the Host owns its normal/fullscreen presentation, docking, splitting and floating behavior. The existing Files, Terminal, Tasks and Memory entries are not replaced. Closing a Neo4j tab closes only its view, not the shared database connection.

In narrow panes the database metadata starts collapsed behind **Show database info**, and Properties appears below the graph instead of squeezing the canvas. Graph simulation pauses while its tab is hidden and resumes without resetting the camera. A visited sidebar tab stays mounted while switching tabs/sessions. Reopening a retained view refreshes connection status and reuses cached schema metadata.

Each sidebar tab has its own persisted draft/history, scoped by session and tab identity. A new tab can seed its draft from the full-page editor; subsequent edits do not overwrite that editor or another sidebar tab. Connection credentials, model settings and the schema cache remain shared at Host-profile scope.

## Connect and explore

Enter a Bolt/Neo4j URI, username, password and optional database. Neo4j 5+ is required (`elementId`). Use `neo4j+s://` for verified TLS (including Aura). `+ssc` explicitly permits self-signed certificates. A least-privilege, read-only database account is recommended.

Connections are shared across sessions in this Harness profile. Credentials are held only by the Host driver and are not persisted, returned to tools or sent to the generation model. Reconnect after a Host restart. The browser never connects directly to the database.

Run a single Cypher statement with JSON parameters. Switch among Graph, Table and JSON; the selected result mode survives new queries, history reruns and browsing actions. The editor keeps **Query options** (parameters, write authorization and row cap) collapsed above the result frame. A compact **● Connected** indicator, database selector and connection menu sit beside the editor. Open **Database Information** from the connection menu for labels, relationship types and property keys; click a chip to run a 25-row browsing query.

The database selector lists accessible online databases using a bounded, cached metadata request. If listing is unavailable, **Other database…** accepts an explicit name. Switching verifies read access using the existing driver before changing the profile-shared context: no password re-entry or credential persistence is needed. Failed switching preserves the old database. Selecting **Default** uses the account's default database. Selection invalidates the schema cache. Since this context is shared, UI queries and expansions bind to their originating connection ID; a change by another session rejects a stale request rather than silently running it in a different database. Write confirmation retains its original connection ID and is invalidated when context changes. Older status responses cannot replace a newer connection revision. Reopen the panel to synchronize another session's connection changes.

The graph uses 88-world-pixel node bodies, a collision-aware force layout and an unbounded world. A new query chooses its initial camera scale from the node count, graph bounds and available viewport: larger result sets start farther out. New results and expansions use an immediately fixed, non-overlapping arrangement, without a visible settling animation. Expansion preserves every existing node coordinate and places new neighbors into free space. When the visible node count grows, the camera zooms out by an area-density factor (for example 25→50 nodes gives √(25/50) scale), anchored at the viewport center. Added relationships without new nodes do not change zoom. A reference scale prevents repeated collapse/reopen cycles from progressively shrinking the graph; manual zoom/Fit establishes a new reference. Collapsing does not force a zoom-in. Some nodes can still lie outside the current viewport after manual dragging or panning. Drag the background or scroll to pan; Ctrl/Command + scroll or the +/− buttons zoom. **Fit to screen** fits current bounds; **Reset zoom** restores 1:1 around the viewport center; **Center graph** recenters without changing scale. All graph controls have tooltips and accessible names. **Expand graph** opens the workspace across the window. Its result header offers **Show query panel / Hide query panel** and **Exit fullscreen**. The query panel opens above the graph with the same editor, connection/database controls, Run/Stop, AI generation, Query options and Generation settings; it scrolls within a bounded height rather than covering the graph. There is only one mounted editor, preserving draft, parameters and undo history through fullscreen/panel toggles. History Edit also reveals the panel. Graph/Table/JSON and Properties/History remain accessible in fullscreen, with an exit button in every result mode. Escape exits fullscreen except while an editor/input, completion, open menu or AI popover owns the key.

Relationships have a wide hover aura, including at low zoom. Selecting a node adds a stronger body stroke/fill, dashed selection shape and an **Inspecting** caption synchronized with Properties. Counts and the selection caption share a stacked, width-constrained HUD, so long names truncate rather than overlap. The inspector leads with a readable label/name (for example, `Product · openssl`); Element ID and UUID/ID fields are secondary. Property rows are compact and aligned. The inspector occupies its own opaque column, or a separate area below the graph in a narrow pane, never an overlay.

Each node has one caption inside its body. Captions prefer meaningful product/name properties over opaque IDs and use measured-width ellipsis; hover or select to read the full property value. Select nodes/relationships to inspect properties. **Double-click a node** to toggle its relationships and neighbors (Shift+Enter when the node has keyboard focus). A second double-click hides that expansion locally, without a database request or database mutation. Original query nodes/relationships and neighbors still needed by another expanded root are retained; unreachable nested expansions are removed, including cycles. Reopening a collapsed expansion fetches fresh neighbors. Expansion is bounded to 100 groups, 500 visible nodes and 1000 visible relationships. Table rows and the original query result stay unchanged. Clicking empty canvas clears selection; there are no separate Clear selection or Expand neighbors buttons.

Physics runs only during an actual node drag, after the pointer has moved beyond the click threshold. A click, double-click, new query, expansion, background pan or zoom never starts idle simulation. During dragging only the dragged node is temporarily fixed; repulsion, collision constraints and link attraction let its neighbors follow. Releasing/cancelling the pointer, losing capture/focus, hiding the tab or replacing the graph cancels the animation immediately, with no inertial tail. Idle graphs schedule no physics frames. Static placement maintains 200-world-pixel center spacing (node diameter 88); the drag solver retains its gentle origin attraction and 330-world-pixel link target. Keyboard focus on the canvas supports arrow-key panning, +/− zoom and 0 for actual size. Editor/history persistence and the schema cache remain unchanged.

The last Cypher draft, JSON parameters, prompt, label scope, result tab, row limit, splitter sizes, inspector tab, section visibility and up to 100 recent attempted queries with timestamps/durations/status/row counts (bounded to approximately 1 MB) are stored in this browser's local storage, scoped by Host profile and API mount path. They survive closing the panel, refreshing the page and closing the browser. Pending edits are flushed on panel unmount and pagehide. Connection passwords, connection objects, query results, selected nodes, model configuration and write confirmations are never stored. Query text/parameters can themselves contain sensitive values: do not share browser profiles containing private queries. Storage restrictions or quota errors produce a warning; they do not prevent query execution. Old history that was lost before this version cannot be recovered.

Read-only is the default: the Host checks `EXPLAIN` query classification, uses a read session, and rolls back the read transaction. Database access permissions remain the authoritative security boundary. Writes require **Allow writes for this run**, then review and confirmation of the exact query and parameters. Tools cannot authorize writes or provide credentials. A cancelled/disconnected write may have committed; check database state before retrying.

Query and neighbor-expansion results default to **25 rows**, with an explicit cap up to 200 rows via **Query options → Row limit** (or tool `limit`). Sidebar browsing templates always use `LIMIT 25`, and the shipped generation prompt requests 25 by default. The row cap does not rewrite user Cypher or restrict the server's intermediate work. Responses are bounded to approximately 256 KiB, with bounded normalization, graph size and a 10-second per-operation deadline. The browser indicates truncation; add a Cypher `LIMIT` to control server work as well. This is not a database administration console.

## Execution, History and layout

The **▶** run icon sits directly beside the AI-generation button, with an accessible **Run query** name and tooltip. It becomes a **■** Stop icon while running. Execution status appears beside the run icon, not as a page heading: **Running…**, **✓ Completed · 42 ms · 6 rows**, **Failed · 120 ms** or **Cancelled · 120 ms**. Durations measure elapsed client round-trip time, including queue/network time. While a query runs, Run becomes an enabled **Stop** button. Stop aborts its request and asks the Host to roll back/close the transaction; late responses cannot overwrite a newer result. The existing operation deadline still applies. Cancellation is not proof that an authorized write did not commit.

The shared inspector has **Properties | History** tabs. Selecting a graph entity opens Properties; choosing History opens History. Closing the inspector is independent of the selected result mode. History uses one ellipsized line per query, with execution time/date on the right and full text on hover or expansion. Hover/focus exposes **Run again**, **Edit** and **Copy**. Clicking the query itself, or Edit, only loads query/parameters into the editor. Run again uses the currently selected database and always starts read-only; a historical write needs Edit plus fresh explicit write confirmation. Query text/parameters may be sensitive. Old entries without timings retain their date only; an interrupted saved run restores as Cancelled.

Drag the separators below the editor, result canvas and inspector to change heights. The wide inspector also has a draggable width separator. Separators are keyboard-focusable: arrows resize, Shift+arrow makes a larger change, Home/End select the bounds and Escape cancels an active drag. Sizes, Properties/History choice, inspector/metadata/connection visibility, query/generation sections and Graph/Table/JSON mode persist per view. Fullscreen temporarily follows the viewport instead of replacing saved dimensions. Interactive items have hover, active and visible keyboard-focus states.

Cypher syntax/semantic errors use a compact block next to the editor. When Neo4j supplies a position, the original query's line/character is marked; the Host removes its internal EXPLAIN prefix from coordinates. Markers clear when the text changes. Only bounded, whitelisted UI query diagnostics are exposed; parameter values are redacted, and arbitrary connection/authentication/provider errors remain generic. Agent-tool errors do not receive raw Cypher diagnostics.

## Cypher editor and suggestions

Both full-page and sidebar views use a bundled [CodeMirror 6](https://codemirror.net/) editor with multiline editing, line numbers, undo/redo, bracket matching and theme-token-based syntax highlighting for keywords, strings, numbers, parameters, comments, labels and properties.

Suggestions open while typing, or with **Ctrl+Space**. Highest-priority **↑/↓** bindings move the selected option, **Tab/Enter** insert it and **Escape** dismisses the list. The selected item has an accent background/border and the native CodeMirror list automatically scrolls it into view. Tab moves focus normally when no completion is selected. **Ctrl+Enter** (Command+Enter on macOS) runs through the existing Run query action; write confirmation is still required. Selecting a suggestion never executes a query.

- Cypher keywords, common functions and declared variables are available without a database connection.
- After `(n:` the editor suggests node labels; after `-[r:` it suggests relationship types.
- After `n.` or `r.` it suggests properties from cached metadata. Common pattern declarations, multiple labels/types and simple `WITH n AS alias` aliases narrow the list; property types appear beside the names. Node/relationship property maps and map projections also offer property keys.
- Labels/properties with spaces, reserved words or embedded backticks are inserted with the necessary escaping. Completion also works while typing inside an unfinished backtick-quoted identifier.
- After `$`, parameter names come from the JSON parameter editor; their values are not displayed.

The compact **…** editor menu offers **Format query**, **Copy** and **Clear**. Format conservatively inserts top-level clause whitespace without rewriting identifiers, strings, comments or nested expressions; it is not a full Cypher parser/rewriter. Format and Clear are undoable and never run a query. Clipboard failure is reported instead of claiming success.

The editor uses only the schema already loaded by the panel. Typing never requests database records, schema rescans or an LLM response. **Refresh schema** updates the dictionary; reconnect/disconnect replaces it. Suggestions are bounded by the existing metadata caps and database permissions. Alias/label inference is conservative, not a complete Cypher semantic analyzer: unknown types fall back to available property names. Strings/comments suppress suggestions. Query validation and authorization remain on the Host.

## Generate Cypher

Click the sparkle icon next to the Cypher editor for a compact, anchored **Prompt** popover containing only the request input, action buttons and request status. Escape or clicking outside dismisses it. Successful generation places the draft in the editor and closes the menu without executing it. Provider/model, schema label scope and the editable system prompt are in the collapsed **Generation settings** section under the editor, not in the prompt menu. There is no separate generation block below the graph. The Host fetches metadata using Neo4j built-in schema procedures; APOC is not required. Labels, relationship types, property names/types and approximate topology are supplied with the question. No sampled record values, connection credentials, chat history or agent tools are included. Missing permissions and truncation are explicitly reported. Schema is bounded to 24 KiB and 100 rows per metadata collection. Metadata procedures can be expensive on large databases and are time-limited. Metadata is cached in the Host for the lifetime of the connection, per normalized label scope (up to 16 scopes). Reopening the panel receives the already-cached default schema with status and does not rescan Neo4j. Generation also reuses the cache. **Refresh schema** explicitly reloads metadata; reconnect, disconnect and authorized write attempts invalidate the cache. Status reads remain responsive during queued generation. External schema changes require manual refresh; the cache is intentionally not an automatic TTL polling loop.

Generation uses the Harness default LLM unless both provider and model are overridden under **Generation settings**. The English system prompt is editable. Click **Save settings** to apply changes to the shared Host instance. **These settings are currently memory-only and reset when the plugin/Host reloads.** All interface text and shipped prompts are English.

Generated Cypher is a draft, never automatically executed. Review identifiers, semantics and any required parameters before running it. Generation has a 60-second model deadline and rejects incomplete responses. It prepares the call using the current model contract, does not force temperature, and selects low reasoning only when advertised by the model. The answer budget is 8192 tokens to accommodate hidden reasoning. Final text blocks and streaming deltas are supported without duplicating the answer. Authentication, quota, invalid-request, empty-response and output-truncation errors have distinct safe messages; raw provider errors and reasoning are never exposed. The entire metadata collection can take additional time. An unavailable schema cannot guarantee a correct query.

## Agent operation

`neo4j_browser` exposes status, schema, query, expand, generate, config, databases, use_database and disconnect through the same backend as the UI. It can use only a UI-established connection and cannot enable writes. Database selection and disconnect affect all profile sessions. `databases` is bounded to 100 names with an omission flag; `refresh` bypasses its cache. `use_database` takes a name (empty for the user default), verifies access and reuses existing credentials. Query/expand callers can supply `expectedConnectionId` from status to reject a stale shared context. Query results requested by an agent enter that agent's conversation; the schema-only guarantee specifically concerns the dedicated **Generate Cypher** operation.

## Activation and version checks

Replacing an installed bundle can require restarting the **Harness Host process**, not just refreshing the page or reopening the Neo4j panel. The page displays `UI <version> / Host <version>`. For this release both must show `1.9.1`. An unknown or mismatched Host version displays an explicit restart warning; UI generation checks the running version before making a model call. `neo4j_browser(action: status)` also returns the backend version and connection/cache identity.

A live check before this release found the saved package at 1.4.0 while the running tool still emitted the pre-1.4 error `The model did not finish a complete query.` That old error is absent from the installed 1.4 source, confirming an older in-memory module remained active. A browser refresh cannot replace that Host module.

## Project structure

```text
src/
  index.js             # Host plugin entry and UI/tool adapters
  backend.js           # Neo4j connection, schema cache and query generation
  client.js            # Registration, graph physics/camera and state codec
  workspace-panel.js   # Workspace rendering, history and query lifecycle
  workspace-core.js    # Pure execution/cancellation and display helpers
  graph-expansion.js   # Reversible graph view with shared-neighbor ownership
  graph-motion.js      # Drag-only frame scheduler with cancellation guards
  workspace-styles.js  # Theme-token-based compact workspace styling
  query-errors.js      # Bounded UI-only Cypher diagnostics
  editor-actions.js    # Conservative formatting and editor action helpers
  cypher-editor.js     # CodeMirror lifecycle and theme integration
  cypher-completions.js # Pure lexer, schema dictionary and completion logic
dist/
  client.js            # Prebuilt browser ModuleLoader artifact
  THIRD_PARTY_NOTICES.txt
assets/
  icon.svg             # Plugin artwork
locale/
  en.json              # English plugin metadata
test/                  # Backend, graph, editor, sidebar and persistence tests
build.mjs              # Browser bundling and dependency-license collection
cordis.patch.yml        # Bundle composition
package.json            # Exports and package allowlist
```

The Host export resolves to source; the Client export resolves to the prebuilt [browser artifact](dist/client.js). Keep the generated distribution in Git for direct Git-bundle installation. [The build script](build.mjs) bundles the editor locally, rejects React/Harness Client imports and emits [third-party license notices](dist/THIRD_PARTY_NOTICES.txt). CodeMirror and esbuild are development dependencies only; the installed Host still depends only on the Neo4j driver. Sources, distribution, artwork, locale metadata, the build script, bundle patch and documentation are packaged; tests remain in Git.

## Development and verification

```sh
npm ci --ignore-scripts
npm run check
npm test                # Builds the Client artifact before testing
npm pack --dry-run
```

Install this directory using the Harness Plugin Manager. Client registrations use `sidebar.panellist` and the matching `main` slot, plus a dedicated `sidebarRightTabs` page/Start-card definition and its `sidebar.right.pane.tab` body. No existing entry or guide body is replaced. The Client half depends on the shipped `@deepseek-ai/dsh-client-ui-sidebar-right` provider through activation ordering, without importing any Harness Client package as a runtime module. All panel colors use Harness theme tokens. Backend routes use authenticated Connection admission and reject malformed/oversized requests. Connection/authentication and arbitrary driver error details are withheld; bounded UI-only statement diagnostics follow the redaction and coordinate rules above.

Automated tests cover caller authority, exact write confirmation, URI validation, graph normalization, integer precision, response caps, schema scoping, isolated LLM context, timeout/cancellation and shared UI/tool operation behavior. Pure graph tests additionally cover non-overlap for 25/100/400 nodes, connected stars, warm-started expansion, post-cooling repulsion, dragging onto another node, coincident nodes, Unicode ellipsis, actual-size versus fit cameras, zoom anchoring and arrow geometry. Tests also cover provider failure classification, final text blocks, models without reasoning controls, linked-node drag response, and source-level contracts for the prompt popover, edge aura and fullscreen inspector. Additional tests cover state restoration in a fresh state-core instance, failed/corrupted browser storage, persistence allowlists, profile isolation and history bounds, per-connection schema cache hits, normalized scopes, explicit refresh, cache invalidation after writes/reconnect, non-blocking cached status, and regression coverage for the restored gentle attraction and simulation pace. Sidebar tests cover the tab/card registration contract and teardown, per-tab draft isolation and first-open seeding, framework tab identity/visibility wiring, and preservation of the main navigation entry. Editor tests additionally cover node/relationship completion domains, alias-scoped properties, backtick escaping, cursor-range replacement, map keys/projections, parameter-name privacy, comments/strings, statement boundaries, schema replacement, bounded work, real CodeMirror State transactions and undo, read-only admission, browser-bundle syntax and bundled license notices. Workspace tests cover cancellation winning late results, duplicate-run guards, duration/row counts, history/layout migration and allowlists, readable entity identity, adaptive initial cameras, accessible resize/source contracts, database access verification/cache and stale-connection rejection, UI/tool adapter equivalence, redacted EXPLAIN-adjusted diagnostics and transaction close on abort. Completion tests verify highest-precedence native commands, real state diagnostics/undo and the installed library's own selected-option scrolling contract. These tests do not emulate a DOM or render a mock UI. A live smoke test of the revised generator using the current OpenAI Codex / gpt-6.1-sol route returned complete Cypher on a synthetic Product schema; no query was executed and no database contents were used. The temporary smoke-test plugin was uninstalled after verification. Visual light/dark and real-schema end-to-end verification still require browser control; unit tests and the synthetic smoke call do not establish those integration results.

Design references reviewed (not copied or bundled): [Neo4j Browser force layout](https://github.com/neo4j/neo4j-browser/blob/master/src/neo4j-arc/graph-visualization/GraphVisualizer/Graph/visualization/ForceSimulation.ts), [caption fitting](https://github.com/neo4j/neo4j-browser/blob/master/src/neo4j-arc/graph-visualization/GraphVisualizer/Graph/visualization/GraphGeometryModel.ts), and [graph controls](https://github.com/neo4j/neo4j-browser/blob/master/src/neo4j-arc/graph-visualization/GraphVisualizer/Graph/styled.tsx). This plugin uses an independently authored implementation and Harness theme tokens, not Neo4j's GPL source.
