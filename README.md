# Neo4j Browser for DeepSeek Harness

Open **Neo4j Browser** in the left sidebar. This is an independent Neo4j-style browser, not the official Neo4j Browser application.

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

The bundle contains plain JavaScript and requires no build step. Enable it, restart the Harness Host if installation reports `restart-required`, then refresh the Web page. Neo4j credentials are entered in the plugin UI, not in repository files.

## Connect and explore

Enter a Bolt/Neo4j URI, username, password and optional database. Neo4j 5+ is required (`elementId`). Use `neo4j+s://` for verified TLS (including Aura). `+ssc` explicitly permits self-signed certificates. A least-privilege, read-only database account is recommended.

Connections are shared across sessions in this Harness profile. Credentials are held only by the Host driver and are not persisted, returned to tools or sent to the generation model. Reconnect after a Host restart. The browser never connects directly to the database.

Run a single Cypher statement with JSON parameters. Switch among Graph, Table and JSON. The compact `neo4j$` editor keeps **Query options** (parameters, write authorization and row cap) collapsed above the result frame. The Database Information sidebar lists labels, relationship types and property keys; click a chip to run a 25-row browsing query.

The graph uses 88-pixel node bodies at actual size, a collision-aware force layout and a world that grows with the result count instead of squeezing nodes into a fixed circle. Nodes may be outside the viewport. Drag the background or scroll to pan; Ctrl/Command + scroll or the +/− buttons zoom. **Fit graph** explicitly fits all loaded nodes; **Actual size** restores a readable 1:1 view. **Expand graph** opens the complete graph-and-inspector frame across the window, keeping Properties visible on the right; Escape restores it. Relationships have a wide hover aura (including at low zoom); clicking the aura selects the relationship and opens its Properties, even when details were previously hidden. The property/overview panel occupies its own opaque column, separated from the canvas by a border. Property names and values are grouped into alternating bordered rows. It can be hidden using **Hide details**; on narrow displays it moves below the graph instead of overlaying nodes. The sidebar and editor share a common top alignment.

Each node has one caption inside its body. Captions prefer meaningful product/name properties over opaque IDs and use measured-width ellipsis; hover or select to read the full property value. Select nodes/relationships to inspect properties. **Double-click a node** to load its relationships and neighbors (Shift+Enter when the node has keyboard focus). Clicking empty canvas clears selection; there are no separate Clear selection or Expand neighbors buttons.

Repulsion and spatial collision constraints remain active for as long as the graph is mounted. The minimum center spacing is 200 world pixels (node diameter 88), and the link target distance is 330. During dragging only the dragged node is temporarily fixed; nearby nodes move away, and the node is released afterwards. Dragging reheats the link force, increases the simulation rate and raises the movement cap so linked nodes follow promptly instead of lagging behind a cooled simulation. Expansion warm-starts existing positions without freezing them and preserves camera state. Animation frames and observers are disposed when the graph unmounts. Keyboard focus on the canvas supports arrow-key panning, +/− zoom and 0 for actual size. Version 1.5.1 restores the graph simulation from 1.4.0: gentle origin attraction, the prior cooling floor, collision passes and single-step animation pace. The aggressive centroid compaction introduced in 1.5.0 is removed. Editor/history persistence and the schema cache remain unchanged.

The last Cypher draft, JSON parameters, prompt, label scope, view tab, row limit and up to 100 recent attempted queries (bounded to approximately 1 MB) are stored in this browser's local storage, scoped by Host profile and API mount path. They survive closing the panel, refreshing the page and closing the browser. Pending edits are flushed on panel unmount and pagehide. Connection passwords, connection objects, query results, selected nodes, model configuration and write confirmations are never stored. Query text/parameters can themselves contain sensitive values: do not share browser profiles containing private queries. Storage restrictions or quota errors produce a warning; they do not prevent query execution. Old history that was lost before this version cannot be recovered.

Read-only is the default: the Host checks `EXPLAIN` query classification, uses a read session, and rolls back the read transaction. Database access permissions remain the authoritative security boundary. Writes require **Allow writes for this run**, then review and confirmation of the exact query and parameters. Tools cannot authorize writes or provide credentials. A cancelled/disconnected write may have committed; check database state before retrying.

Query and neighbor-expansion results default to **25 rows**, with an explicit cap up to 200 rows via **Query options → Row limit** (or tool `limit`). Sidebar browsing templates always use `LIMIT 25`, and the shipped generation prompt requests 25 by default. The row cap does not rewrite user Cypher or restrict the server's intermediate work. Responses are bounded to approximately 256 KiB, with bounded normalization, graph size and a 10-second per-operation deadline. The browser indicates truncation; add a Cypher `LIMIT` to control server work as well. This is not a database administration console.

## Generate Cypher

