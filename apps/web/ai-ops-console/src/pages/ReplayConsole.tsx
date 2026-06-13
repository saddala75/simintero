import { useState } from 'react';
import { WorkflowSearch } from '../components/WorkflowSearch.js';
import { ActivityTimeline } from '../components/ActivityTimeline.js';
import { DlqInspector } from '../components/DlqInspector.js';

interface WorkflowResult {
  workflowId: string;
  status: string;
  activities: Array<{ name: string; status: string; startedAt: string }>;
}

export function ReplayConsole() {
  const [workflow, setWorkflow] = useState<WorkflowResult | null>(null);

  return (
    <div className="replay-console">
      <h2>Workflow Replay Console</h2>
      <p className="replay-console__note">
        Read-only view. Search by case ID or correlation ID to inspect workflow history and activity status.
      </p>
      <WorkflowSearch onResult={setWorkflow} />
      {workflow && (
        <div className="replay-console__result">
          <h3>
            {workflow.workflowId}
            <span className={`badge badge--${workflow.status.toLowerCase()}`}>{workflow.status}</span>
          </h3>
          <ActivityTimeline activities={workflow.activities} />
        </div>
      )}
      <hr />
      <h3>Dead Letter Queue</h3>
      <DlqInspector />
    </div>
  );
}
