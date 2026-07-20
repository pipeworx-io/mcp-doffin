interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Doffin MCP — Norwegian government public procurement notices (BYOK / platform key).
 *
 * Wraps the official Doffin public API (Azure API Management, subscription-keyed):
 *   https://betaapi.doffin.no/public
 *   GET /v2/search              — search notices (paged, filtered, sorted)
 *   GET /v2/download/{doffinId} — full notice document by id (e.g. "2023-100282")
 *
 * Doffin (Database for offentlige innkjøp) is Norway's national database for
 * public-procurement notices: contract notices (kunngjøring av konkurranse),
 * award results, prior announcements, dynamic purchasing schemes, and
 * intention/conclusion announcements from Norwegian state and municipal buyers.
 *
 * Auth: Azure APIM subscription key sent as the Ocp-Apim-Subscription-Key
 * header. Free keys via the developer portal:
 *   https://dof-notices-prod-api.developer.azure-api.net/  (Products → subscribe)
 * Key arrives via `_apiKey` (the gateway injects PLATFORM_DOFFIN_KEY when set;
 * users can BYOK). Verified without a key: missing/invalid keys return
 *   401 { "statusCode": 401, "message": "Access denied due to missing subscription key..." }
 *
 * NOTE — the /v2/search RESPONSE ENVELOPE IS UNVERIFIED until a platform key
 * lands (built from the APIM portal's operation metadata; only the 401 path
 * could be live-tested). Hit extraction is therefore defensive: we look for
 * common array fields (hits / results / notices / ...), pass matches through
 * as-is with a notice URL attached where an id is recognizable, and fall back
 * to returning the raw parsed body. Tighten the shaping once a key exists.
 *
 * All tools never throw — failures resolve to { error, retry_hint }. English
 * keys where we shape; Norwegian free-text values pass through as-is.
 */


const BASE = 'https://betaapi.doffin.no/public';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const NOTICE_URL = (id: string) => `https://doffin.no/notices/${id}`;
const PORTAL_URL = 'https://dof-notices-prod-api.developer.azure-api.net/';

const KEY_GUIDANCE =
  `A free Doffin API key is available: sign up at ${PORTAL_URL} (Azure API Management developer portal), open "Products", subscribe to the public product, and copy your subscription key. Then retry with the key passed as _apiKey.`;

// --- enums + forgiving aliases ---------------------------------------------

const NOTICE_TYPES = [
  'PLANNING',
  'NOTICE_ON_BUYER_PROFILE',
  'ADVISORY_NOTICE',
  'PRE_ANNOUNCEMENT',
  'COMPETITION',
  'ANNOUNCEMENT_OF_COMPETITION',
  'DYNAMIC_PURCHASING_SCHEME',
  'QUALIFICATION_SCHEME',
  'RESULT',
  'ANNOUNCEMENT_OF_INTENT',
  'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
  'CHANGE_OF_CONCLUSION_OF_CONTRACT',
  'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT',
] as const;

