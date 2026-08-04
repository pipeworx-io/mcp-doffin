# mcp-doffin

Doffin MCP — Norwegian government public procurement notices (BYOK / platform key).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Doffin data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
