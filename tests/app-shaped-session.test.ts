import {describe, expect, it} from 'vitest';
import {
  createPreviewProtocolController,
  PreviewProtocolError,
  previewProtocolErrorCode
} from '../src/index.js';

/**
 * An app whose wire protocol carries candidate ids, restart choices, source integrity, and its own
 * ack payloads cannot use the source lifecycle adapter. This fixture is that app, reduced to the
 * shape tm-kamishibai's DSL 4.0 preview protocol uses, and exists to prove the controller is
 * sufficient for it without any of the app's semantics living in this package.
 */
const APP_PREFIX = 'K4';
const RESTART_CHOICES = new Set(['storyStart', 'currentScene', 'currentAction']);

function appFail(suffix: Parameters<typeof previewProtocolErrorCode>[0], message: string): never {
  throw new PreviewProtocolError(previewProtocolErrorCode(suffix, APP_PREFIX), message);
}

function appLiveReload() {
  let candidateId = 0;
  let generation = 0;
  const gates: Array<() => void> = [];
  return {
    committed: [] as Array<{candidateId: number; choice: string}>,
    deferred: [] as number[],
    discarded: 0,
    blockNextStage: false,
    releaseStage() {
      gates.shift()?.();
    },
    async stage(result: unknown) {
      if (this.blockNextStage) {
        this.blockNextStage = false;
        await new Promise<void>((resolve) => gates.push(resolve));
      }
      candidateId += 1;
      return {
        status: 'candidate',
        candidate: {id: candidateId, plan: {options: {anchor: 'scene'}}},
        diagnostics: [],
        generation,
        current: {sourceId: 'main', integrity: (result as {integrity: string}).integrity}
      };
    },
    defer(id: number) {
      this.deferred.push(id);
      return {status: 'idle', generation, current: {sourceId: 'main', integrity: 'sha256-current'}};
    },
    commit(id: number, choice: string) {
      generation += 1;
      this.committed.push({candidateId: id, choice});
      return {status: 'idle', generation, current: {sourceId: 'main', integrity: 'sha256-committed'}};
    },
    discardCandidate() {
      this.discarded += 1;
      return this.getState();
    },
    getState() {
      return {generation, current: {sourceId: 'main', integrity: 'sha256-current'}};
    },
    whenIdle: async () => undefined
  };
}

function summary(state: {generation: number; current: {sourceId: string; integrity: string}}) {
  return Object.freeze({
    generation: state.generation,
    sourceId: state.current.sourceId,
    integrity: state.current.integrity
  });
}

function createAppSession(liveReload: ReturnType<typeof appLiveReload>) {
  const controller = createPreviewProtocolController({
    errorCodePrefix: APP_PREFIX,
    requiredCapabilities: ['diagnostics.v1', 'restart.choice.v1', 'source.commit.v1', 'source.stage.v1'],
    optionalCapabilities: ['source.defer.v1'],
    getState: () => summary(liveReload.getState()),
    onDisconnect: async () => {
      liveReload.discardCandidate();
    }
  });

  function sourceIntegrity(result: unknown) {
    if (typeof result !== 'object' || result === null || !('integrity' in result)) {
      appFail('SCHEMA', 'result must be a source frontend result');
    }
    return (result as {integrity: string}).integrity;
  }

  return {
    controller,
    handshake: (input: unknown) => controller.handshake(input),
    stage(input: unknown) {
      const begun = controller.enqueue(() => {
        const request = controller.readMessage(input, 'preview.source.stage', [
          'sessionId',
          'revision',
          'result'
        ]);
        const active = controller.acceptRevision(request['sessionId'], request['revision']);
        return {
          active,
          integrity: sourceIntegrity(request['result']),
          staged: liveReload.stage(request['result'])
        };
      });

      const completion = begun.then(async ({active, integrity, staged}) => {
        const state = await staged;
        return controller.enqueue(() => {
          // Rejects a connection replaced while this revision was still quiescing.
          const current = controller.requireConnection(active.sessionId, active.connectionId);
          if (current.latestRevision !== active.revision) {
            appFail('REVISION', 'Preview source revision was replaced');
          }
          const bound = controller.acceptCandidate(active.sessionId, {
            id: state.candidate.id,
            revision: active.revision
          });
          return Object.freeze({
            type: 'preview.source.staged',
            sessionId: active.sessionId,
            revision: active.revision,
            sourceIntegrity: integrity,
            status: state.status,
            candidate: {id: state.candidate.id, options: state.candidate.plan.options},
            current: summary(state),
            diagnostics: state.diagnostics,
            connectionCandidate: bound.candidate
          });
        });
      });
      return controller.track(completion);
    },
    defer(input: unknown) {
      return controller.enqueue(() => {
        const request = controller.readMessage(input, 'preview.source.defer', [
          'sessionId',
          'revision',
          'candidateId'
        ]);
        const active = controller.requireCapability(request['sessionId'], 'source.defer.v1');
        const candidate = controller.requireCandidate(
          active.sessionId,
          request['revision'],
          request['candidateId']
        );
        const state = liveReload.defer(candidate.id);
        controller.clearCandidate(active.sessionId);
        return Object.freeze({
          type: 'preview.source.deferred',
          sessionId: active.sessionId,
          candidateId: candidate.id,
          status: state.status,
          current: summary(state)
        });
      });
    },
    commit(input: unknown) {
      return controller.enqueue(() => {
        const request = controller.readMessage(input, 'preview.source.commit', [
          'sessionId',
          'revision',
          'candidateId',
          'choice'
        ]);
        const active = controller.requireConnection(request['sessionId']);
        const candidate = controller.requireCandidate(
          active.sessionId,
          request['revision'],
          request['candidateId']
        );
        if (typeof request['choice'] !== 'string' || !RESTART_CHOICES.has(request['choice'])) {
          appFail('SCHEMA', 'Unknown live reload restart choice');
        }
        const state = liveReload.commit(candidate.id, request['choice']);
        controller.clearCandidate(active.sessionId);
        return Object.freeze({
          type: 'preview.source.committed',
          sessionId: active.sessionId,
          candidateId: candidate.id,
          choice: request['choice'],
          status: state.status,
          current: summary(state)
        });
      });
    },
    disconnect: (input: unknown) => controller.disconnect(input),
    whenIdle: () => controller.whenIdle()
  };
}

