import {describe, expect, it, vi} from 'vitest';
import {
  createPreviewOperationQueue,
  createPreviewProtocolController,
  createPreviewProtocolSession,
  negotiatePreviewCapabilities,
  negotiatePreviewProtocolVersion,
  normalizePreviewCapabilities,
  normalizePreviewErrorCodePrefix,
  previewProtocolErrorCode,
  readPreviewProtocolMessage,
  resolveReloadAnchor,
  validatePreviewRevision,
  validatePreviewSessionId
} from '../src/index.js';

function hello(sessionId: string, capabilities: readonly string[] = ['transport.v1']) {
  return {
    type: 'preview.handshake',
    protocolVersion: {major: 1, minor: 0},
    sessionId,
    capabilities: [...capabilities]
  };
}

function liveReloadSession() {
  const state = {generation: 1, current: {sourceId: 'current', integrity: 'sha256:abc'}};
  return {
    staged: [] as unknown[],
    committed: [] as Array<Record<string, unknown> | undefined>,
    deferred: 0,
    discarded: 0,
    stage(result: unknown) {
      this.staged.push(result);
      return {ok: true};
    },
    defer() {
      this.deferred += 1;
    },
    commit(options?: Record<string, unknown>) {
      this.committed.push(options);
      return {committed: true};
    },
    discardCandidate() {
      this.discarded += 1;
    },
    getState() {
      return state;
    },
    whenIdle: vi.fn(async () => undefined)
  };
}

describe('validation primitives', () => {
  it('normalizes capabilities and rejects invalid capability sets', () => {
    expect(normalizePreviewCapabilities(['render.patch.v1', 'transport.v1'])).toEqual([
      'render.patch.v1',
      'transport.v1'
    ]);
    expect(
      negotiatePreviewCapabilities({
        requestedCapabilities: ['transport.v1', 'render.patch.v1', 'ignored.v1'],
        requiredCapabilities: ['transport.v1'],
        optionalCapabilities: ['render.patch.v1']
      })
    ).toMatchObject({
      capabilities: ['render.patch.v1', 'transport.v1'],
      requiredCapabilities: ['transport.v1']
    });
    expect(() => normalizePreviewCapabilities(['transport.v1', 'transport.v1'])).toThrow(
      /duplicate/u
    );
    expect(() =>
      negotiatePreviewCapabilities({
        requestedCapabilities: [],
        requiredCapabilities: ['transport.v1']
      })
    ).toThrow(expect.objectContaining({code: 'TWRP-PROTOCOL-CAPABILITY'}));
  });

  it('negotiates protocol versions by major and minor', () => {
    expect(negotiatePreviewProtocolVersion({major: 1, minor: 7}, {major: 1, minor: 3})).toEqual({
      major: 1,
      minor: 3
    });
    expect(() => negotiatePreviewProtocolVersion({major: 2, minor: 0}, {major: 1, minor: 0})).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-VERSION'})
    );
  });

  it('validates session ids, message types, and revision ordering', () => {
    expect(validatePreviewSessionId('dev_01-preview')).toBe('dev_01-preview');
    expect(() => validatePreviewSessionId('bad session')).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-SESSION'})
    );
    expect(readPreviewProtocolMessage({type: 'app.render', sessionId: 'dev'}, 'app.render', ['sessionId'])).toEqual({
      type: 'app.render',
      sessionId: 'dev'
    });
    expect(() => readPreviewProtocolMessage({type: 'app.other'}, 'app.render')).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-SCHEMA'})
    );
    expect(validatePreviewRevision(2, 1)).toBe(2);
    expect(() => validatePreviewRevision(1, 1)).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-REVISION'})
    );
  });
});

