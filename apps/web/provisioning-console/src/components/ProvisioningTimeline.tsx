interface Props {
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const STEPS = ['pending', 'running', 'completed'] as const;

export function ProvisioningTimeline({ status }: Props) {
  const failed = status === 'failed';

  return (
    <ol aria-label="Provisioning timeline">
      {STEPS.map((s) => {
        const isActive = s === status;
        const isDone =
          !failed &&
          STEPS.indexOf(s) < STEPS.indexOf(status as (typeof STEPS)[number]);

        return (
          <li
            key={s}
            aria-current={isActive ? 'step' : undefined}
            data-done={isDone || undefined}
            data-active={isActive || undefined}
          >
            {s}
          </li>
        );
      })}
      {failed && (
        <li data-failed="true" aria-label="failed">
          failed
        </li>
      )}
    </ol>
  );
}
