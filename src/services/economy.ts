import { apiFetch } from './chats';

export type Economy = {
  balance: number;
  subscription?: { tier: string; expiresAt: number };
  frames?: Record<string, number>;
  equippedFrame?: string;
  dailyAt?: number;
  ledger?: Array<{ id: string; kind: string; amount: number; label: string; at: number }>;
};

export async function getEconomy(): Promise<Economy> {
  const response = await apiFetch('/api/economy', { method: 'GET' });
  if (!response.ok) throw new Error('Не удалось загрузить кошелёк.');
  return response.json() as Promise<Economy>;
}

export async function economyAction(action: string, values: Record<string, string> = {}): Promise<Economy> {
  const response = await apiFetch('/api/economy', { method: 'POST', body: JSON.stringify({ action, ...values }) });
  const payload = await response.json() as Economy & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Операция не выполнена.');
  return payload;
}
export async function giftAction(action: 'sell' | 'show', instanceId: string) {
  const response = await apiFetch(`/api/gifts/${action}`, { method: 'POST', body: JSON.stringify({ instanceId }) });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Не удалось изменить подарок.');
}