Click the sparkle icon next to the Cypher editor for a compact, anchored **Prompt** popover containing only the request input, action buttons and request status. Escape or clicking outside dismisses it. Successful generation places the draft in the editor and closes the menu without executing it. Provider/model, schema label scope and the editable system prompt are in the collapsed **Generation settings** section under the editor, not in the prompt menu. There is no separate generation block below the graph. The Host fetches metadata using Neo4j built-in schema procedures; APOC is not required. Labels, relationship types, property names/types and approximate topology are supplied with the question. No sampled record values, connection credentials, chat history or agent tools are included. Missing permissions and truncation are explicitly reported. Schema is bounded to 24 KiB and 100 rows per metadata collection. Metadata procedures can be expensive on large databases and are time-limited. Metadata is cached in the Host for the lifetime of the connection, per normalized label scope (up to 16 scopes). Reopening the panel receives the already-cached default schema with status and does not rescan Neo4j. Generation also reuses the cache. **Refresh schema** explicitly reloads metadata; reconnect, disconnect and authorized write attempts invalidate the cache. Status reads remain responsive during queued generation. External schema changes require manual refresh; the cache is intentionally not an automatic TTL polling loop.

Generation uses the Harness default LLM unless both provider and model are overridden under **Generation settings**. The English system prompt is editable. Click **Save settings** to apply changes to the shared Host instance. **These settings are currently memory-only and reset when the plugin/Host reloads.** All interface text and shipped prompts are English.

Generated Cypher is a draft, never automatically executed. Review identifiers, semantics and any required parameters before running it. Generation has a 60-second model deadline and rejects incomplete responses. It prepares the call using the current model contract, does not force temperature, and selects low reasoning only when advertised by the model. The answer budget is 8192 tokens to accommodate hidden reasoning. Final text blocks and streaming deltas are supported without duplicating the answer. Authentication, quota, invalid-request, empty-response and output-truncation errors have distinct safe messages; raw provider errors and reasoning are never exposed. The entire metadata collection can take additional time. An unavailable schema cannot guarantee a correct query.

## Agent operation

`neo4j_browser` exposes status, schema, query, expand, generate, config and disconnect through the same backend as the UI. It can use only a UI-established connection and cannot enable writes. Disconnect affects all sessions. Query results requested by an agent enter that agent's conversation; the schema-only guarantee specifically concerns the dedicated **Generate Cypher** operation.

## Activation and version checks

Replacing an installed bundle can require restarting the **Harness Host process**, not just refreshing the page or reopening the Neo4j panel. The page displays `UI <version> / Host <version>`. For this release both must show `1.5.1`. An unknown or mismatched Host version displays an explicit restart warning; UI generation checks the running version before making a model call. `neo4j_browser(action: status)` also returns the backend version and connection/cache identity.

A live check before this release found the saved package at 1.4.0 while the running tool still emitted the pre-1.4 error `The model did not finish a complete query.` That old error is absent from the installed 1.4 source, confirming an older in-memory module remained active. A browser refresh cannot replace that Host module.

## Development and verification

```sh
npm install --ignore-scripts
npm test
node --check client.js
```

Install this directory using the Harness Plugin Manager. Client registrations use `sidebar.panellist` and the matching `main` slot, without replacing existing entries. All panel colors use Harness theme tokens. Backend routes use authenticated Connection admission and reject malformed/oversized requests. Driver error details are withheld to avoid leaking credentials or property data.

Automated tests cover caller authority, exact write confirmation, URI validation, graph normalization, integer precision, response caps, schema scoping, isolated LLM context, timeout/cancellation and shared UI/tool operation behavior. Pure graph tests additionally cover non-overlap for 25/100/400 nodes, connected stars, warm-started expansion, post-cooling repulsion, dragging onto another node, coincident nodes, Unicode ellipsis, actual-size versus fit cameras, zoom anchoring and arrow geometry. Tests also cover provider failure classification, final text blocks, models without reasoning controls, linked-node drag response, and source-level contracts for the prompt popover, edge aura and fullscreen inspector. Additional tests cover state restoration in a fresh state-core instance, failed/corrupted browser storage, persistence allowlists, profile isolation and history bounds, per-connection schema cache hits, normalized scopes, explicit refresh, cache invalidation after writes/reconnect, non-blocking cached status, and regression coverage for the restored gentle attraction and simulation pace. These tests do not emulate a DOM or render a mock UI. A live smoke test of the revised generator using the current OpenAI Codex / gpt-6.1-sol route returned complete Cypher on a synthetic Product schema; no query was executed and no database contents were used. The temporary smoke-test plugin was uninstalled after verification. Visual light/dark and real-schema end-to-end verification still require browser control; unit tests and the synthetic smoke call do not establish those integration results.

Design references reviewed (not copied or bundled): [Neo4j Browser force layout](https://github.com/neo4j/neo4j-browser/blob/master/src/neo4j-arc/graph-visualization/GraphVisualizer/Graph/visualization/ForceSimulation.ts), [caption fitting](https://github.com/neo4j/neo4j-browser/blob/master/src/neo4j-arc/graph-visualization/GraphVisualizer/Graph/visualization/GraphGeometryModel.ts), and [graph controls](https://github.com/neo4j/neo4j-browser/blob/master/src/neo4j-arc/graph-visualization/GraphVisualizer/Graph/styled.tsx). This plugin uses an independently authored implementation and Harness theme tokens, not Neo4j's GPL source.
