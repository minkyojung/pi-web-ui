/**
 * Create PR from the window: the command, sent for the person, as Approve
 * sends /spec-approve (specApprove.ts) — pullRequest.ts makes the steps from
 * what git says at that moment, and the conversation says "Create a PR".
 *
 * Pure. The stores are read where it is drawn.
 */
import type { ClientMsg } from "../../protocol.ts";

/** Its name on pi's list of commands (CommandsMsg), which is how the window knows it is there. */
export const CREATE_PR = "create-pr";

/** What the box sends for the button, or for Create draft PR. */
export const createPrMessage = (draft: boolean): ClientMsg => ({ type: "prompt", text: draft ? `/${CREATE_PR} draft` : `/${CREATE_PR}`, command: true, behavior: "followUp" });
