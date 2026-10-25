import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createPlatform } from "./platform";
import { AppStore } from "./state/store";
import { StoreContext } from "./state/useStore";
import "./styles.css";

const store = new AppStore(createPlatform());
void store.init();
createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>,
);
