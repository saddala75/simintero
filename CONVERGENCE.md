# Platform convergence — authoritative tree & canonical model

`simintero` is the **single authoritative monorepo** for the Simintero payer
platform and all four products (Enstellar, Digicore, Revital, Qualitron).

## Enstellar lives here
The Enstellar product's live code is `services/enstellar-*`:
- `enstellar-interop` — Java FHIR PAS / X12 interop
- `enstellar-workflow` — Python workflow-engine (UM lifecycle, event plane)
- `enstellar-portal-bff` / `enstellar-portal` — reviewer BFF + UI
- `enstellar-connectors` — Python integration connectors

These are the converged copies, built and run by `docker-compose.yml`.

## Canonical model
`@sim/contracts` (`contracts/`) is the canonical event/domain model (incl. the
generated `canonical_model`). The former `@enstellar/canonical-model` is retired.

## The old standalone Enstellar repo is archived
The separate `../Enstellar/` git repo (a sibling directory, its own GitHub remote)
is **archived** — see its `ARCHIVED.md` and the `archived-pre-convergence` tag.
Do not develop there; it is not built, tested, or deployed.

## Historical planning docs
`docs/enstellar/` holds the original (2026-06-05) Enstellar build plans, written
against the now-archived external layout. They are historical only (stale paths);
current planning lives in `docs/superpowers/`.

The `check-no-legacy-contracts.sh` guard enforces this: the parallel Enstellar
seam + reviewer console are retired (C3a), the TS Enstellar twin is deleted (C3b),
and no live code references the archived external tree / `@enstellar/` packages (C5).
