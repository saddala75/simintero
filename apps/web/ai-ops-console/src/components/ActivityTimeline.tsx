interface Activity {
  name: string;
  status: string;
  startedAt: string;
}

interface ActivityTimelineProps {
  activities: Activity[];
}

const STATUS_CLASS: Record<string, string> = {
  COMPLETED: 'activity--completed',
  FAILED: 'activity--failed',
  RUNNING: 'activity--running',
  SCHEDULED: 'activity--scheduled',
};

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  return (
    <ol className="activity-timeline" aria-label="Workflow activity timeline">
      {activities.map((activity) => (
        <li
          key={activity.name}
          className={`activity ${STATUS_CLASS[activity.status] ?? 'activity--unknown'}`}
          data-status={activity.status}
        >
          <span className="activity__name">{activity.name}</span>
          <span className="activity__status">{activity.status}</span>
          <time className="activity__time" dateTime={activity.startedAt}>
            {new Date(activity.startedAt).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
