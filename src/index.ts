export interface PreviewProtocolVersion {
  major: number;
  minor: number;
}

export interface PreviewProtocolMessage {
  type: string;
  [key: string]: unknown;
}

export type PreviewProtocolErrorSuffix =
  | 'CANDIDATE'
  | 'CAPABILITY'
  | 'DISCONNECTED'
  | 'REVISION'
  | 'SCHEMA'
  | 'SESSION'
  | 'VERSION';

export type PreviewProtocolErrorCode = `${string}-PROTOCOL-${PreviewProtocolErrorSuffix}`;

export interface PreviewCapabilityNegotiationOptions {
  requestedCapabilities: unknown;
  requiredCapabilities?: readonly string[];
  optionalCapabilities?: readonly string[];
  runtimeCapabilities?: readonly string[];
  errorCodePrefix?: string;
}

export interface PreviewCapabilityNegotiation {
  requestedCapabilities: readonly string[];
  requiredCapabilities: readonly string[];
  availableCapabilities: readonly string[];
  capabilities: readonly string[];
}

export interface PreviewControlMessageTypes {
  handshake: string;
  handshakeAck: string;
  disconnect: string;
  disconnectAck: string;
}

export type PreviewDisconnectReason = 'disconnect' | 'replaced';

export interface PreviewCandidate {
  id: number;
  revision: number;
}

export interface PreviewConnectionSnapshot {
  /** Monotonic id for one accepted connection, so an app can detect a replacement across an await. */
  connectionId: number;
  sessionId: string;
  latestRevision: number;
  capabilities: readonly string[];
  candidate: Readonly<PreviewCandidate> | null;
  hasCapability(capability: string): boolean;
}

export interface PreviewDisconnectEvent<TState = unknown> {
  reason: PreviewDisconnectReason;
  connection: PreviewConnectionSnapshot;
  state: TState;
}

export interface PreviewProtocolControllerOptions<TState = unknown> {
  errorCodePrefix?: string;
  requiredCapabilities?: readonly string[];
  optionalCapabilities?: readonly string[];
  runtimeCapabilities?: readonly string[];
  protocolVersion?: PreviewProtocolVersion;
  messageTypes?: Partial<PreviewControlMessageTypes>;
  getState?: () => TState;
  isDisposed?: () => boolean;
  onDisconnect?: (event: PreviewDisconnectEvent<TState>) => unknown | Promise<unknown>;
}

export interface PreviewHandshakeAck<TState = unknown> {
  type: string;
  sessionId: string;
  protocolVersion: PreviewProtocolVersion;
  capabilities: readonly string[];
  requiredCapabilities: readonly string[];
  state: TState;
}

export interface PreviewDisconnectAck {
  type: string;
  sessionId: string;
}

export interface PreviewRevisionAcceptance extends PreviewConnectionSnapshot {
  revision: number;
}

export interface PreviewOperationQueue {
  enqueue<T>(operation: () => T | Promise<T>): Promise<T>;
  /**
   * Register work that settles outside the queue, such as the second phase of a two-phase stage, so
   * `whenIdle` also waits for it.
   */
  track<T>(work: Promise<T>): Promise<T>;
  whenIdle(): Promise<void>;
}

