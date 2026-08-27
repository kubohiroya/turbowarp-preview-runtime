import {describe, expect, it, vi} from 'vitest';
import {createPreviewProtocolSession, resolveReloadAnchor} from '../src/index.js';

function liveReloadSession() {
  return {
    staged: [] as unknown[],
    committed: 0,
    discarded: 0,
    stage(result: unknown) {
      this.staged.push(result);
      return {ok: true};
    },
    commit() {
      this.committed += 1;
      return {committed: true};
    },
    discardCandidate() {
      this.discarded += 1;
    },
    getState() {
      return {generation: 1, current: {sourceId: 'current', integrity: 'sha256:abc'}};
    },
    whenIdle: vi.fn(async () => undefined)
  };
}

describe('createPreviewProtocolSession', () => {
  it('negotiates capabilities and stages revisions', async () => {
    const liveReload = liveReloadSession();
    const session = createPreviewProtocolSession({
      liveReloadSession: liveReload,
      requiredCapabilities: ['source.stage.v1', 'source.commit.v1'],
      optionalCapabilities: ['source.defer.v1']
    });

    await expect(
      session.handshake({
        type: 'preview.handshake',
        protocolVersion: {major: 1, minor: 0},
        sessionId: 'dev',
        capabilities: ['source.stage.v1', 'source.commit.v1', 'extra.v1']
      })
    ).resolves.toMatchObject({
      type: 'preview.handshake.ack',
      sessionId: 'dev',
      capabilities: ['source.commit.v1', 'source.stage.v1']
    });

    await expect(
      session.stage({
        type: 'preview.source.stage',
        sessionId: 'dev',
        revision: 1,
        result: {ok: true}
      })
    ).resolves.toMatchObject({type: 'preview.source.stage.ack', revision: 1});
    expect(liveReload.staged).toEqual([{ok: true}]);
  });

  it('rejects stale revisions and missing capabilities', async () => {
    const session = createPreviewProtocolSession({
      liveReloadSession: liveReloadSession(),
      requiredCapabilities: ['source.stage.v1']
    });

    await expect(
      session.handshake({
        type: 'preview.handshake',
        protocolVersion: {major: 1, minor: 0},
        sessionId: 'dev',
        capabilities: []
      })
    ).rejects.toMatchObject({code: 'TWRP-PROTOCOL-CAPABILITY'});
  });
});

describe('resolveReloadAnchor', () => {
  it('falls back from unsafe action to scene', () => {
    expect(
      resolveReloadAnchor({
        requestedPreference: 'action',
        availability: {
          story: {available: true, reason: null},
          scene: {available: true, reason: null},
          action: {available: true, reason: null, replaySafe: false}
        }
      })
    ).toEqual({
      requestedPreference: 'action',
      actualAnchor: 'scene',
      fallbackReason: 'The current action is not replay-safe.'
    });
  });
});
