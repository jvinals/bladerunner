/** Helpers for `RunStep.metadata` AI prompt test / codegen flags (same rules as Add AI step drawer). */

export function aiPromptCodegenOkForInstruction(meta: unknown, instr: string): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  const t = instr.trim();
  return (
    m.lastAiPromptCodegenOk === true &&
    (m.lastAiPromptCodegenInstruction as string | undefined)?.trim() === t
  );
}

export function aiPromptRunOkForInstruction(meta: unknown, instr: string): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  const t = instr.trim();
  return (
    m.lastAiPromptRunOk === true &&
    (m.lastAiPromptRunInstruction as string | undefined)?.trim() === t
  );
}

export function aiPromptBothPhasesOkForInstruction(meta: unknown, instr: string): boolean {
  return aiPromptCodegenOkForInstruction(meta, instr) && aiPromptRunOkForInstruction(meta, instr);
}