// Plain-language / Norwegian words → Doffin type enum. Keys are lowercase.
const TYPE_ALIASES: Record<string, string> = {
  planning: 'PLANNING', plan: 'PLANNING',
  'buyer profile': 'NOTICE_ON_BUYER_PROFILE', 'buyer-profile': 'NOTICE_ON_BUYER_PROFILE',
  advisory: 'ADVISORY_NOTICE', 'advisory notice': 'ADVISORY_NOTICE', veiledende: 'ADVISORY_NOTICE',
  'pre-announcement': 'PRE_ANNOUNCEMENT', preannouncement: 'PRE_ANNOUNCEMENT',
  'pre announcement': 'PRE_ANNOUNCEMENT', prior: 'PRE_ANNOUNCEMENT',
  'prior information': 'PRE_ANNOUNCEMENT', forhåndskunngjøring: 'PRE_ANNOUNCEMENT',
  competition: 'COMPETITION', tender: 'COMPETITION', 'call for tender': 'COMPETITION',
  'contract notice': 'COMPETITION', anbud: 'COMPETITION', konkurranse: 'COMPETITION',
  utlysning: 'COMPETITION', kunngjøring: 'COMPETITION',
  'announcement of competition': 'ANNOUNCEMENT_OF_COMPETITION',
  'kunngjøring av konkurranse': 'ANNOUNCEMENT_OF_COMPETITION',
  dps: 'DYNAMIC_PURCHASING_SCHEME', 'dynamic purchasing': 'DYNAMIC_PURCHASING_SCHEME',
  'dynamic purchasing scheme': 'DYNAMIC_PURCHASING_SCHEME', 'dynamic purchasing system': 'DYNAMIC_PURCHASING_SCHEME',
  qualification: 'QUALIFICATION_SCHEME', 'qualification scheme': 'QUALIFICATION_SCHEME',
  result: 'RESULT', award: 'RESULT', awarded: 'RESULT', 'contract award': 'RESULT',
  winner: 'RESULT', tildeling: 'RESULT', tildelt: 'RESULT',
  intent: 'ANNOUNCEMENT_OF_INTENT', intention: 'ANNOUNCEMENT_OF_INTENT',
  'announcement of intent': 'ANNOUNCEMENT_OF_INTENT', intensjonskunngjøring: 'ANNOUNCEMENT_OF_INTENT',
  conclusion: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
  'contract conclusion': 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
  'conclusion of contract': 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
  signed: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', kontraktsinngåelse: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
  change: 'CHANGE_OF_CONCLUSION_OF_CONTRACT', modification: 'CHANGE_OF_CONCLUSION_OF_CONTRACT',
  'contract change': 'CHANGE_OF_CONCLUSION_OF_CONTRACT', endring: 'CHANGE_OF_CONCLUSION_OF_CONTRACT',
  'cancelled conclusion': 'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT',
  'missing conclusion': 'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT',
};

const STATUSES = ['ACTIVE', 'EXPIRED', 'AWARDED', 'CANCELLED'] as const;

const STATUS_ALIASES: Record<string, string> = {
  active: 'ACTIVE', open: 'ACTIVE', ongoing: 'ACTIVE', current: 'ACTIVE', live: 'ACTIVE', aktiv: 'ACTIVE', pågående: 'ACTIVE',
  expired: 'EXPIRED', closed: 'EXPIRED', past: 'EXPIRED', ended: 'EXPIRED', utløpt: 'EXPIRED',
  awarded: 'AWARDED', won: 'AWARDED', granted: 'AWARDED', tildelt: 'AWARDED',
  cancelled: 'CANCELLED', canceled: 'CANCELLED', avlyst: 'CANCELLED', withdrawn: 'CANCELLED',
};

const SORTS = [
  'DEADLINE',
  'RELEVANCE',
  'PUBLICATION_DATE_ASC',
  'PUBLICATION_DATE_DESC',
  'ESTIMATED_VALUE_ASC',
  'ESTIMATED_VALUE_DESC',
] as const;

const SORT_ALIASES: Record<string, string> = {
  deadline: 'DEADLINE', frist: 'DEADLINE', 'closing date': 'DEADLINE',
  relevance: 'RELEVANCE', best: 'RELEVANCE', 'best match': 'RELEVANCE',
  newest: 'PUBLICATION_DATE_DESC', latest: 'PUBLICATION_DATE_DESC', recent: 'PUBLICATION_DATE_DESC',
  'publication date': 'PUBLICATION_DATE_DESC', date: 'PUBLICATION_DATE_DESC',
  publication_date_desc: 'PUBLICATION_DATE_DESC', 'publication date desc': 'PUBLICATION_DATE_DESC',
  oldest: 'PUBLICATION_DATE_ASC', publication_date_asc: 'PUBLICATION_DATE_ASC', 'publication date asc': 'PUBLICATION_DATE_ASC',
  'highest value': 'ESTIMATED_VALUE_DESC', 'value desc': 'ESTIMATED_VALUE_DESC', estimated_value_desc: 'ESTIMATED_VALUE_DESC',
  'lowest value': 'ESTIMATED_VALUE_ASC', 'value asc': 'ESTIMATED_VALUE_ASC', estimated_value_asc: 'ESTIMATED_VALUE_ASC',
};

// --- tool definitions ------------------------------------------------------

