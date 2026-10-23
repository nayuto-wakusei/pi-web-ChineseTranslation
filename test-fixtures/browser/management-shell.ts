import { PiWebApp } from "../../src/client/src/components/PiWebApp";

history.replaceState({}, "", `${location.pathname}?embed=management`);
const app = new PiWebApp();
// Exercise the actual shell without starting daemon connections or polling.
Reflect.set(app, "initializeNormalAuth", () => Promise.resolve());
document.body.append(app);
await app.updateComplete;
document.body.dataset["ready"] = "true";
