export function createState<T extends object>(initial: T) {
  let current: Readonly<T> = Object.freeze(initial)
  const listeners = new Set<(value: Readonly<T>) => void>()
  return {
    get snapshot(): Readonly<T> { return current },
    update(value: T) { current = Object.freeze(value); for (const listener of listeners) listener(current) },
    subscribe(listener: (value: Readonly<T>) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
