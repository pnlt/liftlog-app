import type { DomainEvent } from '@myos/contracts'

type Listener = (event: DomainEvent) => void | Promise<void>

const listeners = new Set<Listener>()

/** Other teams' features subscribe here instead of importing workout code. A failing listener never breaks the emitter. */
export const domainEvents = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  emit(event: DomainEvent): void {
    for (const listener of listeners) {
      Promise.resolve()
        .then(() => listener(event))
        .catch((err: unknown) => console.error(`[events] ${event.type} listener failed`, err))
    }
  },
}