describe('createPreviewProtocolController', () => {
  it('owns one connection, rejects stale sessions, and handles disconnect callbacks', async () => {
    const disconnects: string[] = [];
    const controller = createPreviewProtocolController({
      requiredCapabilities: ['transport.v1'],
      optionalCapabilities: ['render.patch.v1'],
      protocolVersion: {major: 1, minor: 2},
      messageTypes: {
        handshake: 'app.hello',
        handshakeAck: 'app.hello.ok',
        disconnect: 'app.bye',
        disconnectAck: 'app.bye.ok'
      },
      getState: () => ({ready: true}),
      onDisconnect(event) {
        disconnects.push(`${event.reason}:${event.connection.sessionId}`);
      }
    });

    await expect(
      controller.handshake({
        type: 'app.hello',
        protocolVersion: {major: 1, minor: 9},
        sessionId: 'first',
        capabilities: ['transport.v1', 'render.patch.v1', 'ignored.v1']
      })
    ).resolves.toMatchObject({
      type: 'app.hello.ok',
      sessionId: 'first',
      protocolVersion: {major: 1, minor: 2},
      capabilities: ['render.patch.v1', 'transport.v1'],
      state: {ready: true}
    });

    expect(controller.currentConnection()?.hasCapability('render.patch.v1')).toBe(true);
    expect(controller.acceptRevision('first', 1)).toMatchObject({sessionId: 'first', revision: 1});
    expect(() => controller.acceptRevision('first', 1)).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-REVISION'})
    );

    await controller.handshake({
      type: 'app.hello',
      protocolVersion: {major: 1, minor: 0},
      sessionId: 'second',
      capabilities: ['transport.v1']
    });
    expect(disconnects).toEqual(['replaced:first']);
    expect(() => controller.requireConnection('first')).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-SESSION'})
    );

    await expect(controller.disconnect({type: 'app.bye', sessionId: 'second'})).resolves.toEqual({
      type: 'app.bye.ok',
      sessionId: 'second'
    });
    expect(disconnects).toEqual(['replaced:first', 'disconnect:second']);
    expect(controller.currentConnection()).toBeNull();
    expect(() => controller.requireConnection('second')).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-DISCONNECTED'})
    );
  });

  it('rejects invalid handshakes before owning a connection', async () => {
    const controller = createPreviewProtocolController({
      requiredCapabilities: ['transport.v1']
    });

    await expect(
      controller.handshake({
        type: 'preview.handshake',
        protocolVersion: {major: 2, minor: 0},
        sessionId: 'dev',
        capabilities: ['transport.v1']
      })
    ).rejects.toMatchObject({code: 'TWRP-PROTOCOL-VERSION'});

    await expect(
      controller.handshake({
        type: 'preview.handshake',
        protocolVersion: {major: 1, minor: 0},
        sessionId: 'bad session',
        capabilities: ['transport.v1']
      })
    ).rejects.toMatchObject({code: 'TWRP-PROTOCOL-SESSION'});

    await expect(
      controller.handshake({
        type: 'preview.handshake',
        protocolVersion: {major: 1, minor: 0},
        sessionId: 'dev',
        capabilities: []
      })
    ).rejects.toMatchObject({code: 'TWRP-PROTOCOL-CAPABILITY'});
  });
});

describe('createPreviewOperationQueue', () => {
  it('serializes operations even when they are enqueued before earlier work resolves', async () => {
    const queue = createPreviewOperationQueue();
    const events: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.enqueue(async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
      return 1;
    });
    const second = queue.enqueue(() => {
      events.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    if (!release) throw new Error('test gate was not initialized');
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
    await expect(queue.whenIdle()).resolves.toBeUndefined();
  });
});

describe('createPreviewProtocolSession', () => {
  it('keeps the existing lifecycle adapter with legacy source summary and restart pass-through', async () => {
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
      capabilities: ['source.commit.v1', 'source.stage.v1'],
      current: {generation: 1}
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

    await expect(
      session.commit({
        type: 'preview.source.commit',
        sessionId: 'dev',
        options: {anchor: 'scene'}
      })
    ).resolves.toMatchObject({type: 'preview.source.commit.ack'});
    expect(liveReload.committed).toEqual([{anchor: 'scene'}]);

    await expect(
      session.commit({
        type: 'preview.source.commit',
        sessionId: 'dev',
        restart: {choice: 'action'}
      })
    ).resolves.toMatchObject({type: 'preview.source.commit.ack'});
    expect(liveReload.committed).toEqual([{anchor: 'scene'}, {restart: {choice: 'action'}}]);

    await expect(session.disconnect({type: 'preview.disconnect', sessionId: 'dev'})).resolves.toEqual({
      type: 'preview.disconnect.ack',
      sessionId: 'dev'
    });
    expect(liveReload.discarded).toBe(1);
  });
});

describe('app diagnostic prefixes', () => {
  it('builds and validates app-specific protocol error codes', () => {
    expect(previewProtocolErrorCode('SCHEMA')).toBe('TWRP-PROTOCOL-SCHEMA');
    expect(previewProtocolErrorCode('CANDIDATE', 'K4')).toBe('K4-PROTOCOL-CANDIDATE');
    expect(normalizePreviewErrorCodePrefix('K4')).toBe('K4');
    expect(() => normalizePreviewErrorCodePrefix('k4')).toThrow(/upper-case/u);
    expect(() => normalizePreviewErrorCodePrefix('')).toThrow(/upper-case/u);
  });

  it('reports every controller rejection under the app prefix', async () => {
    const controller = createPreviewProtocolController({
      errorCodePrefix: 'K4',
      requiredCapabilities: ['transport.v1']
    });

    await expect(controller.handshake(hello('dev', []))).rejects.toMatchObject({
      code: 'K4-PROTOCOL-CAPABILITY'
    });
    await expect(controller.handshake({...hello('dev'), protocolVersion: {major: 9, minor: 0}})).rejects.toMatchObject(
      {code: 'K4-PROTOCOL-VERSION'}
    );
    expect(() => controller.requireConnection('dev')).toThrow(
      expect.objectContaining({code: 'K4-PROTOCOL-DISCONNECTED'})
    );

    await controller.handshake(hello('dev'));
    expect(() => controller.requireCandidate('dev', 1, 1)).toThrow(
      expect.objectContaining({code: 'K4-PROTOCOL-CANDIDATE'})
    );
    expect(() => controller.requireCapability('dev', 'source.defer.v1')).toThrow(
      expect.objectContaining({code: 'K4-PROTOCOL-CAPABILITY'})
    );
  });
});

describe('candidate identity', () => {
  it('binds a candidate to one revision and rejects stale or missing candidates', async () => {
    const controller = createPreviewProtocolController({requiredCapabilities: ['transport.v1']});
    await controller.handshake(hello('dev'));

    controller.acceptRevision('dev', 1);
    expect(controller.currentConnection()?.candidate).toBeNull();
    expect(controller.acceptCandidate('dev', {id: 7, revision: 1}).candidate).toEqual({id: 7, revision: 1});
    expect(controller.requireCandidate('dev', 1, 7)).toEqual({id: 7, revision: 1});

    expect(() => controller.requireCandidate('dev', 1, 8)).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-CANDIDATE'})
    );
    expect(() => controller.requireCandidate('dev', 2, 7)).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-CANDIDATE'})
    );

    // A newer revision supersedes whatever the previous revision staged.
    controller.acceptRevision('dev', 2);
    expect(controller.currentConnection()?.candidate).toBeNull();
    expect(() => controller.requireCandidate('dev', 1, 7)).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-CANDIDATE'})
    );

    controller.acceptCandidate('dev', {id: 8, revision: 2});
    expect(controller.clearCandidate('dev').candidate).toBeNull();
    expect(() => controller.acceptCandidate('dev', {id: 0, revision: 2})).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-SCHEMA'})
    );
  });
});

