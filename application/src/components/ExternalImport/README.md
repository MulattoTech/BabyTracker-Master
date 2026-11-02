# ExternalImport

Family-scoped external-platform import flow.

The component currently supports Baby Buddy CSV exports and guides family administrators through:

1. selecting CSV files;
2. previewing detected records and warnings;
3. configuring child destination, source timezone and source units;
4. reviewing the planned import;
5. executing the import and viewing created/already-imported counts.

External imports are additive. The importer does not use database restore endpoints and does not modify or delete existing Sprout Track records.

## Skipped files, activity-only children, and medication imports

- Files that don't match a supported Baby Buddy export are skipped rather than aborting the whole import. The Configure step surfaces a "Files that will be skipped" warning listing each skipped file and its reason; if none of the uploaded files are usable, the preview step blocks progression with an error instead.
- Children that only appear in activity files (no accompanying Child export) are still listed for mapping, but can only be added to an existing baby — the destination defaults to "existing" and the new-baby option is not offered for them. If no existing babies are available yet, the card prompts the user to create one first or include the Child export file.
- Medication entries with a recorded amount import as medicine logs, including an explicitly recorded zero. Entries without an amount are preserved as clearly labelled notes with an unknown dose, original timestamp, name, source unit/interval/notes and medication provenance. The `medication-dosage-missing` warning explains this before import. These notes do not contribute invented numeric doses to medicine reports. Reimporting the same source event remains idempotent, including events previously imported by older versions; this change does not rewrite existing history. A later corrected source dose needs explicit reconciliation rather than an automatic second record.
- When two or more imported children are mapped to the same existing baby, the Configure and Review steps show a non-blocking "Same destination selected for multiple children" warning (their records would be combined under one baby). Deliberate merging remains possible.
