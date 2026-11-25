import type { Response } from 'express';

export interface SyncEvent {
  type: 'data_changed' | 'notification' | 'connected';
  entity?: string;
  id?: string | number;
  timestamp: string;
}

const clients = new Set<Response>();

export function registerSseClient(res: Response) {
  clients.add(res);
  res.on('close', () => {
    clients.delete(res);
  });
}

export function broadcastSyncEvent(event: Omit<SyncEvent, 'timestamp'>) {
  const payload: SyncEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}
