import { createContext, useContext, useSyncExternalStore } from "react";
import type { AppStore, State } from "./store";

export const StoreContext = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error("StoreContext missing");
  return s;
}

export function useAppState(): State {
  const s = useApp();
  return useSyncExternalStore(s.subscribe, s.getState);
}
