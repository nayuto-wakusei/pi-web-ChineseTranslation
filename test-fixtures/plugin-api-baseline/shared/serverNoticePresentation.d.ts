/** Explicit PI WEB-generated notice provenance; raw plugin text is never a translation key. */
export type ServerNoticePresentation = {
    kind: "workspaceRemovalCommandFailed";
} | {
    kind: "workspaceRemovalFailed";
    detail: string;
};
/** Cosmetic metadata must not prevent an otherwise valid notice from being displayed. */
export declare function parseServerNoticePresentation(value: unknown): ServerNoticePresentation | undefined;
