import { Pool } from 'pg';
import { logger } from '../config/logger';

export interface SystemEvent {
  id?: number;
  event_type: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
  created_at?: Date;
}

type EventListener = (event: SystemEvent) => void;

const listeners = new Set<EventListener>();

export function subscribeToEvents(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLocalEvent(event: SystemEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      logger.error({ err, eventType: event.event_type }, 'Event listener failed');
    }
  }
}

export async function publishEvent(
  pool: Pool,
  eventType: string,
  entityType: string,
  entityId: string | null,
  payload: Record<string, unknown> = {},
): Promise<SystemEvent> {
  const { rows } = await pool.query(
    `INSERT INTO system_events (event_type, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id, event_type, entity_type, entity_id, payload, created_at`,
    [eventType, entityType, entityId, JSON.stringify(payload)]
  );

  const event = rows[0] as SystemEvent;
  emitLocalEvent(event);

  await pool.query('SELECT pg_notify($1, $2)', [
    'scheduler_events',
    JSON.stringify(event),
  ]);

  return event;
}
