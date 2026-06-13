interface Check {
  label: string;
  passing: boolean;
}

interface Props {
  checks: Check[];
}

export function ReadinessChecks({ checks }: Props) {
  return (
    <ul aria-label="Readiness checks">
      {checks.map((check) => (
        <li key={check.label} data-passing={check.passing}>
          <span aria-hidden="true">{check.passing ? '✓' : '✗'}</span>{' '}
          {check.label}
        </li>
      ))}
    </ul>
  );
}
