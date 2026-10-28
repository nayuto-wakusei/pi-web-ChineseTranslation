import { message } from "../../localization/service";

export default {
  heading: message("MCP", "MCP authentication settings heading; protocol name"),
  description: message("Manage authentication for enabled MCP servers that support OAuth in the selected session.", "MCP settings scope guidance"),
  refresh: message("Refresh servers", "Reload MCP servers in the selected session"),
  thisMachine: message("this machine", "Fallback machine target when no display name is provided"),
  selectSession: message<{ target: string }>("Select a nonarchived session on {target} to manage MCP authentication. Close settings to select a session, or use Configure machine to match the selected session’s machine.", "No eligible session; target is the raw selected machine label; Configure machine names the settings machine selector"),
  context: message("Session context", "MCP session context section heading"),
  contextAria: message("MCP session context", "Accessible name for selected MCP machine, session and workspace"),
  machine: message("Machine:", "Selected machine value label"),
  session: message("Session:", "Selected session identifier label"),
  workspace: message("Workspace:", "Selected session working directory label"),
  logoutHelp: message("Logout removes local Pi credentials. It does not disable the server or revoke permission at the provider. Other sessions using those credentials are also affected.", "Consequences of logging out of an MCP server"),
  loading: message("Loading MCP servers…", "MCP server list loading status"),
  empty: message("No enabled MCP servers with OAuth support are available in this session.", "MCP server list empty status"),
  serversAria: message("MCP servers", "Accessible name for MCP authentication server list"),
  login: message("Login", "Open MCP server OAuth login"),
  logout: message("Logout", "Remove local MCP credentials"),
  loginAria: message<{ name: string }>("Login to {name}", "Server-specific login accessible name; raw server name"),
  logoutAria: message<{ name: string }>("Logout from {name}", "Server-specific logout accessible name; raw server name"),
  loadError: message<{ error: string }>("Could not load MCP servers: {error}", "Server list load failure; raw runtime diagnostic"),
  authError: message<{ error: string }>("Could not open MCP authentication: {error}", "Authentication flow launch failure; raw runtime diagnostic"),
};
