/**
 * Permission request from OpenCode (maps to SDK PermissionRequest)
 */
export interface PermissionRequest {
  id: string; // Request ID for reply
  sessionID: string;
  permission: string; // "bash", "edit", "webfetch", etc.
  patterns: Array<string>; // Commands/files being requested
  metadata: { [key: string]: unknown }; // Additional context
  always: Array<string>; // Already approved patterns
  tool?: {
    messageID: string;
    callID: string;
  };
}

/**
 * A visible MAX permission prompt that groups equivalent OpenCode requests
 */
export interface GroupedPermissionMessage {
  messageId: string; // MAX message ID showing the prompt
  request: PermissionRequest; // The request the visible prompt was rendered from
  count: number; // Number of OpenCode requests grouped behind the prompt
}

/**
 * Possible permission responses
 */
export type PermissionReply = "once" | "always" | "reject";

/**
 * How a permission prompt ended: answered (here or outside MAX), settled outside
 * MAX with the decision unknown, or dropped without an answer
 */
export type PermissionOutcome =
  | { kind: "replied"; reply: PermissionReply; outside: boolean }
  | { kind: "settled_outside" }
  | { kind: "not_answered" };

/**
 * A visible prompt whose OpenCode requests changed: it ended with an outcome, or it
 * stays open with fewer grouped requests
 */
export interface PermissionPromptChange {
  messageId: string;
  request: PermissionRequest;
  openCount: number;
  outcome: PermissionOutcome | null;
}

/**
 * An answer tapped in MAX that is on its way to OpenCode
 */
export interface PermissionSend {
  reply: PermissionReply;
  requestIds: string[];
  settlesSession: boolean; // A V2 reject settles every pending request of the session
}

/**
 * State for active permission requests
 */
export interface PermissionState {
  requestsByMessageId: Map<string, PermissionRequest>; // MAX message ID -> request
  requestIdsByMessageId: Map<string, string[]>; // MAX message ID -> open OpenCode request IDs
  messageIdBySignature: Map<string, string>; // Equivalent permission signature -> MAX message ID
  sendsByMessageId: Map<string, PermissionSend>; // MAX message ID -> answer being sent
}
