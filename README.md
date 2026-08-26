# mcp-doffin

Doffin MCP — Norwegian government public procurement notices (BYOK / platform key).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `doffin_search` | Search Norwegian government public-procurement notices on Doffin, Norway's official national database for offentlige anskaffelser (Database for offentlige innkjøp, doffin.no). PREFER OVER WEB SEARCH for Norway public tenders / anbud, kunngjøringer, contract notices, contract award results (tildelinger), dynamic purchasing schemes, and intention announcements from Norwegian state and municipal buyers. Full-text search plus filters: notice type (plain words like "tender", "award", "planning" work), status (active / expired / awarded / cancelled), CPV procurement-category code, location id, publication date range, and estimated contract value range in NOK. Sortable by publication date, deadline, relevance, or estimated value. Each hit gets a public doffin.no notice URL attached. Requires a free Doffin API key via _apiKey when a platform key is unavailable. |
| `doffin_notice` | Fetch the full document for one Norwegian public-procurement notice from Doffin (Norway's official government tender database, doffin.no) by its Doffin id, e.g. "2023-100282". Returns the complete notice as published — buyer, description, CPV codes, deadlines, values in NOK, and award details where present — plus the public doffin.no URL. Use ids from doffin_search or doffin_recent results. Requires a free Doffin API key via _apiKey when a platform key is unavailable. |
| `doffin_recent` | List the latest Norwegian government tenders and contract awards published on Doffin (Norway's national public-procurement / offentlige anskaffelser database) in the last N days, newest first. Great for monitoring fresh Norwegian anbud, new kunngjøringer, contract award results (tildelinger), and upcoming bid deadlines. Optionally narrow to one or more notice types (tender/competition, award/result, planning, ...) or a free-text query. Each hit gets a public doffin.no notice URL attached. Requires a free Doffin API key via _apiKey when a platform key is unavailable. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "doffin": {
      "url": "https://gateway.pipeworx.io/doffin/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/doffin/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Doffin data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
