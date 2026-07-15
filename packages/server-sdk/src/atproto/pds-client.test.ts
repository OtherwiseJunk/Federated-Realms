import { describe, expect, test } from "bun:test";
import { NSID } from "@realms/lexicons";
import { PdsClient } from "./pds-client.js";

describe("PdsClient", () => {
  test("deleteCharacter deletes the self profile record", async () => {
    const calls: any[] = [];
    const agent = {
      com: {
        atproto: {
          repo: {
            deleteRecord: async (a: any) => {
              calls.push(a);
            },
          },
        },
      },
    };
    await new PdsClient({ did: "did:x" } as any).deleteCharacter(agent as any, "did:plc:abc");
    expect(calls[0]).toMatchObject({
      repo: "did:plc:abc",
      collection: NSID.CharacterProfile,
      rkey: "self",
    });
  });
});
