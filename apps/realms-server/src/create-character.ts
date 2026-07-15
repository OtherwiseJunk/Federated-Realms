import { validateCharacterName } from "@realms/common";

export interface CreateCharacterInput {
  name: string;
  classId: string;
  raceId: string;
}

export type CreateCharacterResult =
  | { ok: true; name: string; classId: string; raceId: string }
  | { ok: false; error: string };

export function validateCreateCharacterInput(body: CreateCharacterInput): CreateCharacterResult {
  const nameResult = validateCharacterName(body.name);
  if (!nameResult.ok) return { ok: false, error: nameResult.error };
  if (body.classId.length > 64) return { ok: false, error: "classId exceeds maximum length (64)." };
  if (body.raceId.length > 64) return { ok: false, error: "raceId exceeds maximum length (64)." };
  return { ok: true, name: nameResult.name, classId: body.classId, raceId: body.raceId };
}
