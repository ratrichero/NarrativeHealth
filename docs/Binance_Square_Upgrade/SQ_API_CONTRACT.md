# Binance Square API Contract

## 1. Status

**FROZEN — LIVE VERIFIED**

This document is the authoritative API contract for the NarrativeHealth Binance Square publisher. It is based on a real production API call that created a real post on Binance Square.

## 2. Purpose

This contract governs publishing posts to Binance Square from the NarrativeHealth system. It defines the exact endpoint, authentication method, request structure, and response handling that the production publisher must use.

## 3. Endpoint

```
POST https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add
```

- **Host:** `www.binance.com`
- **Path:** `/bapi/composite/v1/public/pgc/openApi/content/add`
- **Method:** `POST`

## 4. Authentication

```
X-Square-OpenAPI-Key: <BINANCE_SQUARE_OPENAPI_KEY>
```

**Important:** This is the Binance Square OpenAPI authentication header. It is **NOT** the generic Binance Spot API header `X-MBX-APIKEY`.

The API key is loaded from the environment variable:

```env
BINANCE_SQUARE_OPENAPI_KEY=...
```

**Security rules:**
- Server-side only
- Environment variable only
- Never expose to browser/client
- Never log the value
- Never commit to source control
- Never include in documentation

## 5. Minimal Verified Request

```json
{
  "contentType": 1,
  "bodyTextOnly": "$BTC Binance Square API live integration test."
}
```

**Field definitions:**

| Field | Type | Description |
|---|---|---|
| `contentType` | integer | `1` = short text post. `2` = article with title/cover (where supported). |
| `bodyTextOnly` | string | Post body text. Supports `$CASHTAG` and `#topic` syntax. |

**Content requirements:**
- Cashtags must be in the format `$SYMBOL` (e.g., `$BTC`)
- Topics must be in the format `#topic`
- Content must comply with Binance Square content policies

## 6. Response

### Success Response

```json
{
  "code": "000000",
  "message": null,
  "success": true,
  "data": {
    "id": "357738400893035",
    "shareLink": "https://app.binance.com/uni-qr/cpos/357738400893035"
  }
}
```

**Success detection:**
- HTTP status `200`
- `code` equals `"000000"`
- `success` equals `true`
- `data.id` contains the real post identifier

### Error Response

```json
{
  "code": "220003",
  "message": "API key not found",
  "success": false
}
```

**Common error codes:**

| Code | Meaning |
|---|---|
| `220003` | API key not found |
| `220004` | API key expired |
| `220009` | Daily post limit exceeded |
| `220014` | Daily upload limit exceeded |
| `20002` / `20022` | Sensitive words detected |
| `20013` | Content length limited |
| `30008` / `2000001` / `2000002` | Account/device restriction |

## 7. Real Verification Evidence

**Test date:** SQ-LIVE-03

**Request:**
```
POST https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add
Header: X-Square-OpenAPI-Key: <redacted>
Body: { "contentType": 1, "bodyTextOnly": "$BTC Binance Square API live integration test." }
```

**Response:**
```
HTTP 200
{
  "code": "000000",
  "message": null,
  "success": true
}
```

**Post ID:** `357738400893035`

**Canonical URL:** `https://www.binance.com/en/square/post/357738400893035`

**Share URL:** `https://app.binance.com/uni-qr/cpos/357738400893035`

**Verification conditions:**
- REAL production API call
- NO mock
- NO simulated response
- NO sandbox environment

## 8. Incorrect Legacy Contract

The following contract was previously documented in project materials but is **WRONG** for Binance Square posting:

```
❌ Host: openapi.binance.com
❌ Path: /sapi/v1/public/content/add
❌ Header: X-MBX-APIKEY
```

These belong to other Binance API families (Spot API, etc.) and were incorrectly referenced in earlier Square documentation. They must **NOT** be used for Square publishing.

**Current project files that previously contained the wrong contract have been corrected.** Historical investigation reports preserve the context of the discovery.

## 9. Contract Ownership

This document is the authoritative contract for the NarrativeHealth Binance Square publisher.

- **Authoritative source:** `docs/Binance_Square_Upgrade/SQ_API_CONTRACT.md`
- **Production implementation:** `src/lib/square/publisher.ts`
- **Test helpers:** `scripts/test-binance-api.js`, `scripts/controlled-publish.js`
- **Real verification record:** `docs/Binance_Square_Upgrade/SQ-LIVE-03_REAL_POST.md`

Any future changes to this contract require:
1. A new live verification test
2. Update to this document
3. Update to all production code references
4. Update to all current documentation references
