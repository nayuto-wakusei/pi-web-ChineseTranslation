// Entry JSON and trusted gateway-to-daemon context have separate transport budgets.
export const MANAGEMENT_ENTRY_BODY_LIMIT = 1024 * 1024;
export const MANAGEMENT_CONTEXT_HEADER_LIMIT = 1024 * 1024;
export const SESSIOND_MAX_HEADER_SIZE = MANAGEMENT_CONTEXT_HEADER_LIMIT + 64 * 1024;
