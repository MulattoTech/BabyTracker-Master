# Bottle Journal

Sat Tracker's bottle workflow reads and writes the canonical `FeedLog`, shared
with OCR, the timeline, reports, and the existing feeding forms. It does not have
its own care database. Household/child scope comes from authenticated middleware.

The page supports consumed/offered volume, ML/OZ, optional formula details,
caregiver attribution, selected local-day and rolling 24-hour totals, and an
owner-set per-child intake target. A target is user supplied and never inferred
from medical information. Calendar boundaries follow the chosen IANA time zone;
rolling totals always represent 24 elapsed hours, including daylight saving days.

Creates have stable retry IDs. Edits require the last observed revision timestamp
and reject concurrent updates. A save notice appears only after server success.
The foreground page polls every 15 seconds, uses conditional requests, and also
refreshes on focus/reconnection or Sync now. Offline edits remain in the open form;
this release does not promise a background offline queue.

`LegacyImport` previews Family Bottle Journal v1/v2 JSON and its CSV export format.
Only explicitly reviewed rows commit, atomically, with stable per-family source
provenance. Repeated files are idempotent. Unknown times stay unresolved. Pending
changes/conflicts in the old journal are called out, retained in that export, and
must be resolved separately. Intake targets never change as a side effect of import.

The old journal's Windows/Android wrappers and Cloudflare storage remain preserved.
Use this app's existing PWA installation for the consolidated mobile experience.
