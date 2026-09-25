/**
 * The pull request's commands from the window: sent for the person, as
 * Approve sends /spec-approve (specApprove.ts) — pullRequest.ts makes the
 * steps from what git says at that moment, and the conversation says what
 * was asked ("Create a PR", "Fix the failing checks").
 *
 * Pure. The stores are read where they are drawn.
 */
import type { ClientMsg } from "../../protocol.ts";

/** Their names on pi's list of commands (CommandsMsg), which is how the window knows they are there. */
export const CREATE_PR = "create-pr";
export const PUSH = "push";
export const RESOLVE_CONFLICTS = "resolve-conflicts";
export const FIX_CHECKS = "fix-checks";
export const ADDRESS_REVIEW = "address-review";

/** What the box sends for a command's button — see Composer.tsx. */
export const commandMessage = (name: string, args = ""): ClientMsg => ({ type: "prompt", text: args ? `/${name} ${args}` : `/${name}`, command: true, behavior: "followUp" });
