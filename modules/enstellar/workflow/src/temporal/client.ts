/**
 * Temporal client factory.
 * Creates a Client connected to the Temporal server at `address`
 * (defaults to TEMPORAL_ADDRESS env var, then localhost:7233).
 */
import { Client, Connection } from '@temporalio/client';

export async function createTemporalClient(address?: string): Promise<Client> {
  const connection = await Connection.connect({
    address: address ?? process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });
  return new Client({ connection });
}