function hello(sessionId: string, capabilities: readonly string[]) {
  return {
    type: 'preview.handshake',
    protocolVersion: {major: 1, minor: 0},
    sessionId,
    capabilities: [...capabilities]
  };
}

const ALL_CAPABILITIES = [
  'diagnostics.v1',
  'restart.choice.v1',
  'source.commit.v1',
  'source.defer.v1',
  'source.stage.v1'
];

describe('an app-shaped session built on the controller', () => {
  it('carries app payloads, candidate ids, and restart choices under the app diagnostic prefix', async () => {
    const liveReload = appLiveReload();
    const session = createAppSession(liveReload);
    await session.handshake(hello('client-a', ALL_CAPABILITIES));

    const staged = await session.stage({
      type: 'preview.source.stage',
      sessionId: 'client-a',
      revision: 1,
      result: {integrity: 'sha256-first'}
    });
    expect(staged).toMatchObject({
      type: 'preview.source.staged',
      revision: 1,
      sourceIntegrity: 'sha256-first',
      candidate: {id: 1, options: {anchor: 'scene'}},
      connectionCandidate: {id: 1, revision: 1}
    });

    await expect(
      session.commit({
        type: 'preview.source.commit',
        sessionId: 'client-a',
        revision: 1,
        candidateId: 2,
        choice: 'storyStart'
      })
    ).rejects.toMatchObject({code: 'K4-PROTOCOL-CANDIDATE'});

    await expect(
      session.commit({
        type: 'preview.source.commit',
        sessionId: 'client-a',
        revision: 1,
        candidateId: 1,
        choice: 'somewhereElse'
      })
    ).rejects.toMatchObject({code: 'K4-PROTOCOL-SCHEMA'});

    await expect(
      session.commit({
        type: 'preview.source.commit',
        sessionId: 'client-a',
        revision: 1,
        candidateId: 1,
        choice: 'currentScene'
      })
    ).resolves.toMatchObject({type: 'preview.source.committed', choice: 'currentScene', candidateId: 1});
    expect(liveReload.committed).toEqual([{candidateId: 1, choice: 'currentScene'}]);

    // The candidate is consumed, so a repeat commit is rejected rather than applied twice.
    await expect(
      session.commit({
        type: 'preview.source.commit',
        sessionId: 'client-a',
        revision: 1,
        candidateId: 1,
        choice: 'currentScene'
      })
    ).rejects.toMatchObject({code: 'K4-PROTOCOL-CANDIDATE'});
  });

  it('gates defer on the negotiated capability', async () => {
    const liveReload = appLiveReload();
    const session = createAppSession(liveReload);
    await session.handshake(hello('client-a', ALL_CAPABILITIES.filter((item) => item !== 'source.defer.v1')));
    await session.stage({
      type: 'preview.source.stage',
      sessionId: 'client-a',
      revision: 1,
      result: {integrity: 'sha256-first'}
    });

    await expect(
      session.defer({
        type: 'preview.source.defer',
        sessionId: 'client-a',
        revision: 1,
        candidateId: 1
      })
    ).rejects.toMatchObject({code: 'K4-PROTOCOL-CAPABILITY'});
    expect(liveReload.deferred).toEqual([]);
  });

  it('rejects a revision replaced while the previous one is still quiescing, and whenIdle waits for it', async () => {
    const liveReload = appLiveReload();
    const session = createAppSession(liveReload);
    await session.handshake(hello('client-a', ALL_CAPABILITIES));

    liveReload.blockNextStage = true;
    const first = session.stage({
      type: 'preview.source.stage',
      sessionId: 'client-a',
      revision: 1,
      result: {integrity: 'sha256-first'}
    });
    const firstSettled = first.then(
      () => 'resolved',
      (error: PreviewProtocolError) => error.code
    );

    const second = await session.stage({
      type: 'preview.source.stage',
      sessionId: 'client-a',
      revision: 2,
      result: {integrity: 'sha256-second'}
    });
    expect(second).toMatchObject({revision: 2, sourceIntegrity: 'sha256-second'});

    liveReload.releaseStage();
    await expect(firstSettled).resolves.toBe('K4-PROTOCOL-REVISION');
    await expect(session.whenIdle()).resolves.toBeUndefined();
  });

  it('discards the candidate on disconnect and tolerates a repeated disconnect', async () => {
    const liveReload = appLiveReload();
    const session = createAppSession(liveReload);
    await session.handshake(hello('client-a', ALL_CAPABILITIES));
    await session.stage({
      type: 'preview.source.stage',
      sessionId: 'client-a',
      revision: 1,
      result: {integrity: 'sha256-first'}
    });

    await session.disconnect({type: 'preview.disconnect', sessionId: 'client-a'});
    expect(liveReload.discarded).toBe(1);
    await expect(
      session.disconnect({type: 'preview.disconnect', sessionId: 'client-a'})
    ).resolves.toMatchObject({sessionId: 'client-a'});
    expect(liveReload.discarded).toBe(1);
  });
});
