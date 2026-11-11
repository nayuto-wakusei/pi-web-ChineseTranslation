export type FilesViewerDependencies = typeof import("./viewerDependencies.js");
export type FilesViewerLoader = () => Promise<FilesViewerDependencies>;

// Pass this function from the active registration; shared element constructors
// may still belong to a previously visited machine's module.
export function loadFilesViewerDependencies(): Promise<FilesViewerDependencies> {
  return import("./viewerDependencies");
}
