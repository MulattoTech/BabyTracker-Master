# OCR acceptance evidence — 2026-10-27

Scope: the first reviewed local OCR vertical slice on the exact Sprout Track
1.6.7 source baseline. Automated OCR and staging checks use synthetic documents
and care records. This record does not declare the full OCR issue or a production
release complete.

Application [PR #2] merged as
[`83326cfe964926b49b3bc487679cb9aa10170e8c`][merged commit]. The reviewed head was
`04feb01a92af4aa08b309f3e9d0db849d65cd1a1`; its tree matches the squash commit.
Both [exact-head acceptance CI] and [post-merge main CI] passed. The actual Docker
stage ran the immutable image recorded in [STAGING.md](STAGING.md), built from
`7b94b2290e6989adc9b9a99a2fc694c54258ccd7`. The only subsequent source change was
browser-test process cleanup in `scripts/ocr-browser-smoke.mjs`.

## Verified gates and release status

| Gate | Result |
| --- | --- |
| Full Vitest regression suite | 1,490 passed, 118 files |
| Production Next.js build | Passed, including TypeScript checking |
| Real native OCR and SQLite integration | Included in the full suite; 18 targeted tests also passed with a model-only `TESSDATA_PREFIX` |
| Browser upload/review/commit | Passed using official Chrome for Testing headless 145.0.7632.6 |
| Browser exact saved values | Corrected 95 mL feed at 2026-10-20T13:15:00Z and one diaper appeared in the existing timeline |
| Review confirmation | Upload and draft save wrote zero care events; final import button stayed disabled until explicit acknowledgment |
| Browser access controls | Unauthenticated request rejected; non-admin import request rejected |
| Responsive checks | 390×844 phone and 820×1180 tablet viewports had no horizontal overflow and reachable keyboard focus |
| Independent scoped code review | Two assistant reviewers; reported blocking findings resolved |
| Exact-head GitHub Actions | [Run 40456178992][exact-head acceptance CI] passed: 1,490 tests in 118 files, TypeScript, production build and real Chromium acceptance, including cleanup |
| Post-merge main GitHub Actions | [Run 40457271546][post-merge main CI] passed for merged commit `83326cf` |
| Native Docker HTTP qualification | Passed all nine checks on the separate synthetic stage: native recognition, review-only draft/save/preview, approved commit, exact retry, canonical values, ordinary timeline and original-source access |
| Original-image rollback rehearsal | Passed in 25.49 seconds on isolated cloned stage volumes: two complete canonical rows/IDs/timestamps, OCR/audit rows, two ledger mappings and two encrypted source files preserved; original auth/timeline and cleanup verified ([record and procedure][rollback evidence]) |
| Archival backup restore check | Existing 2026-10-07 archive, 128,393 bytes: both SQLite integrity checks and required encryption/configuration key presence passed in isolation; a fresh production backup and full restore acceptance remain open |
| Production rollout | Not performed; production remained healthy on its original image with unchanged start time `2026-10-26T23:15:27Z` |

The complete regression suite includes existing Sprout functionality. New tests
exercise parsing, ambiguity, correction, ML/OZ, DST gaps/folds, repeated source
uploads, near-time duplicates, explicit keep/skip, concurrent double commit,
atomic rollback, source encryption, cross-family denial and retention cleanup.
The browser exercised the actual application UI and ordinary timeline API.
The Alpine Docker stage independently exercised its real native OCR runtime and
HTTP endpoints. It was healthy after qualification and rollback recovery at the
host's loopback port `3124`, with three separate persistence volumes. The rollback
check used the original pinned image with no published ports and `--network none`,
then verified staging recovery and
removal of only the rehearsal's temporary resources. These results establish the
bounded synthetic SQLite scenario described in the [rollback evidence]; they do
not establish production-data or PostgreSQL rollback acceptance.

Independent review found and resolved native process memory limits, physical
retention, source-directory test isolation, key-order-independent retry hashing,
DST fold sleep ordering, duplicate-resolution CPU work, metadata-only history,
unsaved duplicate decisions and unclear whole-document finalization wording.
The release-layout check additionally caught a missing named Tesseract output
configuration; explicit TSV output flags and protocol validation fixed it.


## Release Gate Suite Verification — Issue #29 (2026-11-01)

An end-to-end synthetic acceptance test suite and automated release gate have been implemented in canonical BabyTracker:

```bash
# Run the unified release gate (Vitest E2E + Playwright Browser Viewports + Docker Staging check)
npm run test:release-gate

# Or run the Vitest acceptance suite directly
npm test -- tests/e2e-acceptance.test.ts

# Or run the browser acceptance suite directly
npm run test:acceptance:browser
```

### Gate Results (Synthetic Test Data Only)

| Requirement Code | Parity Requirement Description | Verification Outcome |
| :--- | :--- | :--- |
| **PARITY_MIXED_FEEDING_DIAPER_FLOW** | Synthetic mixed care sheet intake (photo/PDF) -> preview & crop -> parse candidate rows -> review UX adjustments -> explicit human confirmation -> reconciliation ledger -> canonical Sprout events | **PASS** |
| **PARITY_CROP_AND_PROVENANCE** | Crop specifications (pixel and percentage), rotation (0/90/180/270), and candidate provenance retention through review and persistence | **PASS** |
| **PARITY_REVIEW_UX_ADJUSTMENTS** | Review UX row adjustments, amounts (e.g. 90 -> 95 mL), notes, and approval toggles | **PASS** |
| **PARITY_EXPLICIT_HUMAN_CONFIRMATION** | Explicit review confirmation checkbox gating final import | **PASS** |
| **PARITY_RECONCILIATION_LEDGER** | Reconciliation ledger persistence (`ExternalImportRecord`) with provider ID, source record ID, and target entity type | **PASS** |
| **PARITY_SPROUT_TIMELINE_INTEGRATION** | Creation of canonical `FeedLog` and `DiaperLog` records with exact amounts and UTC timestamps | **PASS** |
| **PARITY_SAFETY_CANCELLATION_ZERO_ARTIFACTS** | Cancellation of review or uncommitted drafts leaves zero care records or orphan files | **PASS** |
| **PARITY_SAFETY_MALFORMED_ROWS_BLOCK_SAVE** | Malformed rows, missing dates/times, unapproved rows, and unacknowledged warnings block save | **PASS** |
| **PARITY_SAFETY_ATOMIC_ROLLBACK** | Atomic database transaction rollback on write error preserves clean timeline state | **PASS** |
| **PARITY_SAFETY_IDEMPOTENCY_AND_DUPLICATES** | Idempotent re-import, duplicate file hash detection, same-time event duplicate detection in preview, explicit keep vs. skip decisions | **PASS** |
| **PARITY_SAFETY_CROSS_FAMILY_ISOLATION** | Strict cross-family denial for documents, sources, previews, commits, and cryptographic state seals | **PASS** |
| **PARITY_VIEWPORT_PHONE_390PX** | Phone viewport (width 390px) responsive layout validation with zero horizontal overflow and accessible touch controls | **PASS** |
| **PARITY_VIEWPORT_TABLET_820PX** | Tablet viewport (width 820px iPad) layout validation with zero horizontal overflow and keyboard focus navigability | **PASS** |
| **PARITY_KEYBOARD_ACCESSIBILITY** | Keyboard focus navigability on mobile and tablet viewports | **PASS** |
| **PARITY_ZERO_CLIENT_JS_EXCEPTIONS** | Zero client-side JavaScript console errors | **PASS** |
| **PARITY_DOCKER_ISOLATED_STAGING** | Docker preview staging container verification against synthetic environment | **PASS** |


## Requirement traceability

The authoritative roadmap remains in `MulattoTech/BabyTracker`; do not create
duplicate OCR issues or close them on the basis of this source change alone.

| Existing issue | Evidence added here | Remaining acceptance |
| --- | --- | --- |
| [#11] OCR parent, P0 | Printed-log upload → review → canonical import; hosted CI, synthetic staging and bounded rollback | Representative handwritten/mixed forms and remaining production gates |
| [#37] intake | Images, multi-page PDFs, rotation, encrypted originals, resource limits | Representative smartphone photos, physical device acceptance |
| [#38] extraction | Conservative event splitting, field provenance and uncertainty | Handwriting-engine comparison and measured field/event errors |
| [#12] canonical import | Existing Sprout import executor, transactions, provenance, idempotency; deployed synthetic end-to-end qualification and preserved rollback ledger | Production qualification; undo and incremental-completion follow-ups |
| [#25] privacy | Local recognition, encryption, family scope, retention, source deletion; isolated archival integrity/key check | Fresh consistent production backup and protected full restore acceptance |
| [#29] acceptance | Regression, real Chromium, independent review, exact-head/main CI, native Docker staging and isolated older-image rollback | Owner-form/handwriting evidence, physical devices and remaining release gates under [#30] |

## Ten OCR criteria

| Criterion | Current evidence and limit |
| --- | --- |
| 1. Real multi-entry upload | Actual generated image and generated multi-page PDF pass; representative family document not yet evaluated |
| 2. Separate care events | Verified on printed synthetic rows and parser edge cases; messy handwriting not accepted |
| 3. Editable review | Actual browser corrected a recognized value and saved a draft |
| 4. Mark ambiguity | Parser/validation/UI tests cover missing dates, clocks, quantities and DST; representative handwriting remains necessary |
| 5. Accurate approved save | Actual browser and transactional DB tests verify exact values and UTC times |
| 6. Safe duplicate handling | Same-source, transformed-rescan, explicit keep/skip, exact retry and concurrency tests pass |
| 7. Original available | Authenticated encrypted source preview/download and retention implemented; cleanup tested; Docker source bytes and two encrypted files across rollback verified |
| 8. Automated tests | Parsing, validation, correction, native intake, transactional import and browser checks pass locally and in hosted acceptance CI |
| 9. Existing tracking unaffected | Full inherited regression suite and synthetic Docker qualification pass; original image reads unchanged synthetic records after rollback; production remains healthy on its existing image |
| 10. CI and independent review | Scoped independent review complete; exact-head and post-merge hosted acceptance runs passed |

## Explicit limitations

- Tesseract is a printed-text baseline; no handwriting accuracy percentage is
  claimed. No source records leave the server for recognition.
- The Linux container is required for native resource limits and recognition.
- English OCR is the configured model. Hindi UI keys satisfy the existing
  translation gate; native-speaker localization review is still pending. Other
  newly added language keys use Sprout's existing English fallback behavior.
- Finalization locks the whole document, including unchecked rows. Incremental
  completion and import undo remain open follow-ups, with clear finalization
  warnings in this slice.
- Consolidation with the [parallel browser-local OCR work] remains open. Its
  separate implementation and upstream changes are not included in this
  Sprout 1.6.7 acceptance evidence.
- Synthetic Chromium viewport tests do not prove Safari, physical camera upload,
  offline import, medical accuracy, or a restored production deployment.
- The October 7 archive is historical evidence. It does not satisfy the fresh
  production backup gate or demonstrate full application startup after restoring
  a current production snapshot.
- No overall project completion percentage is inferred from these test counts.

See [staging and release gates](STAGING.md) and [OCR engine evaluation](OCR_ENGINES.md).

[PR #2]: https://github.com/MulattoTech/BabyTracker-App/pull/2
[merged commit]: https://github.com/MulattoTech/BabyTracker-App/commit/83326cfe964926b49b3bc487679cb9aa10170e8c
[exact-head acceptance CI]: https://github.com/MulattoTech/BabyTracker-App/actions/runs/40456178992
[post-merge main CI]: https://github.com/MulattoTech/BabyTracker-App/actions/runs/40457271546
[rollback evidence]: https://github.com/MulattoTech/BabyTracker/blob/3490b1d59c46544c2d83acc1555b428017949892/docs/babytracker-ocr-rollback.md
[parallel browser-local OCR work]: https://github.com/MulattoTech/BabyTracker-App/pull/1
[#11]: https://github.com/MulattoTech/BabyTracker/issues/11
[#12]: https://github.com/MulattoTech/BabyTracker/issues/12
[#25]: https://github.com/MulattoTech/BabyTracker/issues/25
[#29]: https://github.com/MulattoTech/BabyTracker/issues/29
[#30]: https://github.com/MulattoTech/BabyTracker/issues/30
[#37]: https://github.com/MulattoTech/BabyTracker/issues/37
[#38]: https://github.com/MulattoTech/BabyTracker/issues/38
