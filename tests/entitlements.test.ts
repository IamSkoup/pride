import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeSubscriptionTier, maxUploadMegabytes } from '../src/services/entitlements.ts';

describe('Pride Club entitlements', () => {
  it('only applies an unexpired subscription', () => {
    assert.equal(activeSubscriptionTier({ tier: 'leopard', expiresAt: 2_000 }, 1_000), 'leopard');
    assert.equal(activeSubscriptionTier({ tier: 'lion', expiresAt: 1_000 }, 1_000), undefined);
    assert.equal(activeSubscriptionTier(undefined, 1_000), undefined);
  });

  it('sets progressively larger, bounded upload limits', () => {
    assert.equal(maxUploadMegabytes(undefined), 20);
    assert.equal(maxUploadMegabytes('cheetah'), 50);
    assert.equal(maxUploadMegabytes('leopard'), 75);
    assert.equal(maxUploadMegabytes('lion'), 100);
  });
});
