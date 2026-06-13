export interface NotificationClient {
  emit(event: {
    event_type: string;
    artifact_id: string;
    gate?: string;
    decision?: string;
  }): Promise<void>;
}

export class GovernanceNotifier {
  constructor(private readonly client: NotificationClient) {}

  async notifyApproval(artifactId: string, gate: string, decision: string): Promise<void> {
    await this.client.emit({
      event_type: 'sim.artifact.approval_recorded',
      artifact_id: artifactId,
      gate,
      decision,
    });
  }

  async notifyActivation(artifactId: string): Promise<void> {
    await this.client.emit({
      event_type: 'sim.artifact.activated',
      artifact_id: artifactId,
    });
  }
}
