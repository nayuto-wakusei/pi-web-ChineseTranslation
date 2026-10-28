/** Explicit provenance for generated terminal titles; authored titles remain verbatim. */
export interface TerminalTitlePresentation {
    readonly kind: "workspaceRemoval";
    readonly label: string;
}
/** Invalid cosmetic metadata must not hide an otherwise valid command or terminal. */
export declare function parseTerminalTitlePresentation(value: unknown): TerminalTitlePresentation | undefined;
export declare function terminalTitlePresentationField(value: unknown): {
    titlePresentation?: TerminalTitlePresentation;
};
