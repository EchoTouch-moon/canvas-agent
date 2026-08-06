import { createHash } from 'node:crypto'

export interface SystemServices {
  now(): string
  nextId(prefix: string): string
}

export const defaultServices: SystemServices = {
  now: () => new Date().toISOString(),
  nextId: (prefix) => `${prefix}_${crypto.randomUUID()}`
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function canonicalContent(title: string, body: string): string {
  return JSON.stringify({ title, body })
}

export function taskSpecContentHash(description: string, scope: string, targets: readonly string[], criteria: readonly string[]): string {
  return sha256Hex(JSON.stringify({ description, scope, targets, criteria }))
}
