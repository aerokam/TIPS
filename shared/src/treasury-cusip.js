// treasury-cusip.js — Canonical CUSIP-root classification for U.S. Treasury
// securities. Per the project-wide no-redundancy directive (projects/CLAUDE.md
// §2a), this is the one implementation; apps import it instead of guessing
// type from a broker's free-text description (unreliable — see
// knowledge/Treasury_CUSIP_Reference.md for why) or keeping their own copy.
//
// Cross-checked against Treasuries/Auctions.csv (full FiscalData auction
// history) — see knowledge/Treasury_CUSIP_Reference.md for the full reference
// and methodology.

const ROOT_TYPE = {
  '912797': 'Bill',
  '912793': 'Bill', // retired — no new issuance, appears on old matured Bills
  '912794': 'Bill', // retired
  '912795': 'Bill', // retired
  '912796': 'Bill', // retired
  '912810': 'Bond',
  '912828': 'Note',
  '91282C': 'Note',
  '912827': 'Note', // retired — used 1980-2002, none outstanding
  '912803': 'STRIPS', // Bond principal
  '912820': 'STRIPS', // Note principal
  '912821': 'STRIPS', // Note principal
  '912833': 'STRIPS', // Interest (coupon)
  '912834': 'STRIPS', // Interest (coupon)
};

// Returns 'Bill' | 'Note' | 'Bond' | 'STRIPS' | null (unrecognized root).
// Identifies the Bill/Note/Bond/STRIPS instrument family only — TIPS and FRNs
// share roots with their nominal counterparts, so that distinction must come
// from a separate field in the source data (see knowledge doc).
export function classifyByCusipRoot(cusip) {
  return ROOT_TYPE[(cusip || '').slice(0, 6)] || null;
}

export function isStrip(cusip) {
  return classifyByCusipRoot(cusip) === 'STRIPS';
}
