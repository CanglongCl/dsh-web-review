/** Contract-faithful store engine used by npm-only unit/component tests. */
import type { ActionsDecl, BakedActions, StoreSpec } from '@deepseek-ai/dsh-client-ui-slots'

/** Minimal defineStore implementation matching the runtime's public store contract. */
export function defineStore<T, A extends ActionsDecl<T>>(spec: StoreSpec<T, A> & { actions: A }) {
  return {
    spec,
    create() {
      let state = spec.init()
      const listeners = new Set<() => void>()
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, mutate]) => [
        name,
        (...parameters: unknown[]) => {
          // The production Immer engine preserves untouched branch identity;
          // these store actions mutate only top-level fields, so a shallow
          // draft reproduces the selector/effect semantics without Harness.
          const draft = Object.assign({}, state) as T
          mutate(draft, ...parameters)
          state = draft
          for (const listener of listeners) listener()
        },
      ])) as BakedActions<T, A>
      return {
        actions,
        getSnapshot: () => state,
        subscribe(listener: () => void) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        clearPersisted() {},
      }
    },
  }
}
