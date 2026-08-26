'use strict'

// Array-backed priority queue (max-heap on priority, insertion order for
// ties). Used by tooling that inspects pending work outside the scheduler.

function createPriorityQueue() {
  const heap = []

  function higherPriority(a, b) {
    if (heap[a].priority !== heap[b].priority) return heap[a].priority > heap[b].priority
    return heap[a].seq < heap[b].seq
  }

  function swap(a, b) {
    const tmp = heap[a]
    heap[a] = heap[b]
    heap[b] = tmp
  }

  function siftUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!higherPriority(index, parent)) break
      swap(index, parent)
      index = parent
    }
  }

  function siftDown(index) {
    while (true) {
      const left = 2 * index + 1
      const right = 2 * index + 2
      let top = index
      if (left < heap.length && higherPriority(left, top)) top = left
      if (right < heap.length && higherPriority(right, top)) top = right
      if (top === index) break
      swap(index, top)
      index = top
    }
  }

  return {
    push(item) {
      if (item === null || typeof item !== 'object' || !('priority' in item)) {
        throw new TypeError('item with a priority is required')
      }
      heap.push({ ...item, seq: item.seq ?? heap.length })
      siftUp(heap.length - 1)
      return heap.length
    },
    pop() {
      if (heap.length === 0) return undefined
      const top = heap[0]
      const last = heap.pop()
      if (heap.length > 0) {
        heap[0] = last
        siftDown(0)
      }
      return top
    },
    size() {
      return heap.length
    },
    peek() {
      return heap.length === 0 ? undefined : { ...heap[0] }
    }
  }
}

module.exports = { createPriorityQueue }
