import type { SaveSessionImageOutcome } from "@liveagent/ui/contracts/sessionImageSave";

/** WebUI 端没有本地工作区写入能力（也没有本地生图临时根）：动作整体不可用。 */
export const supportsSessionImageSaveToWorkspace = false;

export function saveSessionImage(_sourcePath: string): Promise<SaveSessionImageOutcome> {
  return Promise.resolve({ status: "unsupported" as const });
}
