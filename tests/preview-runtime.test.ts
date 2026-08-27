import {describe, expect, it, vi} from 'vitest';
import {
  createPreviewOperationQueue,
  createPreviewProtocolController,
  createPreviewProtocolSession,
  negotiatePreviewCapabilities,
  negotiatePreviewProtocolVersion,
  normalizePreviewCapabilities,
  readPreviewProtocolMessage,
  resolveReloadAnchor,
  validatePreviewRevision,
  validatePreviewSessionId
} from '../src/index.js';

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
