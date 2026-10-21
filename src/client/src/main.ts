import { applyDocumentLocalization, initializeClientLocalization } from "./localizationBootstrap";

await initializeClientLocalization();
applyDocumentLocalization(document);
await import("./components/PiWebApp");