describe('two-phase operations', () => {
  it('detects a replaced connection and a replaced revision across an await', async () => {
    const controller = createPreviewProtocolController({requiredCapabilities: ['transport.v1']});
    await controller.handshake(hello('dev'));
    const first = controller.acceptRevision('dev', 1);

    // A second revision arrives while the first one is still quiescing.
    controller.acceptRevision('dev', 2);
    expect(controller.requireConnection('dev', first.connectionId).latestRevision).toBe(2);

    await controller.handshake(hello('dev'));
    expect(() => controller.requireConnection('dev', first.connectionId)).toThrow(
      expect.objectContaining({code: 'TWRP-PROTOCOL-SESSION'})
    );
    expect(controller.requireConnection('dev').connectionId).not.toBe(first.connectionId);
  });

  it('waits for tracked out-of-queue work in whenIdle', async () => {
    const controller = createPreviewProtocolController();
    const events: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    controller.track(gate.then(() => events.push('tracked')));
    const idle = controller.whenIdle().then(() => events.push('idle'));

    expect(events).toEqual([]);
    release?.();
    await idle;
    expect(events).toEqual(['tracked', 'idle']);
  });
});

describe('disconnect semantics', () => {
  it('is idempotent for the owning session and still rejects a stale one', async () => {
    const liveReload = liveReloadSession();
    const session = createPreviewProtocolSession({
      liveReloadSession: liveReload,
      requiredCapabilities: ['source.stage.v1']
    });
    await session.handshake({...hello('dev', ['source.stage.v1'])});

    await expect(session.disconnect({type: 'preview.disconnect', sessionId: 'other'})).rejects.toMatchObject({
      code: 'TWRP-PROTOCOL-SESSION'
    });

    await expect(session.disconnect({type: 'preview.disconnect', sessionId: 'dev'})).resolves.toEqual({
      type: 'preview.disconnect.ack',
      sessionId: 'dev'
    });
    expect(liveReload.discarded).toBe(1);

    // Disconnecting again is a no-op rather than an error, so cleanup does not have to know
    // whether a connection is still open.
    await expect(session.disconnect({type: 'preview.disconnect', sessionId: 'dev'})).resolves.toEqual({
      type: 'preview.disconnect.ack',
      sessionId: 'dev'
    });
    expect(liveReload.discarded).toBe(1);
  });
});

describe('session capability gating and state', () => {
  it('gates defer on a negotiated capability and reports quiescent state', async () => {
    const liveReload = liveReloadSession();
    const session = createPreviewProtocolSession({
      liveReloadSession: liveReload,
      requiredCapabilities: ['source.stage.v1'],
      optionalCapabilities: ['source.defer.v1'],
      deferCapability: 'source.defer.v1'
    });

    expect(session.getState()).toMatchObject({connected: false, sessionId: null, latestRevision: 0});

    await session.handshake({...hello('dev', ['source.stage.v1'])});
    await expect(session.defer({type: 'preview.source.defer', sessionId: 'dev'})).rejects.toMatchObject({
      code: 'TWRP-PROTOCOL-CAPABILITY'
    });
    expect(liveReload.deferred).toBe(0);

    await session.handshake({...hello('dev', ['source.stage.v1', 'source.defer.v1'])});
    await expect(session.defer({type: 'preview.source.defer', sessionId: 'dev'})).resolves.toMatchObject({
      type: 'preview.source.defer.ack'
    });
    expect(liveReload.deferred).toBe(1);

    await session.stage({
      type: 'preview.source.stage',
      sessionId: 'dev',
      revision: 4,
      result: {ok: true}
    });
    await expect(session.whenIdle()).resolves.toMatchObject({
      connected: true,
      sessionId: 'dev',
      latestRevision: 4,
      current: {generation: 1}
    });
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