export interface PreviewProtocolController<TState = unknown> extends PreviewOperationQueue {
  messageTypes: Readonly<PreviewControlMessageTypes>;
  errorCodePrefix: string;
  handshake(input: unknown): Promise<Readonly<PreviewHandshakeAck<TState>>>;
  disconnect(input: unknown): Promise<Readonly<PreviewDisconnectAck>>;
  currentConnection(): Readonly<PreviewConnectionSnapshot> | null;
  /**
   * Require the named session. Pass `expectedConnectionId` after an await to reject a connection
   * that was replaced while the operation was in flight.
   */
  requireConnection(sessionId: unknown, expectedConnectionId?: number): Readonly<PreviewConnectionSnapshot>;
  /** Require a capability that was negotiated during the handshake. */
  requireCapability(sessionId: unknown, capability: string): Readonly<PreviewConnectionSnapshot>;
  /** Accept a newer revision. Accepting one discards any candidate the previous revision staged. */
  acceptRevision(sessionId: unknown, revision: unknown, name?: string): Readonly<PreviewRevisionAcceptance>;
  /** Bind a staged candidate to the connection so later defer/commit messages can be validated. */
  acceptCandidate(
    sessionId: unknown,
    candidate: {id: unknown; revision: unknown}
  ): Readonly<PreviewConnectionSnapshot>;
  /** Require the exact candidate a defer or commit message refers to. */
  requireCandidate(sessionId: unknown, revision: unknown, candidateId: unknown): Readonly<PreviewCandidate>;
  /** Drop the pending candidate without ending the connection. */
  clearCandidate(sessionId: unknown): Readonly<PreviewConnectionSnapshot>;
  readMessage(
    input: unknown,
    expectedType: string,
    allowedKeys?: readonly string[]
  ): Readonly<Record<string, unknown>>;
}

export interface PreviewLiveReloadState {
  disposed?: boolean;
  generation?: number;
  [key: string]: unknown;
}

export interface PreviewLiveReloadSession {
  stage(result: unknown): unknown | Promise<unknown>;
  defer?(): unknown | Promise<unknown>;
  commit(options?: Record<string, unknown>): unknown | Promise<unknown>;
  discardCandidate(): unknown | Promise<unknown>;
  getState(): PreviewLiveReloadState;
  whenIdle(): Promise<unknown>;
}

export interface PreviewProtocolSessionMessageTypes extends PreviewControlMessageTypes {
  stage: string;
  stageAck: string;
  defer: string;
  deferAck: string;
  commit: string;
  commitAck: string;
}

export interface PreviewProtocolSessionOptions {
  liveReloadSession: PreviewLiveReloadSession;
  requiredCapabilities: readonly string[];
  optionalCapabilities?: readonly string[];
  runtimeCapabilities?: readonly string[];
  protocolVersion?: PreviewProtocolVersion;
  messageTypes?: Partial<PreviewProtocolSessionMessageTypes>;
  stateSnapshot?: (state: PreviewLiveReloadState) => Readonly<Record<string, unknown>>;
  errorCodePrefix?: string;
  /** Capability that a client must negotiate before `defer` is accepted. */
  deferCapability?: string;
}

export interface PreviewProtocolSessionState {
  connected: boolean;
  sessionId: string | null;
  latestRevision: number;
  candidate: Readonly<PreviewCandidate> | null;
  current: Readonly<Record<string, unknown>>;
}

