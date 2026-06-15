# Security Suppression Guide

`make scan` runs five tool classes. Each has its own suppression mechanism.
All suppressions require a **justification** and an **expiry date**.

## Semgrep (SAST)

Add `# nosemgrep: <rule-id>  # justification — expires YYYY-MM-DD` on the line with the finding.

```python
password = os.getenv("DB_PASSWORD")  # nosemgrep: python.lang.security.audit.hardcoded-password  # env-only, no hardcoded value — expires 2027-01-01
```

## gitleaks (secrets)

Add a path pattern to `.gitleaks.toml`'s `[allowlist]` block:

```toml
[allowlist]
  paths = [
    '''^path/to/false-positive-file$''',
  ]
```

Rotate any live secret before adding it to the allowlist. Re-run `gitleaks detect --report-path .gitleaks-baseline.json --no-git` to update the baseline.

## pip-audit (Python dependencies)

Add to `pip-audit-ignore.txt`:

```
# PYSEC-2024-12345: CVE description — justification — expires 2027-01-01
PYSEC-2024-12345
```

## Trivy (container images)

Add to `.trivyignore`:

```
# CVE-2024-12345: CVE description — justification — expires 2027-01-01
CVE-2024-12345
```

## OWASP Dependency Check (JVM)

Add to `services/interop/dependency-check-suppress.xml`:

```xml
<suppress until="2027-01-01">
    <notes>CVE-XXXX-NNNNN: justification</notes>
    <cve>CVE-XXXX-NNNNN</cve>
</suppress>
```

## Expiry discipline

Suppressions without expiry dates are **not accepted**. Review suppressions before their expiry date. Expired suppressions that are still needed must be renewed with a new justification.