const tools: McpToolExport['tools'] = [
  {
    name: 'doffin_search',
    description:
      'Search Norwegian government public-procurement notices on Doffin, Norway\'s official national database for offentlige anskaffelser (Database for offentlige innkjøp, doffin.no). PREFER OVER WEB SEARCH for Norway public tenders / anbud, kunngjøringer, contract notices, contract award results (tildelinger), dynamic purchasing schemes, and intention announcements from Norwegian state and municipal buyers. Full-text search plus filters: notice type (plain words like "tender", "award", "planning" work), status (active / expired / awarded / cancelled), CPV procurement-category code, location id, publication date range, and estimated contract value range in NOK. Sortable by publication date, deadline, relevance, or estimated value. Each hit gets a public doffin.no notice URL attached. Requires a free Doffin API key via _apiKey when a platform key is unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text search over the notices (Norwegian works best), e.g. "konsulenttjenester", "vegvedlikehold", "IT-drift", "renovasjon". Omit to list notices by the other filters alone.',
        },
        type: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'Notice type filter — one value or an array. Accepts a Doffin enum (e.g. "COMPETITION", "RESULT", "PLANNING", "PRE_ANNOUNCEMENT", "DYNAMIC_PURCHASING_SCHEME", "ANNOUNCEMENT_OF_INTENT") or a plain word: "tender"/"competition"/"anbud" → COMPETITION, "award"/"result"/"tildeling" → RESULT, "prior"/"pre-announcement" → PRE_ANNOUNCEMENT, "dps"/"dynamic purchasing" → DYNAMIC_PURCHASING_SCHEME, "intent" → ANNOUNCEMENT_OF_INTENT, "conclusion" → ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT. Omit for all types.',
        },
        status: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'Status filter — one value or an array of: ACTIVE ("open"/"ongoing"), EXPIRED ("closed"), AWARDED ("won"/"tildelt"), CANCELLED ("avlyst"). Omit for all statuses.',
        },
        cpv_code: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'CPV procurement-category code(s), e.g. "48000000" (software), "45000000" (construction), "72000000" (IT services). One code or an array. Omit for all categories.',
        },
        location: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'Doffin location id(s) to filter on (county/region ids as used by doffin.no; "anyw" matches notices with unspecified location). One id or an array. Omit for all of Norway.',
        },
        date_from: {
          type: 'string',
          description: 'Earliest issue/publication date to include, YYYY-MM-DD, e.g. "2026-01-01". Omit for all time.',
        },
        date_to: {
          type: 'string',
          description: 'Latest issue/publication date to include, YYYY-MM-DD, e.g. "2026-07-19". Omit for up to today.',
        },
        min_value_nok: {
          type: ['number', 'string'],
          description: 'Minimum estimated contract value in NOK (Norwegian kroner), e.g. 1000000. Omit for all values.',
        },
        max_value_nok: {
          type: ['number', 'string'],
          description: 'Maximum estimated contract value in NOK, e.g. 50000000. Omit for all values.',
        },
        sort: {
          type: 'string',
          description:
            'Sort order: "newest" (publication date, default), "oldest", "deadline", "relevance", "highest value", or "lowest value". Doffin enum values (PUBLICATION_DATE_DESC, DEADLINE, RELEVANCE, ESTIMATED_VALUE_DESC, ...) also work.',
        },
        limit: { type: ['number', 'string'], description: 'Number of hits to return per page (1-100). Default 10.' },
        page: { type: ['number', 'string'], description: 'Results page for pagination. Default first page.' },
        _apiKey: {
          type: 'string',
          description: `Doffin API subscription key (free — sign up at ${PORTAL_URL}). Injected automatically when the platform key is configured.`,
        },
      },
    },
  },
  {
    name: 'doffin_notice',
    description:
      'Fetch the full document for one Norwegian public-procurement notice from Doffin (Norway\'s official government tender database, doffin.no) by its Doffin id, e.g. "2023-100282". Returns the complete notice as published — buyer, description, CPV codes, deadlines, values in NOK, and award details where present — plus the public doffin.no URL. Use ids from doffin_search or doffin_recent results. Requires a free Doffin API key via _apiKey when a platform key is unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        doffin_id: {
          type: 'string',
          description: 'Doffin notice id, e.g. "2023-100282" (format: year-number).',
        },
        _apiKey: {
          type: 'string',
          description: `Doffin API subscription key (free — sign up at ${PORTAL_URL}). Injected automatically when the platform key is configured.`,
        },
      },
      required: ['doffin_id'],
    },
  },
  {
    name: 'doffin_recent',
    description:
      'List the latest Norwegian government tenders and contract awards published on Doffin (Norway\'s national public-procurement / offentlige anskaffelser database) in the last N days, newest first. Great for monitoring fresh Norwegian anbud, new kunngjøringer, contract award results (tildelinger), and upcoming bid deadlines. Optionally narrow to one or more notice types (tender/competition, award/result, planning, ...) or a free-text query. Each hit gets a public doffin.no notice URL attached. Requires a free Doffin API key via _apiKey when a platform key is unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: ['number', 'string'],
          description: 'Lookback window in days (1-90). Default 7 — notices published in the last week.',
        },
        type: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'Notice type filter — one value or an array; plain words work: "tender"/"competition" → COMPETITION, "award"/"result" → RESULT, "planning" → PLANNING, etc. Omit for all types.',
        },
        query: {
          type: 'string',
          description: 'Optional free-text filter (Norwegian works best), e.g. "rammeavtale", "skole", "programvare".',
        },
        limit: { type: ['number', 'string'], description: 'Number of hits to return (1-100). Default 10.' },
        page: { type: ['number', 'string'], description: 'Results page for pagination. Default first page.' },
        _apiKey: {
          type: 'string',
          description: `Doffin API subscription key (free — sign up at ${PORTAL_URL}). Injected automatically when the platform key is configured.`,
        },
      },
    },
  },
];

