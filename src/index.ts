export interface PreviewProtocolVersion {
  major: number;
  minor: number;
}

export interface PreviewProtocolMessage {
  type: string;
  [key: string]: unknown;
}

export interface PreviewLiveReloadState {
  disposed?: boolean;
  generation?: number;
  current?: {
    sourceId?: string | null;
    integrity?: string | null;
  } | null;
}

export interface PreviewLiveReloadSession {
  stage(result: unknown): unknown | Promise<unknown>;
  defer?(): unknown | Promise<unknown>;
  commit(options?: Record<string, unknown>): unknown | Promise<unknown>;
  discardCandidate(): unknown | Promise<unknown>;
  getState(): PreviewLiveReloadState;
  whenIdle(): Promise<unknown>;
}

export interface PreviewProtocolSessionOptions {
  liveReloadSession: PreviewLiveReloadSession;
  requiredCapabilities: readonly string[];
  optionalCapabilities?: readonly string[];
  runtimeCapabilities?: readonly string[];
  protocolVersion?: PreviewProtocolVersion;
}

export interface PreviewProtocolSession {
  handshake(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  stage(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  defer(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  commit(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  disconnect(input: unknown): Promise<Readonly<Record<string, unknown>>>;
}

export interface ReloadAnchorAvailability {
  available: boolean;
  reason: string | null;
}

export interface ReloadAvailability {
  story: ReloadAnchorAvailability;
  scene: ReloadAnchorAvailability;
  action: ReloadAnchorAvailability & {replaySafe: boolean};
}

export type ReloadPreference = 'story' | 'scene' | 'action';

const defaultProtocolVersion = Object.freeze({major: 1, minor: 0});
const messageTypes = Object.freeze({
  handshake: 'preview.handshake',
  stage: 'preview.source.stage',
  defer: 'preview.source.defer',
  commit: 'preview.source.commit',
  disconnect: 'preview.disconnect'
});
const capabilityPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

export class PreviewProtocolError extends TypeError {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PreviewProtocolError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PreviewProtocolError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolMessage(value: unknown, expectedType: string): Record<string, unknown> {
  if (!isRecord(value)) fail('TWRP-PROTOCOL-SCHEMA', 'Protocol message must be an object.');
  if (value['type'] !== expectedType) {
    fail('TWRP-PROTOCOL-SCHEMA', `Expected protocol message type ${expectedType}.`);
  }
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail('TWRP-PROTOCOL-SCHEMA', `Unknown protocol key: ${key}`);
  }
}

function sessionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    fail('TWRP-PROTOCOL-SESSION', 'sessionId must be 1-128 URL-safe characters.');
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail('TWRP-PROTOCOL-SCHEMA', `${name} must be a positive safe integer.`);
  }
  return Number(value);
}

function protocolVersion(value: unknown): PreviewProtocolVersion {
  if (!isRecord(value)) fail('TWRP-PROTOCOL-SCHEMA', 'protocolVersion must be an object.');
  rejectUnknownKeys(value, new Set(['major', 'minor']));
  if (!Number.isSafeInteger(value['major']) || Number(value['major']) < 0) {
    fail('TWRP-PROTOCOL-SCHEMA', 'protocolVersion.major must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(value['minor']) || Number(value['minor']) < 0) {
    fail('TWRP-PROTOCOL-SCHEMA', 'protocolVersion.minor must be a non-negative integer.');
  }
  return {major: Number(value['major']), minor: Number(value['minor'])};
}

export function normalizeCapabilities(value: unknown, name = 'capabilities'): readonly string[] {
  if (!Array.isArray(value)) fail('TWRP-PROTOCOL-SCHEMA', `${name} must be an array.`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !capabilityPattern.test(item)) {
      fail('TWRP-PROTOCOL-SCHEMA', `${name} contains an invalid capability.`);
    }
    if (seen.has(item)) fail('TWRP-PROTOCOL-SCHEMA', `${name} contains a duplicate.`);
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result.sort());
}

function currentSummary(state: PreviewLiveReloadState): Readonly<Record<string, unknown>> {
  return Object.freeze({
    generation: state.generation,
    sourceId: state.current?.sourceId ?? null,
    integrity: state.current?.integrity ?? null
  });
}

export function createPreviewProtocolSession(options: PreviewProtocolSessionOptions): PreviewProtocolSession {
  if (!isRecord(options)) throw new TypeError('Preview protocol options must be an object.');
  const liveReload = options.liveReloadSession;
  if (
    !isRecord(liveReload) ||
    typeof liveReload.stage !== 'function' ||
    typeof liveReload.commit !== 'function' ||
    typeof liveReload.discardCandidate !== 'function' ||
    typeof liveReload.getState !== 'function' ||
    typeof liveReload.whenIdle !== 'function'
  ) {
    throw new TypeError('liveReloadSession does not implement the preview protocol port.');
  }
  const version = options.protocolVersion ?? defaultProtocolVersion;
  const required = normalizeCapabilities(options.requiredCapabilities, 'requiredCapabilities');
  const optional = normalizeCapabilities(options.optionalCapabilities ?? [], 'optionalCapabilities');
  const runtime = normalizeCapabilities(options.runtimeCapabilities ?? [], 'runtimeCapabilities');
  const availableCapabilities = Object.freeze([...new Set([...required, ...optional, ...runtime])].sort());
  let connection:
    | {
        sessionId: string;
        latestRevision: number;
        capabilities: ReadonlySet<string>;
      }
    | null = null;
  let operationQueue = Promise.resolve<unknown>(undefined);

  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = operationQueue.then(operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  function requireConnection(requestedSessionId: string) {
    if (!connection) fail('TWRP-PROTOCOL-DISCONNECTED', 'Preview session is disconnected.');
    if (connection.sessionId !== requestedSessionId) {
      fail('TWRP-PROTOCOL-SESSION', 'Protocol message belongs to a stale session.');
    }
    return connection;
  }

  return Object.freeze({
    handshake(input: unknown) {
      return enqueue(async () => {
        const hello = protocolMessage(input, messageTypes.handshake);
        rejectUnknownKeys(hello, new Set(['type', 'protocolVersion', 'sessionId', 'capabilities']));
        const requestedVersion = protocolVersion(hello['protocolVersion']);
        if (requestedVersion.major !== version.major) {
          fail('TWRP-PROTOCOL-VERSION', `Unsupported preview protocol major version: ${requestedVersion.major}.`);
        }
        const requestedSessionId = sessionId(hello['sessionId']);
        const requestedCapabilities = normalizeCapabilities(hello['capabilities']);
        const missing = required.filter((capability) => !requestedCapabilities.includes(capability));
        if (missing.length > 0) {
          fail('TWRP-PROTOCOL-CAPABILITY', `Missing required preview capabilities: ${missing.join(', ')}.`);
        }
        if (liveReload.getState().disposed === true) {
          fail('TWRP-PROTOCOL-DISCONNECTED', 'Live reload runtime is disposed.');
        }
        if (connection) await liveReload.discardCandidate();
        const negotiated = requestedCapabilities.filter((capability) =>
          availableCapabilities.includes(capability)
        );
        connection = {
          sessionId: requestedSessionId,
          latestRevision: 0,
          capabilities: new Set(negotiated)
        };
        return Object.freeze({
          type: 'preview.handshake.ack',
          sessionId: requestedSessionId,
          protocolVersion: {
            major: version.major,
            minor: Math.min(requestedVersion.minor, version.minor)
          },
          capabilities: negotiated,
          requiredCapabilities: required,
          current: currentSummary(liveReload.getState())
        });
      });
    },
    stage(input: unknown) {
      return enqueue(async () => {
        const request = protocolMessage(input, messageTypes.stage);
        rejectUnknownKeys(request, new Set(['type', 'sessionId', 'revision', 'result']));
        const active = requireConnection(sessionId(request['sessionId']));
        const revision = positiveInteger(request['revision'], 'revision');
        if (revision <= active.latestRevision) {
          fail('TWRP-PROTOCOL-REVISION', 'Preview source revision is stale.');
        }
        active.latestRevision = revision;
        const result = await liveReload.stage(request['result']);
        return Object.freeze({type: 'preview.source.stage.ack', sessionId: active.sessionId, revision, result});
      });
    },
    defer(input: unknown) {
      return enqueue(async () => {
        const request = protocolMessage(input, messageTypes.defer);
        rejectUnknownKeys(request, new Set(['type', 'sessionId']));
        const active = requireConnection(sessionId(request['sessionId']));
        await liveReload.defer?.();
        return Object.freeze({type: 'preview.source.defer.ack', sessionId: active.sessionId});
      });
    },
    commit(input: unknown) {
      return enqueue(async () => {
        const request = protocolMessage(input, messageTypes.commit);
        rejectUnknownKeys(request, new Set(['type', 'sessionId', 'restart']));
        const active = requireConnection(sessionId(request['sessionId']));
        const result = await liveReload.commit(
          isRecord(request['restart']) ? {restart: request['restart']} : undefined
        );
        return Object.freeze({type: 'preview.source.commit.ack', sessionId: active.sessionId, result});
      });
    },
    disconnect(input: unknown) {
      return enqueue(async () => {
        const request = protocolMessage(input, messageTypes.disconnect);
        rejectUnknownKeys(request, new Set(['type', 'sessionId']));
        requireConnection(sessionId(request['sessionId']));
        await liveReload.discardCandidate();
        connection = null;
        return Object.freeze({type: 'preview.disconnect.ack'});
      });
    }
  });
}

function safeText(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 300 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${name} must be bounded safe text.`);
  }
  return value;
}

function anchorAvailability(value: unknown, name: string): ReloadAnchorAvailability {
  if (!isRecord(value) || typeof value['available'] !== 'boolean') {
    throw new TypeError(`${name} availability is invalid.`);
  }
  const reason = value['reason'];
  if (value['available'] === true && reason !== null) {
    throw new TypeError(`${name}.reason must be null when available.`);
  }
  if (value['available'] === false && reason === null) {
    throw new TypeError(`${name}.reason is required when unavailable.`);
  }
  return Object.freeze({
    available: value['available'],
    reason: reason === null ? null : safeText(reason, `${name}.reason`)
  });
}

function reloadAvailability(value: unknown): ReloadAvailability {
  if (!isRecord(value)) throw new TypeError('reload availability is invalid.');
  const story = anchorAvailability(value['story'], 'availability.story');
  const scene = anchorAvailability(value['scene'], 'availability.scene');
  const actionBase = anchorAvailability(value['action'], 'availability.action');
  const action = value['action'];
  if (!isRecord(action) || typeof action['replaySafe'] !== 'boolean') {
    throw new TypeError('availability.action.replaySafe must be boolean.');
  }
  if (story.available !== true) throw new TypeError('story reload anchor must always be available.');
  return Object.freeze({...value, story, scene, action: {...actionBase, replaySafe: action['replaySafe']}});
}

export function resolveReloadAnchor({
  requestedPreference,
  availability
}: {
  requestedPreference: ReloadPreference;
  availability: unknown;
}) {
  if (!['story', 'scene', 'action'].includes(requestedPreference)) {
    throw new TypeError('requestedPreference must be story, scene, or action.');
  }
  const anchors = reloadAvailability(availability);
  if (requestedPreference === 'story') {
    return Object.freeze({requestedPreference, actualAnchor: 'story', fallbackReason: null});
  }
  if (requestedPreference === 'scene') {
    return anchors.scene.available
      ? Object.freeze({requestedPreference, actualAnchor: 'scene', fallbackReason: null})
      : Object.freeze({requestedPreference, actualAnchor: 'story', fallbackReason: anchors.scene.reason});
  }
  if (anchors.action.available && anchors.action.replaySafe) {
    return Object.freeze({requestedPreference, actualAnchor: 'action', fallbackReason: null});
  }
  const actionReason = anchors.action.available
    ? 'The current action is not replay-safe.'
    : anchors.action.reason;
  return anchors.scene.available
    ? Object.freeze({requestedPreference, actualAnchor: 'scene', fallbackReason: actionReason})
    : Object.freeze({
        requestedPreference,
        actualAnchor: 'story',
        fallbackReason: `${actionReason} ${anchors.scene.reason}`.slice(0, 300)
      });
}
