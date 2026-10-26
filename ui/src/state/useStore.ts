import { createContext, useContext, useSyncExternalStore } from "react";
import type { AppStore, State } from "./store";

export const StoreContext = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error("StoreContext missing");
  return s;
}

/** Subscribes to one slice: the component re-renders only when `pick` returns a different value (compare by Object.is). */
export function useAppSelector<T>(pick: (s: State) => T): T {
  const s = useApp();
  return useSyncExternalStore(s.subscribe, () => pick(s.getState()));
}

export function useAppState(): State {
  const s = useApp();
  return useSyncExternalStore(s.subscribe, s.getState);
}