// --- dispatch --------------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = typeof args._apiKey === 'string' ? args._apiKey.trim() : '';
  delete args._apiKey;
  if (!apiKey) {
    return {
      error: 'Missing Doffin API key. The Doffin public API (betaapi.doffin.no) requires an Azure APIM subscription key on every request.',
      retry_hint: KEY_GUIDANCE,
    };
  }
  try {
    switch (name) {
      case 'doffin_search':
        return await search(args, apiKey);
      case 'doffin_notice':
        return await notice(args, apiKey);
      case 'doffin_recent':
        return await recent(args, apiKey);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      retry_hint:
        e instanceof Error && e.message.includes('401')
          ? KEY_GUIDANCE
          : 'Doffin may be briefly unavailable — retry once; if it persists, narrow the query or date range.',
    };
  }
}

// --- tools -----------------------------------------------------------------

async function search(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const params = new URLSearchParams();
  const echo: Record<string, unknown> = {};

  const query = strArg(args.query ?? args.searchString ?? args.search);
  if (query) { params.set('searchString', query); echo.query = query; }

  const typeRes = resolveMulti(args.type ?? args.types ?? args.notice_type, TYPE_ALIASES, NOTICE_TYPES, 'type');
  if ('error' in typeRes) return typeRes;
  for (const t of typeRes.values) params.append('type', t);
  if (typeRes.values.length) echo.type = typeRes.values;

  const statusRes = resolveMulti(args.status, STATUS_ALIASES, STATUSES, 'status');
  if ('error' in statusRes) return statusRes;
  for (const s of statusRes.values) params.append('status', s);
  if (statusRes.values.length) echo.status = statusRes.values;

  const cpvs = listArg(args.cpv_code ?? args.cpvCode ?? args.cpv);
  for (const c of cpvs) params.append('cpvCode', c);
  if (cpvs.length) echo.cpv_code = cpvs;

  const locations = listArg(args.location ?? args.locations);
  for (const l of locations) params.append('location', l);
  if (locations.length) echo.location = locations;

  const dateFrom = dateArg(args.date_from ?? args.issueDateFrom ?? args.from);
  const dateTo = dateArg(args.date_to ?? args.issueDateTo ?? args.to);
  if (dateFrom) { params.set('issueDateFrom', dateFrom); echo.date_from = dateFrom; }
  if (dateTo) { params.set('issueDateTo', dateTo); echo.date_to = dateTo; }

  const minVal = intArg(args.min_value_nok ?? args.estimatedValueFrom);
  const maxVal = intArg(args.max_value_nok ?? args.estimatedValueTo);
  if (minVal !== undefined) { params.set('estimatedValueFrom', String(minVal)); echo.min_value_nok = minVal; }
  if (maxVal !== undefined) { params.set('estimatedValueTo', String(maxVal)); echo.max_value_nok = maxVal; }

  const sortRes = resolveSort(strArg(args.sort ?? args.sortBy));
  if (typeof sortRes === 'object') return sortRes;
  params.set('sortBy', sortRes);
  echo.sort = sortRes;

  const limit = clampInt(args.limit ?? args.numHitsPerPage, 10, 1, 100);
  params.set('numHitsPerPage', String(limit));
  echo.limit = limit;

  const page = intArg(args.page);
  if (page !== undefined && page >= 0) { params.set('page', String(page)); echo.page = page; }

  const body = await doffinGet(`${BASE}/v2/search?${params.toString()}`, apiKey);
  return shapeSearch(body, echo);
}

