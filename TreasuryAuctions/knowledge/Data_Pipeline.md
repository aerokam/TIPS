# 0.0 Data Pipeline — TreasuryAuctions

## Data Sources

### Historical Auction Results (`Auctions.csv`)
- **Source:** FiscalData API — `api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query`
- **Script:** `scripts/getAuctions.js` (repo root scripts/)
- **R2 key:** `Treasuries/Auctions.csv`
- **Public URL:** `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/Auctions.csv`
- **GH workflow:** `get-auctions.yml` — runs at 11:05 AM ET and 1:35 PM ET on weekdays

#### Update logic
- **First run** (no existing R2 file): fetches all auctions since 1980-01-01
- **Subsequent runs:** fetches last 30 days from FiscalData, merges with existing R2 file; new data wins on conflict; deduped by `cusip + auction_date`

### Upcoming Auctions
- **Source:** FiscalData upcoming auctions endpoint — `api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions`
- **Fetched live** by the browser on page load (no R2, no caching)
- Filtered to `auction_date >= today`

---

## Fields

All fields from the FiscalData `auctions_query` endpoint are stored. Key fields used by the UI:

`cusip`, `security_type`, `security_term`, `original_security_term`, `announcemt_date`, `dated_date`, `auction_date`, `issue_date`, `maturity_date`, `int_rate`, `high_yield`, `high_investment_rate`, `high_price`, `unadj_price`, `adj_price`, `offering_amt`, `accrued_int_per1000`, `adj_accrued_int_per1000`, `ref_cpi_on_dated_date`, `ref_cpi_on_issue_date`, `index_ratio_on_issue_date`, `inflation_index_security`, `reopening`, `bid_to_cover_ratio`, `closing_time_comp`, `lut_dt`

---

## UI Views

Four filtered views, each with its own default visible column set (configurable by user):

| View | Filter |
|---|---|
| All | No filter |
| Bills | `security_type === 'Bill'` |
| Notes/Bonds | `security_type !== 'Bill'` AND `inflation_index_security !== 'Yes'` |
| TIPS | `inflation_index_security === 'Yes'` |

Default row cap: 100 rows for non-TIPS views when no date range is active. TIPS view and any date-ranged view are uncapped.
