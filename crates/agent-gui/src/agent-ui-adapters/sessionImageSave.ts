import type { SaveSessionImageOutcome } from "@liveagent/ui/contracts/sessionImageSave";
import { saveSessionImageToWorkspace } from "../lib/images/sessionImageTransfer";

export const supportsSessionImageSaveToWorkspace = true;

export function saveSessionImage(sourcePath: string): Promise<SaveSessionImageOutcome> {
  return saveSessionImageToWorkspace(sourcePath);
}