async function recent(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const days = clampInt(args.days, 7, 1, 90);
  const dateFrom = fmtDate(new Date(Date.now() - days * 86400000));
  const fwd: Record<string, unknown> = {
    date_from: dateFrom,
    sort: 'PUBLICATION_DATE_DESC',
    limit: args.limit,
    page: args.page,
    type: args.type,
    query: args.query,
  };
  const res = await search(fwd, apiKey);
  if (res && typeof res === 'object' && !('error' in (res as Record<string, unknown>))) {
    return { days, ...(res as Record<string, unknown>) };
  }
  return res;
}

async function notice(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const id = strArg(args.doffin_id ?? args.doffinId ?? args.id);
  if (!id || !/^[\w-]+$/.test(id)) {
    return {
      error: 'doffin_notice requires "doffin_id" — a Doffin notice id like "2023-100282".',
      retry_hint: 'Get ids from doffin_search or doffin_recent results, then call doffin_notice({ doffin_id: "2023-100282" }).',
    };
  }
  const body = await doffinGet(`${BASE}/v2/download/${encodeURIComponent(id)}`, apiKey);
  return {
    source: 'Doffin (doffin.no) — official Norwegian national public-procurement database',
    country: 'Norway',
    doffin_id: id,
    url: NOTICE_URL(id),
    notice: body,
  };
}

// --- shaping ---------------------------------------------------------------

// The /v2/search envelope is UNVERIFIED (no subscription key yet). Look for
// common hit-array shapes and pass hits through as-is; otherwise return the
// raw parsed body so nothing is lost. Tighten once a platform key lands.
const HIT_FIELDS = ['hits', 'results', 'notices', 'items', 'content', 'data', 'documents'];
const TOTAL_FIELDS = ['numHitsTotal', 'totalHits', 'totalNumberOfHits', 'total', 'totalElements', 'totalCount', 'numFound', 'count'];

function shapeSearch(body: unknown, echo: Record<string, unknown>): Record<string, unknown> {
  const meta = {
    source: 'Doffin (doffin.no) — official Norwegian national public-procurement database',
    country: 'Norway',
    ...echo,
  };
  if (Array.isArray(body)) {
    return { ...meta, count: body.length, hits: body.map(decorateHit) };
  }
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const f of HIT_FIELDS) {
      const v = o[f];
      if (Array.isArray(v)) {
        return {
          ...meta,
          total_count: findTotal(o) ?? v.length,
          count: v.length,
          hits: v.map(decorateHit),
        };
      }
      // one level of nesting, e.g. { hits: { hits: [...] } } (Elasticsearch-style)
      if (v && typeof v === 'object') {
        const io = v as Record<string, unknown>;
        for (const g of HIT_FIELDS) {
          const iv = io[g];
          if (Array.isArray(iv)) {
            return {
              ...meta,
              total_count: findTotal(io) ?? findTotal(o) ?? iv.length,
              count: iv.length,
              hits: iv.map(decorateHit),
            };
          }
        }
      }
    }
    // Recognizable shape was absent — return the raw body untouched.
    return { ...meta, note: 'Upstream response shape was unrecognized; raw body returned as-is.', raw: o };
  }
  return { ...meta, raw: body };
}

