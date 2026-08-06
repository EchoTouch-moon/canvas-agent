export class PersistenceError extends Error {
  override readonly name: string = 'PersistenceError'
}

export class NotFoundError extends PersistenceError {
  override readonly name: string = 'NotFoundError'
  constructor(
    readonly entity: string,
    readonly entityId: string
  ) {
    super(`Cannot find ${entity} with id ${entityId}`)
  }
}

export class ValidationError extends PersistenceError {
  override readonly name: string = 'ValidationError'
}

export class SelfEdgeError extends ValidationError {
  override readonly name: string = 'SelfEdgeError'
  constructor(nodeId: string) {
    super(`An Edge must not connect a Node to itself (${nodeId})`)
  }
}

export class CycleError extends ValidationError {
  override readonly name: string = 'CycleError'
  constructor(
    readonly relation: string,
    readonly startNodeId: string,
    readonly endNodeId: string
  ) {
    super(`Rejected ${relation} edge ${startNodeId} -> ${endNodeId}: it would create a cycle`)
  }
}

export class ConcurrencyError extends PersistenceError {
  override readonly name: string = 'ConcurrencyError'
  constructor(
    readonly entity: string,
    readonly entityId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Concurrent modification of ${entity} ${entityId}: expected revision ${expectedRevision}, actual revision ${actualRevision}`
    )
  }
}

export class ImmutableWriteError extends PersistenceError {
  override readonly name: string = 'ImmutableWriteError'
  constructor(entity: string, entityId: string) {
    super(`Refusing to modify immutable ${entity} ${entityId}`)
  }
}
