import "./styles/editor.css";
import "./styles/app.css";
import { App } from "./app/app";
import { toast } from "./app/ui";

const container = document.getElementById("app")!;
container.replaceChildren();
const app = new App();
(window as unknown as { typorium: App }).typorium = app;
app.start(container).catch(error => {
  console.error(error);
  toast(`Typorium couldn't start: ${error instanceof Error ? error.message : String(error)}`, { kind: "error", timeout: 15000 });
});

// Offline support and updates. The service worker only exists in production builds.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast("A new version of Typorium is available.", { timeout: 60000, action: { label: "Reload", run: () => { app.stash(); void app.docs.persist().then(() => update(true)); } } });
      },
      onOfflineReady() { toast("Typorium is ready to work offline.", { kind: "success" }); },
    });
  });
}
