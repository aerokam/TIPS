# FiscalData `auctions_query` — Reference

## Endpoint
```
GET https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query
```
No auth required. All values returned as strings (including nulls → `"null"`).

---

## Query Parameters

| Param | Example | Notes |
|---|---|---|
| `fields` | `fields=cusip,auction_date,security_type` | Comma-separated; omit to get all 113 fields |
| `filter` | `filter=security_type:eq:Bill,reopening:eq:No` | Comma-separated; ANDed |
| `sort` | `sort=-auction_date` | `-` prefix = descending |
| `format` | `format=json` | `json` (default), `csv`, `xml` — use `json` to strip columns before uploading |
| `page[number]` | `page[number]=1` | 1-indexed |
| `page[size]` | `page[size]=500` | Default 100; increase if expected rows > 100 |

### Filter Operators
`eq` `neq` `lt` `lte` `gt` `gte` `in` `nin`  
`in`/`nin` value format: `(val1,val2)`

---

## Key Fields for Filtering / Selection

### Identity
| Field | Type | Notes |
|---|---|---|
| `cusip` | string | 9-char CUSIP |
| `security_type` | string | **`Bill`, `Note`, `Bond`** |
| `security_term` | string | e.g. `4-Week`, `13-Week`, `2-Year`, `10-Year`, `30-Year` |
| `reopening` | string | `Yes` / `No` |
| `inflation_index_security` | string | `Yes` / `No` (TIPS only) |

### Dates
| Field | Type | Notes |
|---|---|---|
| `announcemt_date` | date | Announcement date |
| `auction_date` | date | Date of auction |
| `issue_date` | date | Settlement date |
| `maturity_date` | date | Maturity date |
| `dated_date` | date | Interest accrual start (TIPS) |
| `original_issue_date` | date | Original issue for reopenings |

### Pricing / Rate
| Field | Type | Notes |
|---|---|---|
| `int_rate` | decimal | Coupon rate (Notes, Bonds, TIPS, FRN) |
| `high_yield` | decimal | High yield (Notes, Bonds, TIPS) |
| `high_investment_rate` | decimal | High investment rate (Bills) |
| `high_price` | decimal | High price |
| `unadj_price` | decimal | Unadjusted price (TIPS) |
| `adj_price` | decimal | Inflation-adjusted price (TIPS) |
| `ref_cpi_on_dated_date` | decimal | Reference CPI on dated date (TIPS) |
| `accrued_int_per1000` | decimal | Accrued interest per $1,000 |

### Sizing / Demand
| Field | Type | Notes |
|---|---|---|
| `offering_amt` | decimal | Amount offered (thousands) |
| `comp_accepted` | decimal | Accepted competitive bids |
| `total_accepted` | decimal | Total accepted |
| `total_tendered` | decimal | Total tendered |
| `bid_to_cover_ratio` | decimal | Bid-to-cover ratio |
| `primary_dealer_accepted` | decimal | Primary dealer accepted |
| `direct_bidder_accepted` | decimal | Direct bidder accepted |
| `indirect_bidder_accepted` | decimal | Indirect bidder accepted |

### TIPS Accrued Interest & Index (TIPS only)
| Field | Type | Notes |
|---|---|---|
| `adj_accrued_int_per1000` | decimal | Inflation-adjusted accrued interest per $1,000 |
| `index_ratio_on_issue_date` | decimal | CPI index ratio on issue date |
| `ref_cpi_on_issue_date` | decimal | Reference CPI on issue date |

### Other
| Field | Type | Notes |
|---|---|---|
| `original_security_term` | string | Original term for reopenings |

---

## ⚠️ Known Gotcha: TIPS Filtering

`security_type:eq:TIPS` returns 0 results. FiscalData changed this.  
**Correct filter:** `inflation_index_security:eq:Yes`

---

## `security_type` Values & Typical Terms

| Type | Typical `security_term` values |
|---|---|
| `Bill` | `4-Week`, `8-Week`, `13-Week`, `17-Week`, `26-Week`, `52-Week` |
| `Note` | `2-Year`, `3-Year`, `5-Year`, `7-Year`, `10-Year` |
| `Bond` | `20-Year`, `30-Year` |

---

## Script Pattern (Apps Script)

```javascript
function fetchAndUploadXxx() {
  const BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
  const ENDPOINT = "/v1/accounting/od/auctions_query";

  const FIELDS = ["cusip", "security_type", "security_term", "auction_date",
                  "issue_date", "maturity_date", "reopening", /* ... */ ];

  const url = BASE + ENDPOINT
    + "?format=json"
    + "&fields=" + FIELDS.join(",")
    + "&filter=security_type:eq:Bill,reopening:eq:No"  // ← adjust per request
    + "&sort=-auction_date"
    + "&page[number]=1"
    + "&page[size]=500";

  const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  // json.data = array of row objects
  // json.meta["total-count"] = total rows available

  const OUTPUT_FIELDS = FIELDS.filter(f => f !== "reopening"); // strip const columns
  const csv = [
    OUTPUT_FIELDS.join(","),
    ...json.data.map(r => OUTPUT_FIELDS.map(f => r[f] ?? "").join(","))
  ].join("\n");

  uploadToR2(csv, "data", "path/to/output.csv");
}
```

**Notes:**
- Omit constant filter columns from output CSV (e.g. `security_type`, `reopening` if filtered to a single value).
- Check `json.meta["total-count"]` vs `page[size]` — if count > size, add pagination loop.
- Date filters use `YYYY-MM-DD` format: `auction_date:gte:2024-01-01`.
