export type Subscription = { tier?: string; expiresAt?: number } | null | undefined;

export function activeSubscriptionTier(subscription: Subscription, now = Date.now()): string | undefined {
  return subscription && typeof subscription.expiresAt === 'number' && subscription.expiresAt > now
    ? subscription.tier
    : undefined;
}

export function maxUploadBytes(tier?: string): number {
  const megabytes = tier === 'lion' ? 100 : tier === 'leopard' ? 75 : tier === 'cheetah' ? 50 : 20;
  return megabytes * 1024 * 1024;
}

export function maxUploadMegabytes(tier?: string): number {
  return maxUploadBytes(tier) / (1024 * 1024);
}
