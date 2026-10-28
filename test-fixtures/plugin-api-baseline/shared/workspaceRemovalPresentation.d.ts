/** Explicit provider provenance for host-owned workspace removal chrome. */
export interface WorkspaceRemovalLocalization {
    readonly kind: "gitWorktree";
    readonly label: string;
    readonly path: string;
}
/** Cosmetic metadata is optional; unknown versions retain provider-authored fallback text. */
export declare function parseWorkspaceRemovalLocalization(value: unknown): WorkspaceRemovalLocalization | undefined;
