# Bottle Journal

Sat Tracker's bottle workflow reads and writes the canonical `FeedLog`, shared
with OCR, the timeline, reports, and the existing feeding forms. It does not have
its own care database. Household/child scope comes from authenticated middleware.

The page supports consumed/offered volume, ML/OZ, optional formula details,
caregiver attribution, selected local-day and rolling 24-hour totals, and an
owner-set per-child intake target. A target is user supplied and never inferred
from medical information. Calendar boundaries follow the chosen IANA time zone;
rolling totals always represent 24 elapsed hours, including daylight saving days.

New bottles enter an IndexedDB outbox before transmission, using immutable UUIDs
and normalized payloads. Its transactions preserve concurrent-tab writes and
short send leases prevent simultaneous replay. Entries persist through reload and
browser restart, with a limit of 100 pending bottles across this origin. They are
excluded from canonical totals until the server confirms them. The UI distinguishes
local pending confirmation from `Bottle saved.`; storage failures retain the form.

The outbox is scoped to the current account/caregiver, family, and selected child.
It contains no credentials. A server-side expected-scope check prevents a token
refresh or login change from replaying another caregiver's payload. Access remains
enforced by existing middleware and child ownership. Local browser storage is not
encrypted; use a trusted device and normal browser profile protections. Clearing
site data removes unsent bottles, and the UI says so. Entries are never expired or
silently discarded by the application.

While this Journal is open, pending creates retry on reconnect/focus or every five
seconds, with bounded backoff and a 20-second request timeout. Validation, access,
and conflict responses require explicit review/retry. Discard requires a separate
confirmation and removes only the local copy, never a server record. A lost server
response retries the same UUID and exact timestamp/payload. The existing server
idempotency contract prevents duplicate FeedLog/provenance creation.

Historical edits still require the last observed revision timestamp and reject
concurrent updates; they remain in the open form on failure. This slice supports
new entries in an already loaded Journal and durable recovery when the app next
loads. It does not promise cold offline navigation, an offline PWA shell, background
sync while closed, or offline historical edits/targets/imports. The foreground
history continues polling every 15 seconds and on focus/reconnection or Sync now.

`scripts/journal-outbox-browser.mjs`, invoked by the canonical browser acceptance,
tests a real disconnected Chromium context, IndexedDB persistence through reload
and a full persistent-profile browser restart, different-caregiver isolation, the
actual expected-scope API rejection, lost-response replay, concurrent offline tabs,
and real conflicting records on disposable SQLite storage. This is synthetic
desktop browser evidence, not physical Pixel/iPad acceptance.

`LegacyImport` previews Family Bottle Journal v1/v2 JSON and its CSV export format.
Only explicitly reviewed rows commit, atomically, with stable per-family source
provenance. Repeated files are idempotent. Unknown times stay unresolved. Pending
changes/conflicts in the old journal are called out, retained in that export, and
must be resolved separately. Intake targets never change as a side effect of import.

The old journal's Windows/Android wrappers and Cloudflare storage remain preserved.
Use this app's existing PWA installation for the consolidated mobile experience.
