import { describe, expect, test } from "bun:test";
import { validateCharacterName } from "@realms/common";
import { resolveFederatedName } from "./transfer-handler.js";

const SUBJECT_DID = "did:plc:abc123xyz789";

describe("resolveFederatedName", () => {
  test("passes a valid federated name through, normalized/trimmed", () => {
    expect(resolveFederatedName("Aldric", SUBJECT_DID)).toBe("Aldric");
    expect(resolveFederatedName("  Aldric  ", SUBJECT_DID)).toBe("Aldric");
  });

  test("substitutes a placeholder for a name with control/zero-width characters", () => {
    // Zero-width joiner + a tag-block smuggling char — exactly what signup rejects.
    const hostile = "Ald‍ric\u{E0041}";
    const resolved = resolveFederatedName(hostile, SUBJECT_DID);
    expect(resolved).not.toBe(hostile);
    // The substitute must itself be a name the validator would accept.
    expect(validateCharacterName(resolved).ok).toBe(true);
  });

  test("substitutes a placeholder for a name impersonating a system actor", () => {
    const resolved = resolveFederatedName("System", SUBJECT_DID);
    expect(resolved.toLowerCase()).not.toBe("system");
    expect(validateCharacterName(resolved).ok).toBe(true);
  });

  test("substitutes a placeholder for an empty or whitespace name", () => {
    expect(validateCharacterName(resolveFederatedName("", SUBJECT_DID)).ok).toBe(true);
    expect(validateCharacterName(resolveFederatedName("   ", SUBJECT_DID)).ok).toBe(true);
  });

  test("substitutes a placeholder for a non-string name", () => {
    expect(validateCharacterName(resolveFederatedName(undefined, SUBJECT_DID)).ok).toBe(true);
    expect(validateCharacterName(resolveFederatedName(42, SUBJECT_DID)).ok).toBe(true);
  });

  test("derives a stable, non-impersonating placeholder from a did subject", () => {
    // handleLocalPart returns "" for a did:, so we fall through to a generated name.
    const resolved = resolveFederatedName("", SUBJECT_DID);
    expect(resolved).toBe("Traveler-xyz789");
    expect(validateCharacterName(resolved).ok).toBe(true);
  });

  test("prefers the handle local part when the subject is a handle", () => {
    const resolved = resolveFederatedName("‮evil", "alice.realm.example");
    expect(resolved).toBe("alice");
  });

  test("falls back to a bare placeholder when the subject is empty", () => {
    expect(resolveFederatedName("", "")).toBe("Traveler");
  });
});