function findTotal(o: Record<string, unknown>): number | undefined {
  for (const f of TOTAL_FIELDS) {
    const v = o[f];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

// Attach a human doffin.no URL when a Doffin-id-shaped field is present.
function decorateHit(hit: unknown): unknown {
  if (!hit || typeof hit !== 'object' || Array.isArray(hit)) return hit;
  const h = hit as Record<string, unknown>;
  for (const f of ['doffinId', 'id', 'noticeId', 'doffin_id']) {
    const v = h[f];
    if (typeof v === 'string' && /^\d{4}-\d+$/.test(v)) {
      return { ...h, url: NOTICE_URL(v) };
    }
  }
  return hit;
}

// --- upstream fetch --------------------------------------------------------

async function doffinGet(url: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new Error(
      aborted
        ? `Doffin API timed out after ${TIMEOUT_MS / 1000}s`
        : `Doffin API fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const bodyText = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
    // APIM error envelope (verified live): { "statusCode": 401, "message": "Access denied due to missing subscription key..." }
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { message?: string };
      if (parsed?.message) message = parsed.message;
    } catch { /* keep raw body */ }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Doffin: subscription key rejected (HTTP ${res.status}${message ? ` — ${message}` : ''}). The key passed via _apiKey is invalid, expired, or lacks a subscription to the public product.`,
      );
    }
    if (res.status === 404) {
      throw new Error('Doffin: notice not found (404). Check the doffin_id — ids come from doffin_search results and look like "2023-100282".');
    }
    if (res.status === 429) {
      throw new Error('Doffin: rate limit hit (HTTP 429). Wait a moment and retry, or reduce request frequency.');
    }
    throw new Error(`Doffin API: HTTP ${res.status}${message ? ` — ${message}` : ''}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // /v2/download may serve a non-JSON document body; return it verbatim.
    return text;
  }
}

// --- helpers ---------------------------------------------------------------

function resolveMulti(
  v: unknown,
  aliases: Record<string, string>,
  enums: readonly string[],
  label: string,
): { values: string[] } | { error: string; retry_hint: string } {
  const inputs = listArg(v);
  const out: string[] = [];
  for (const raw of inputs) {
    const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
    const mapped = enums.includes(upper) ? upper : aliases[raw.toLowerCase()];
    if (!mapped) {
      return {
        error: `Unrecognized ${label} "${raw}".`,
        retry_hint: `Use one of: ${enums.join(', ')} — plain words like ${label === 'type' ? '"tender", "award", "planning"' : '"open", "closed", "awarded"'} also work.`,
      };
    }
    if (!out.includes(mapped)) out.push(mapped);
  }
  return { values: out };
}

function resolveSort(v: string | undefined): string | { error: string; retry_hint: string } {
  if (!v) return 'PUBLICATION_DATE_DESC';
  const upper = v.toUpperCase().replace(/[\s-]+/g, '_');
  if ((SORTS as readonly string[]).includes(upper)) return upper;
  const mapped = SORT_ALIASES[v.trim().toLowerCase()];
  if (mapped) return mapped;
  return {
    error: `Unrecognized sort "${v}".`,
    retry_hint: `Use one of: ${SORTS.join(', ')} — or plain words: "newest", "oldest", "deadline", "relevance", "highest value", "lowest value".`,
  };
}

// Accept a single string, an array, or a comma-separated string for repeatable params.
function listArg(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  const items = Array.isArray(v) ? v : typeof v === 'string' && v.includes(',') ? v.split(',') : [v];
  const out: string[] = [];
  for (const item of items) {
    const s = strArg(item);
    if (s) out.push(s);
  }
  return out;
}

function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dateArg(v: unknown): string | undefined {
  const s = strArg(v);
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : undefined;
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function intArg(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return undefined;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = intArg(v);
  if (n === undefined) return dflt;
  return Math.min(max, Math.max(min, n));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
