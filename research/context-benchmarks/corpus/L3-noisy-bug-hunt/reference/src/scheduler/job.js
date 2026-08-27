'use strict'

// Job value object. seq is the scheduling-order counter assigned by the
// scheduler; ties on priority are broken by ascending seq.

let nextSeq = 0

function resetSeq() {
  nextSeq = 0
}

function createJob({ type, payload = {}, priority = 1 }) {
  if (typeof type !== 'string' || type.length === 0) throw new TypeError('type must be a non-empty string')
  if (payload === null || typeof payload !== 'object') throw new TypeError('payload must be an object')
  if (!Number.isInteger(priority) || priority < 0 || priority > 9) {
    throw new RangeError('priority must be an integer between 0 and 9')
  }
  const seq = nextSeq
  nextSeq += 1
  return {
    id: `job-${seq}`,
    seq,
    type,
    payload: { ...payload },
    priority,
    status: 'pending',
    createdAt: 0
  }
}

module.exports = { createJob, resetSeq }