export interface PreviewProtocolSession {
  handshake(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  stage(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  defer(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  commit(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  disconnect(input: unknown): Promise<Readonly<Record<string, unknown>>>;
  getState(): Readonly<PreviewProtocolSessionState>;
  whenIdle(): Promise<Readonly<PreviewProtocolSessionState>>;
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

export const DEFAULT_PREVIEW_ERROR_CODE_PREFIX = 'TWRP';

export const DEFAULT_PREVIEW_PROTOCOL_VERSION = Object.freeze({major: 1, minor: 0});

export const DEFAULT_PREVIEW_CONTROL_MESSAGE_TYPES = Object.freeze({
  handshake: 'preview.handshake',
  handshakeAck: 'preview.handshake.ack',
  disconnect: 'preview.disconnect',
  disconnectAck: 'preview.disconnect.ack'
});

export const DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES = Object.freeze({
  ...DEFAULT_PREVIEW_CONTROL_MESSAGE_TYPES,
  stage: 'preview.source.stage',
  stageAck: 'preview.source.stage.ack',
  defer: 'preview.source.defer',
  deferAck: 'preview.source.defer.ack',
  commit: 'preview.source.commit',
  commitAck: 'preview.source.commit.ack'
});

const capabilityPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const sessionIdPattern = /^[A-Za-z0-9._-]+$/u;
const errorCodePrefixPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/u;

export class PreviewProtocolError extends TypeError {
  readonly code: PreviewProtocolErrorCode;

  constructor(code: PreviewProtocolErrorCode, message: string) {
    super(message);
    this.name = 'PreviewProtocolError';
    this.code = code;
  }
}

/**
 * Validate an app-specific diagnostic prefix. Apps that already own a diagnostic namespace, such as
 * `K4` in tm-kamishibai, keep reporting their own codes while this package owns the mechanics.
 */
export function normalizePreviewErrorCodePrefix(value: unknown, name = 'errorCodePrefix'): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 16 ||
    !errorCodePrefixPattern.test(value)
  ) {
    throw new TypeError(`${name} must be 1-16 upper-case characters such as TWRP or K4.`);
  }
  return value;
}

/** Build a protocol error code from an app prefix and an app-neutral failure suffix. */
export function previewProtocolErrorCode(
  suffix: PreviewProtocolErrorSuffix,
  errorCodePrefix: string = DEFAULT_PREVIEW_ERROR_CODE_PREFIX
): PreviewProtocolErrorCode {
  return `${normalizePreviewErrorCodePrefix(errorCodePrefix)}-PROTOCOL-${suffix}`;
}

function fail(
  suffix: PreviewProtocolErrorSuffix,
  message: string,
  errorCodePrefix: string = DEFAULT_PREVIEW_ERROR_CODE_PREFIX
): never {
  throw new PreviewProtocolError(previewProtocolErrorCode(suffix, errorCodePrefix), message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionsRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  errorCodePrefix?: string
): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail('SCHEMA', `Unknown protocol key: ${key}`, errorCodePrefix);
  }
}

function safeMessageType(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${name} must be bounded safe text.`);
  }
  return value;
}

function controlMessageTypes(value: unknown): PreviewControlMessageTypes {
  const overrides = value ?? {};
  if (!isRecord(overrides)) throw new TypeError('messageTypes must be an object.');
  return Object.freeze({
    handshake: safeMessageType(overrides['handshake'] ?? DEFAULT_PREVIEW_CONTROL_MESSAGE_TYPES.handshake, 'handshake'),
    handshakeAck: safeMessageType(
      overrides['handshakeAck'] ?? DEFAULT_PREVIEW_CONTROL_MESSAGE_TYPES.handshakeAck,
      'handshakeAck'
    ),
    disconnect: safeMessageType(
      overrides['disconnect'] ?? DEFAULT_PREVIEW_CONTROL_MESSAGE_TYPES.disconnect,
      'disconnect'
    ),
    disconnectAck: safeMessageType(
      overrides['disconnectAck'] ?? DEFAULT_PREVIEW_CONTROL_MESSAGE_TYPES.disconnectAck,
      'disconnectAck'
    )
  });
}

function protocolSessionMessageTypes(value: unknown): PreviewProtocolSessionMessageTypes {
  const overrides = value ?? {};
  if (!isRecord(overrides)) throw new TypeError('messageTypes must be an object.');
  return Object.freeze({
    ...controlMessageTypes(overrides),
    stage: safeMessageType(overrides['stage'] ?? DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES.stage, 'stage'),
    stageAck: safeMessageType(
      overrides['stageAck'] ?? DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES.stageAck,
      'stageAck'
    ),
    defer: safeMessageType(overrides['defer'] ?? DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES.defer, 'defer'),
    deferAck: safeMessageType(
      overrides['deferAck'] ?? DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES.deferAck,
      'deferAck'
    ),
    commit: safeMessageType(overrides['commit'] ?? DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES.commit, 'commit'),
    commitAck: safeMessageType(
      overrides['commitAck'] ?? DEFAULT_PREVIEW_PROTOCOL_SESSION_MESSAGE_TYPES.commitAck,
      'commitAck'
    )
  });
}

function copyRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({...value});
}

/** Validate and freeze a protocol message after checking its type and key set. */
export function readPreviewProtocolMessage(
  value: unknown,
  expectedType: string,
  allowedKeys: readonly string[] = ['type'],
  errorCodePrefix?: string
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail('SCHEMA', 'Protocol message must be an object.', errorCodePrefix);
  const expected = safeMessageType(expectedType, 'expectedType');
  if (value['type'] !== expected) {
    fail('SCHEMA', `Expected protocol message type ${expected}.`, errorCodePrefix);
  }
  rejectUnknownKeys(value, new Set(['type', ...allowedKeys]), errorCodePrefix);
  return copyRecord(value);
}

/** Validate a preview session id that is safe to mirror across local transports. */
export function validatePreviewSessionId(
  value: unknown,
  name = 'sessionId',
  errorCodePrefix?: string
): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !sessionIdPattern.test(value)) {
    fail('SESSION', `${name} must be 1-128 URL-safe characters.`, errorCodePrefix);
  }
  return value;
}

function positiveInteger(value: unknown, name: string, errorCodePrefix?: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail('SCHEMA', `${name} must be a positive safe integer.`, errorCodePrefix);
  }
  return Number(value);
}

/** Validate that a revision is newer than the last accepted revision. */
export function validatePreviewRevision(
  value: unknown,
  latestRevision = 0,
  name = 'revision',
  errorCodePrefix?: string
): number {
  const revision = positiveInteger(value, name, errorCodePrefix);
  if (!Number.isSafeInteger(latestRevision) || latestRevision < 0) {
    throw new TypeError('latestRevision must be a non-negative safe integer.');
  }
  if (revision <= latestRevision) {
    fail('REVISION', 'Preview revision is stale.', errorCodePrefix);
  }
  return revision;
}

/** Validate a protocol version object. */
export function normalizePreviewProtocolVersion(
  value: unknown,
  name = 'protocolVersion',
  errorCodePrefix?: string
): PreviewProtocolVersion {
  if (!isRecord(value)) fail('SCHEMA', `${name} must be an object.`, errorCodePrefix);
  rejectUnknownKeys(value, new Set(['major', 'minor']), errorCodePrefix);
  if (!Number.isSafeInteger(value['major']) || Number(value['major']) < 0) {
    fail('SCHEMA', `${name}.major must be a non-negative integer.`, errorCodePrefix);
  }
  if (!Number.isSafeInteger(value['minor']) || Number(value['minor']) < 0) {
    fail('SCHEMA', `${name}.minor must be a non-negative integer.`, errorCodePrefix);
  }
  return Object.freeze({major: Number(value['major']), minor: Number(value['minor'])});
}

/** Negotiate a compatible protocol version by requiring equal majors and taking the lower minor. */
export function negotiatePreviewProtocolVersion(
  requested: unknown,
  supported: PreviewProtocolVersion = DEFAULT_PREVIEW_PROTOCOL_VERSION,
  errorCodePrefix?: string
): PreviewProtocolVersion {
  const requestedVersion = normalizePreviewProtocolVersion(requested, 'protocolVersion', errorCodePrefix);
  const supportedVersion = normalizePreviewProtocolVersion(
    supported,
    'supportedProtocolVersion',
    errorCodePrefix
  );
  if (requestedVersion.major !== supportedVersion.major) {
    fail('VERSION', `Unsupported preview protocol major version: ${requestedVersion.major}.`, errorCodePrefix);
  }
  return Object.freeze({
    major: supportedVersion.major,
    minor: Math.min(requestedVersion.minor, supportedVersion.minor)
  });
}

/** Validate, de-duplicate, sort, and freeze a capability list. */
export function normalizePreviewCapabilities(
  value: unknown,
  name = 'capabilities',
  errorCodePrefix?: string
): readonly string[] {
  if (!Array.isArray(value)) fail('SCHEMA', `${name} must be an array.`, errorCodePrefix);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !capabilityPattern.test(item)) {
      fail('SCHEMA', `${name} contains an invalid capability.`, errorCodePrefix);
    }
    if (seen.has(item)) fail('SCHEMA', `${name} contains a duplicate.`, errorCodePrefix);
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result.sort());
}

export function normalizeCapabilities(
  value: unknown,
  name = 'capabilities',
  errorCodePrefix?: string
): readonly string[] {
  return normalizePreviewCapabilities(value, name, errorCodePrefix);
}

/** Validate required capabilities and return the app-neutral negotiated capability set. */
export function negotiatePreviewCapabilities(
  options: PreviewCapabilityNegotiationOptions
): Readonly<PreviewCapabilityNegotiation> {
  const normalizedOptions = assertOptionsRecord(options, 'Preview capability negotiation options');
  const prefix = options.errorCodePrefix;
  const requested = normalizePreviewCapabilities(
    normalizedOptions['requestedCapabilities'],
    'capabilities',
    prefix
  );
  const required = normalizePreviewCapabilities(
    normalizedOptions['requiredCapabilities'] ?? [],
    'requiredCapabilities',
    prefix
  );
  const optional = normalizePreviewCapabilities(
    normalizedOptions['optionalCapabilities'] ?? [],
    'optionalCapabilities',
    prefix
  );
  const runtime = normalizePreviewCapabilities(
    normalizedOptions['runtimeCapabilities'] ?? [],
    'runtimeCapabilities',
    prefix
  );
  const available = Object.freeze([...new Set([...required, ...optional, ...runtime])].sort());
  const missing = required.filter((capability) => !requested.includes(capability));
  if (missing.length > 0) {
    fail('CAPABILITY', `Missing required preview capabilities: ${missing.join(', ')}.`, prefix);
  }
  return Object.freeze({
    requestedCapabilities: requested,
    requiredCapabilities: required,
    availableCapabilities: available,
    capabilities: Object.freeze(requested.filter((capability) => available.includes(capability)))
  });
}

/** Create a promise queue for transports that must serialize protocol operations. */
export function createPreviewOperationQueue(): PreviewOperationQueue {
  let tail = Promise.resolve<unknown>(undefined);
  const tracked = new Set<Promise<unknown>>();
  const queue: PreviewOperationQueue = {
    enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    track<T>(work: Promise<T>): Promise<T> {
      const settled = work.then(
        () => undefined,
        () => undefined
      );
      tracked.add(settled);
      void settled.then(() => tracked.delete(settled));
      return work;
    },
    async whenIdle(): Promise<void> {
      while (tracked.size > 0) {
        await Promise.all([...tracked, tail]);
      }
      await tail;
    }
  };
  return Object.freeze(queue);
}

interface ActiveConnection {
  connectionId: number;
  sessionId: string;
  latestRevision: number;
  capabilities: ReadonlySet<string>;
  candidate: PreviewCandidate | null;
}

function connectionSnapshot(connection: ActiveConnection): Readonly<PreviewConnectionSnapshot> {
  const capabilities = Object.freeze([...connection.capabilities].sort());
  return Object.freeze({
    connectionId: connection.connectionId,
    sessionId: connection.sessionId,
    latestRevision: connection.latestRevision,
    capabilities,
    candidate: connection.candidate ? Object.freeze({...connection.candidate}) : null,
    hasCapability(capability: string) {
      return connection.capabilities.has(capability);
    }
  });
}

/** Create reusable protocol/session mechanics without app-specific operation policy. */
export function createPreviewProtocolController<TState = unknown>(
  options: PreviewProtocolControllerOptions<TState> = {}
): PreviewProtocolController<TState> {
  const normalizedOptions = assertOptionsRecord(options, 'Preview protocol controller options');
  const errorCodePrefix = normalizePreviewErrorCodePrefix(
    normalizedOptions['errorCodePrefix'] ?? DEFAULT_PREVIEW_ERROR_CODE_PREFIX
  );
  const version = normalizePreviewProtocolVersion(
    normalizedOptions['protocolVersion'] ?? DEFAULT_PREVIEW_PROTOCOL_VERSION,
    'protocolVersion',
    errorCodePrefix
  );
  const requiredCapabilities = normalizePreviewCapabilities(
    normalizedOptions['requiredCapabilities'] ?? [],
    'requiredCapabilities',
    errorCodePrefix
  );
  const optionalCapabilities = normalizePreviewCapabilities(
    normalizedOptions['optionalCapabilities'] ?? [],
    'optionalCapabilities',
    errorCodePrefix
  );
  const runtimeCapabilities = normalizePreviewCapabilities(
    normalizedOptions['runtimeCapabilities'] ?? [],
    'runtimeCapabilities',
    errorCodePrefix
  );
  const messageTypes = controlMessageTypes(normalizedOptions['messageTypes']);
  const getState = typeof options.getState === 'function' ? options.getState : (() => undefined as TState);
  const isDisposed = typeof options.isDisposed === 'function' ? options.isDisposed : (() => false);
  const onDisconnect = typeof options.onDisconnect === 'function' ? options.onDisconnect : undefined;
  const queue = createPreviewOperationQueue();
  let connection: ActiveConnection | null = null;
  let acceptedConnections = 0;

  function activeConnection(sessionId: unknown, expectedConnectionId?: number): ActiveConnection {
    const requestedSessionId = validatePreviewSessionId(sessionId, 'sessionId', errorCodePrefix);
    if (!connection || isDisposed()) {
      fail('DISCONNECTED', 'Preview session is disconnected.', errorCodePrefix);
    }
    if (connection.sessionId !== requestedSessionId) {
      fail('SESSION', 'Protocol message belongs to a stale session.', errorCodePrefix);
    }
    if (expectedConnectionId !== undefined && connection.connectionId !== expectedConnectionId) {
      fail('SESSION', 'Preview connection was replaced while the operation was in flight.', errorCodePrefix);
    }
    return connection;
  }

  function candidateField(value: unknown, name: string): number {
    return positiveInteger(value, name, errorCodePrefix);
  }

  async function closeActiveConnection(reason: PreviewDisconnectReason): Promise<ActiveConnection | null> {
    if (!connection) return null;
    const active = connection;
    if (onDisconnect) await onDisconnect({reason, connection: connectionSnapshot(active), state: getState()});
    connection = null;
    return active;
  }

  const controller: PreviewProtocolController<TState> = {
    messageTypes,
    errorCodePrefix,
    enqueue: queue.enqueue,
    track: queue.track,
    whenIdle: queue.whenIdle,
    handshake(input: unknown) {
      return queue.enqueue(async () => {
        const request = readPreviewProtocolMessage(
          input,
          messageTypes.handshake,
          ['protocolVersion', 'sessionId', 'capabilities'],
          errorCodePrefix
        );
        const negotiatedVersion = negotiatePreviewProtocolVersion(
          request['protocolVersion'],
          version,
          errorCodePrefix
        );
        const requestedSessionId = validatePreviewSessionId(request['sessionId'], 'sessionId', errorCodePrefix);
        const negotiatedCapabilities = negotiatePreviewCapabilities({
          requestedCapabilities: request['capabilities'],
          requiredCapabilities,
          optionalCapabilities,
          runtimeCapabilities,
          errorCodePrefix
        });
        if (isDisposed()) fail('DISCONNECTED', 'Preview runtime is disposed.', errorCodePrefix);
        await closeActiveConnection('replaced');
        acceptedConnections += 1;
        connection = {
          connectionId: acceptedConnections,
          sessionId: requestedSessionId,
          latestRevision: 0,
          capabilities: new Set(negotiatedCapabilities.capabilities),
          candidate: null
        };
        return Object.freeze({
          type: messageTypes.handshakeAck,
          sessionId: requestedSessionId,
          protocolVersion: negotiatedVersion,
          capabilities: negotiatedCapabilities.capabilities,
          requiredCapabilities,
          state: getState()
        });
      });
    },
    disconnect(input: unknown) {
      return queue.enqueue(async () => {
        const request = readPreviewProtocolMessage(
          input,
          messageTypes.disconnect,
          ['sessionId'],
          errorCodePrefix
        );
        const requestedSessionId = validatePreviewSessionId(request['sessionId'], 'sessionId', errorCodePrefix);
        if (connection && connection.sessionId !== requestedSessionId) {
          fail('SESSION', 'Disconnect belongs to a stale session.', errorCodePrefix);
        }
        // Disconnecting an already disconnected session is a no-op, so cleanup and reconnect races
        // do not have to know whether a connection is still open.
        await closeActiveConnection('disconnect');
        return Object.freeze({type: messageTypes.disconnectAck, sessionId: requestedSessionId});
      });
    },
    currentConnection() {
      if (!connection || isDisposed()) return null;
      return connectionSnapshot(connection);
    },
    requireConnection(sessionId: unknown, expectedConnectionId?: number) {
      return connectionSnapshot(activeConnection(sessionId, expectedConnectionId));
    },
    requireCapability(sessionId: unknown, capability: string) {
      const active = activeConnection(sessionId);
      const [negotiated] = normalizePreviewCapabilities([capability], 'capability', errorCodePrefix);
      if (negotiated === undefined || !active.capabilities.has(negotiated)) {
        fail('CAPABILITY', `${capability} was not negotiated.`, errorCodePrefix);
      }
      return connectionSnapshot(active);
    },
    acceptRevision(sessionId: unknown, revision: unknown, name = 'revision') {
      const active = activeConnection(sessionId);
      const acceptedRevision = validatePreviewRevision(
        revision,
        active.latestRevision,
        name,
        errorCodePrefix
      );
      active.latestRevision = acceptedRevision;
      active.candidate = null;
      return Object.freeze({...connectionSnapshot(active), revision: acceptedRevision});
    },
    acceptCandidate(sessionId: unknown, candidate: {id: unknown; revision: unknown}) {
      const active = activeConnection(sessionId);
      const normalizedCandidate = assertOptionsRecord(candidate, 'candidate');
      active.candidate = {
        id: candidateField(normalizedCandidate['id'], 'candidateId'),
        revision: candidateField(normalizedCandidate['revision'], 'revision')
      };
      return connectionSnapshot(active);
    },
    requireCandidate(sessionId: unknown, revision: unknown, candidateId: unknown) {
      const active = activeConnection(sessionId);
      const requestedRevision = candidateField(revision, 'revision');
      const requestedCandidateId = candidateField(candidateId, 'candidateId');
      if (
        !active.candidate ||
        active.candidate.revision !== requestedRevision ||
        active.candidate.id !== requestedCandidateId
      ) {
        fail('CANDIDATE', 'Preview candidate is stale or missing.', errorCodePrefix);
      }
      return Object.freeze({...active.candidate});
    },
    clearCandidate(sessionId: unknown) {
      const active = activeConnection(sessionId);
      active.candidate = null;
      return connectionSnapshot(active);
    },
    readMessage(input: unknown, expectedType: string, allowedKeys?: readonly string[]) {
      return readPreviewProtocolMessage(input, expectedType, allowedKeys, errorCodePrefix);
    }
  };

  return Object.freeze(controller);
}

function liveReloadPort(value: unknown): PreviewLiveReloadSession {
  if (
    !isRecord(value) ||
    typeof value['stage'] !== 'function' ||
    typeof value['commit'] !== 'function' ||
    typeof value['discardCandidate'] !== 'function' ||
    typeof value['getState'] !== 'function' ||
    typeof value['whenIdle'] !== 'function'
  ) {
    throw new TypeError('liveReloadSession does not implement the preview protocol port.');
  }
  return value as unknown as PreviewLiveReloadSession;
}

function currentSummary(state: PreviewLiveReloadState): Readonly<Record<string, unknown>> {
  const current = isRecord(state.current) ? state.current : null;
  return Object.freeze({
    generation: Number.isSafeInteger(state.generation) ? state.generation : null,
    sourceId: typeof current?.['sourceId'] === 'string' ? current['sourceId'] : null,
    integrity: typeof current?.['integrity'] === 'string' ? current['integrity'] : null
  });
}

export function createPreviewProtocolSession(options: PreviewProtocolSessionOptions): PreviewProtocolSession {
  const normalizedOptions = assertOptionsRecord(options, 'Preview protocol options');
  const liveReload = liveReloadPort(normalizedOptions['liveReloadSession']);
  const messageTypes = protocolSessionMessageTypes(normalizedOptions['messageTypes']);
  const stateSnapshot =
    typeof options.stateSnapshot === 'function'
      ? options.stateSnapshot
      : (state: PreviewLiveReloadState) => currentSummary(state);
  const errorCodePrefix = normalizePreviewErrorCodePrefix(
    normalizedOptions['errorCodePrefix'] ?? DEFAULT_PREVIEW_ERROR_CODE_PREFIX
  );
  const deferCapability =
    options.deferCapability === undefined
      ? null
      : (normalizePreviewCapabilities([options.deferCapability], 'deferCapability', errorCodePrefix)[0] ??
        null);
  const controllerOptions: PreviewProtocolControllerOptions<Readonly<Record<string, unknown>>> = {
    requiredCapabilities: options.requiredCapabilities,
    errorCodePrefix,
    messageTypes,
    getState: () => stateSnapshot(liveReload.getState()),
    isDisposed: () => liveReload.getState().disposed === true,
    onDisconnect: async () => {
      await liveReload.discardCandidate();
    }
  };
  if (options.optionalCapabilities !== undefined) controllerOptions.optionalCapabilities = options.optionalCapabilities;
  if (options.runtimeCapabilities !== undefined) controllerOptions.runtimeCapabilities = options.runtimeCapabilities;
  if (options.protocolVersion !== undefined) controllerOptions.protocolVersion = options.protocolVersion;
  const controller = createPreviewProtocolController(controllerOptions);

  function sessionState(): Readonly<PreviewProtocolSessionState> {
    const active = controller.currentConnection();
    return Object.freeze({
      connected: active !== null,
      sessionId: active?.sessionId ?? null,
      latestRevision: active?.latestRevision ?? 0,
      candidate: active?.candidate ?? null,
      current: stateSnapshot(liveReload.getState())
    });
  }

  return Object.freeze({
    async handshake(input: unknown) {
      const response = await controller.handshake(input);
      return Object.freeze({
        type: response.type,
        sessionId: response.sessionId,
        protocolVersion: response.protocolVersion,
        capabilities: response.capabilities,
        requiredCapabilities: response.requiredCapabilities,
        current: response.state
      });
    },
    stage(input: unknown) {
      return controller.enqueue(async () => {
        const request = controller.readMessage(input, messageTypes.stage, ['sessionId', 'revision', 'result']);
        const active = controller.acceptRevision(request['sessionId'], request['revision']);
        const result = await liveReload.stage(request['result']);
        return Object.freeze({
          type: messageTypes.stageAck,
          sessionId: active.sessionId,
          revision: active.revision,
          result
        });
      });
    },
    defer(input: unknown) {
      return controller.enqueue(async () => {
        const request = controller.readMessage(input, messageTypes.defer, ['sessionId']);
        const active =
          deferCapability === null
            ? controller.requireConnection(request['sessionId'])
            : controller.requireCapability(request['sessionId'], deferCapability);
        await liveReload.defer?.();
        return Object.freeze({type: messageTypes.deferAck, sessionId: active.sessionId});
      });
    },
    commit(input: unknown) {
      return controller.enqueue(async () => {
        const request = controller.readMessage(input, messageTypes.commit, ['sessionId', 'options', 'restart']);
        const active = controller.requireConnection(request['sessionId']);
        const hasOptions = request['options'] !== undefined;
        const hasRestart = request['restart'] !== undefined;
        if (hasOptions && hasRestart) {
          fail('SCHEMA', 'commit message must not provide both options and restart.', errorCodePrefix);
        }
        let commitOptions = request['options'];
        if (hasRestart) {
          commitOptions = isRecord(request['restart']) ? {restart: request['restart']} : undefined;
        }
        if (commitOptions !== undefined && !isRecord(commitOptions)) {
          fail('SCHEMA', 'options must be an object when provided.', errorCodePrefix);
        }
        const result = await liveReload.commit(commitOptions);
        return Object.freeze({type: messageTypes.commitAck, sessionId: active.sessionId, result});
      });
    },
    disconnect(input: unknown) {
      return controller.disconnect(input);
    },
    getState() {
      return sessionState();
    },
    async whenIdle() {
      await controller.whenIdle();
      return sessionState();
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
