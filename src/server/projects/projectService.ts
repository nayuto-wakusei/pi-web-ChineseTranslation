import { mkdir, realpath, stat } from "node:fs/promises";
import { UserFacingError } from "../../shared/i18n.js";
import type { ProjectStore } from "../storage/projectStore.js";
import type { Project } from "../types.js";
import { expandUserPath } from "./directorySuggestions.js";

export class ProjectService {
  constructor(private readonly store: ProjectStore) {}

  list(): Promise<Project[]> {
    return this.store.list();
  }

  async add(input: { name?: string; path: string; create?: boolean }): Promise<Project> {
    const requestedPath = expandUserPath(input.path);
    if (input.create === true) await mkdir(requestedPath, { recursive: true });
    const resolved = await realpath(requestedPath);
    const s = await stat(resolved);
    if (!s.isDirectory()) throw new UserFacingError("projectError.pathMustBeDirectory", "Project path must be a directory");
    return this.store.add(input.name === undefined ? { path: resolved } : { name: input.name, path: resolved });
  }

  async close(id: string): Promise<void> {
    if (!(await this.store.remove(id))) throw new UserFacingError("projectError.notFound", "Project not found");
  }

  async requireProject(id: string): Promise<Project> {
    const project = await this.store.get(id);
    if (!project) throw new UserFacingError("projectError.notFound", "Project not found");
    return project;
  }
}
