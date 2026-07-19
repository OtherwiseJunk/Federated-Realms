import { AtpAgent } from "@atproto/api";
import { Secp256k1Keypair } from "@atproto/crypto";
import { verifySig } from "@atproto/crypto/dist/secp256k1/operations";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AtProtoConfig } from "../types/server-config.js";
import { NSID } from "@realms/lexicons";

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(bytes).toString("base64url");
}

async function readKeyFile(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function writeKeyFile(path: string, hex: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, hex, { mode: 0o600 });
}

export interface TransferPayload {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  characterHash: string;
  targetRoom: string;
}

export interface AttestationClaims {
  level?: number;
  xp?: number;
  itemsGranted?: string[];
  questsCompleted?: string[];
  gold?: number;
}

export interface SignedAttestation {
  iss: string;
  sub: string;
  iat: number;
  claims: AttestationClaims;
  sig: string;
}

/**
 * Build an actionable error for when logging in as the configured server
 * account (SERVER_DID) fails. The most common cause is that the account's repo
 * no longer exists on the PDS — e.g. after a PDS reset/wipe the DID persists in
 * PLC (an external append-only registry) but its backing account is gone, so
 * the handle no longer resolves. The message tells the operator how to recover.
 */
export function serverAccountLoginError(
  handle: string,
  serverDid: string,
  pdsUrl: string,
  cause: string,
): Error {
  return new Error(
    `Failed to log in as the server account "${handle}" (SERVER_DID=${serverDid}) on ${pdsUrl}: ${cause}. ` +
      `The account's repo may not exist on the PDS: after a PDS reset/wipe the DID persists in PLC but its ` +
      `account is gone and the handle stops resolving. Recreate the server account on the PDS and set ` +
      `SERVER_DID to the new DID, or clear SERVER_DID to have the server create a fresh account.`,
  );
}

export class ServerIdentity {
  did = "";
  agent!: AtpAgent;
  // Optional by design: initialize() catches signing-key init failure and
  // continues in a degraded mode where it stays undefined. canSign reflects
  // that honestly so callers can gate instead of hitting a runtime throw.
  private signingKey?: Secp256k1Keypair;

  /**
   * Whether this identity can produce signatures — both attestations and
   * transfer tokens, which are signed with the same secp256k1 signing key. False
   * when the signing key failed to initialize: the server still runs, but
   * federation signing is disabled.
   */
  get canSign(): boolean {
    return this.signingKey !== undefined;
  }

  private requireSigningKey(): Secp256k1Keypair {
    if (!this.signingKey) {
      throw new Error(
        "Server signing key is unavailable; federation signing is disabled on this server",
      );
    }
    return this.signingKey;
  }

  async initialize(
    config: AtProtoConfig,
    serverName: string,
    serverDescription: string,
  ): Promise<void> {
    this.agent = new AtpAgent({ service: config.pdsUrl });

    const handle = config.serverHandle.endsWith(".localhost")
      ? config.serverHandle.replace(/\.localhost$/, ".test")
      : config.serverHandle;

    if (config.serverDid) {
      try {
        await this.agent.login({
          identifier: handle,
          password: config.serverPassword,
        });
      } catch (err) {
        throw serverAccountLoginError(
          handle,
          config.serverDid,
          config.pdsUrl,
          err instanceof Error ? err.message : String(err),
        );
      }
      this.did = config.serverDid;
      console.log(`   Server identity: ${this.did}`);
    } else {
      console.log("   Creating server account on PDS...");
      try {
        const result = await this.agent.createAccount({
          handle,
          email: "server@example.com",
          password: config.serverPassword,
        });
        this.did = result.data.did;
        console.log(`   Server account created: ${this.did}`);
        console.log(`   ⚠  Set SERVER_DID=${this.did} in your environment for subsequent boots`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("handle already taken") || message.includes("Handle already taken")) {
          console.log("   Server account already exists, logging in...");
          await this.agent.login({
            identifier: handle,
            password: config.serverPassword,
          });
          this.did = this.agent.session?.did ?? "";
          console.log(`   Server identity: ${this.did}`);
          console.log(`   ⚠  Set SERVER_DID=${this.did} in your environment`);
        } else {
          throw err;
        }
      }
    }

    try {
      await this.resolveSigningKey(config);
    } catch (err) {
      console.warn(
        "   Signing key init failed (federation features disabled):",
        err instanceof Error ? err.message : err,
      );
    }

    await this.publishServerRecord(config, serverName, serverDescription);
  }

  async initSigningKey(persistedKey?: string): Promise<void> {
    const key = persistedKey?.trim();
    this.signingKey = key
      ? await Secp256k1Keypair.import(new Uint8Array(Buffer.from(key, "hex")), { exportable: true })
      : await Secp256k1Keypair.create({ exportable: true });
  }

  /**
   * The signing key's private bytes as hex, for persisting to SERVER_SIGNING_KEY
   * so federation signatures stay valid across restarts (issue #23).
   */
  async exportSigningKey(): Promise<string> {
    return Buffer.from(await this.requireSigningKey().export()).toString("hex");
  }

  /**
   * Load the federation signing key so it stays stable across restarts (issue
   * #23). Precedence: SERVER_SIGNING_KEY (env) for secret-manager setups;
   * otherwise persist to / reload from a key file in the data dir; only if
   * neither is available does it fall back to an ephemeral key. The private key
   * is never logged.
   */
  private async resolveSigningKey(config: AtProtoConfig): Promise<void> {
    const envKey = config.serverSigningKey?.trim();
    if (envKey) {
      await this.initSigningKey(envKey);
      return;
    }

    const keyPath = config.signingKeyPath?.trim();
    if (keyPath) {
      const existing = await readKeyFile(keyPath);
      if (existing) {
        await this.initSigningKey(existing);
        return;
      }
      await this.initSigningKey();
      await writeKeyFile(keyPath, await this.exportSigningKey());
      console.log(`   Generated a new server signing key, persisted to ${keyPath}.`);
      return;
    }

    await this.initSigningKey();
    console.warn(
      "   ⚠  No SERVER_SIGNING_KEY or key path set — using an ephemeral signing key that " +
        "rotates each restart, breaking federation signatures across restarts (issue #23).",
    );
  }

  /**
   * @deprecated Equivalent to {@link initSigningKey} now that transfer tokens are
   * signed with the secp256k1 key directly and there is no separate JWT key.
   */
  async initSigningKeyOnly(): Promise<void> {
    await this.initSigningKey();
  }

  private async publishServerRecord(
    config: AtProtoConfig,
    serverName: string,
    serverDescription: string,
  ): Promise<void> {
    try {
      await this.agent.com.atproto.repo.putRecord({
        repo: this.did,
        collection: NSID.WorldServer,
        rkey: "self",
        record: {
          $type: NSID.WorldServer,
          name: serverName,
          description: serverDescription,
          endpoint: `${config.publicUrl}/ws`,
          xrpcEndpoint: `${config.publicUrl}/xrpc`,
          createdAt: new Date().toISOString(),
        },
      });
      console.log("   Published server record to PDS");
    } catch (err) {
      console.warn("   Failed to publish server record:", err instanceof Error ? err.message : err);
    }
  }

  async signTransferToken(payload: TransferPayload): Promise<string> {
    const key = this.requireSigningKey();
    const header = { alg: "ES256K", typ: "JWT" };
    const claims = {
      iss: payload.iss,
      sub: payload.sub,
      aud: payload.aud,
      iat: payload.iat,
      exp: payload.exp,
      characterHash: payload.characterHash,
      targetRoom: payload.targetRoom,
    };
    // Compact-JWS over the secp256k1 signing key (the same key attestations use).
    // We sign natively rather than via jose/WebCrypto, which doesn't support
    // secp256k1 (issue #100). The signature is atproto's 64-byte low-S r||s,
    // which is exactly the ES256K JWS signature encoding.
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const sig = await key.sign(new TextEncoder().encode(signingInput));
    return `${signingInput}.${b64url(sig)}`;
  }

  async verifyTransferToken(
    jwt: string,
    expectedAudience: string,
  ): Promise<TransferPayload | null> {
    return this.verifyTransferTokenWithKey(
      jwt,
      expectedAudience,
      this.requireSigningKey().publicKeyBytes(),
    );
  }

  async verifyRemoteTransferToken(
    jwt: string,
    expectedAudience: string,
    publicKeyBytes: Uint8Array,
  ): Promise<TransferPayload | null> {
    return this.verifyTransferTokenWithKey(jwt, expectedAudience, publicKeyBytes);
  }

  private async verifyTransferTokenWithKey(
    jwt: string,
    expectedAudience: string,
    publicKeyBytes: Uint8Array,
  ): Promise<TransferPayload | null> {
    try {
      const parts = jwt.split(".");
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, sigB64] = parts;

      const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const sig = new Uint8Array(Buffer.from(sigB64, "base64url"));
      if (!(await verifySig(publicKeyBytes, signingInput, sig))) return null;

      const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
      const now = Math.floor(Date.now() / 1000);
      // Fail closed: a token with no numeric exp has no enforceable expiry.
      if (typeof claims.exp !== "number" || now >= claims.exp) return null;
      if (claims.aud !== expectedAudience) return null;

      return {
        iss: typeof claims.iss === "string" ? claims.iss : "",
        sub: typeof claims.sub === "string" ? claims.sub : "",
        aud: typeof claims.aud === "string" ? claims.aud : "",
        iat: typeof claims.iat === "number" ? claims.iat : 0,
        exp: claims.exp,
        characterHash: typeof claims.characterHash === "string" ? claims.characterHash : "",
        targetRoom: typeof claims.targetRoom === "string" ? claims.targetRoom : "",
      };
    } catch {
      return null;
    }
  }

  async signAttestation(playerDid: string, claims: AttestationClaims): Promise<SignedAttestation> {
    const attestation: SignedAttestation = {
      iss: this.did,
      sub: playerDid,
      iat: Math.floor(Date.now() / 1000),
      claims,
      sig: "",
    };

    const { sig: _, ...payload } = attestation;
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const sigBytes = await this.requireSigningKey().sign(data);
    attestation.sig = Buffer.from(sigBytes).toString("base64url");

    return attestation;
  }

  async verifyAttestation(attestation: SignedAttestation): Promise<boolean> {
    return this.verifyAttestationWithKey(attestation, this.requireSigningKey().publicKeyBytes());
  }

  async verifyRemoteAttestation(
    attestation: SignedAttestation,
    publicKeyBytes: Uint8Array,
  ): Promise<boolean> {
    return this.verifyAttestationWithKey(attestation, publicKeyBytes);
  }

  private async verifyAttestationWithKey(
    attestation: SignedAttestation,
    publicKeyBytes: Uint8Array,
  ): Promise<boolean> {
    try {
      const { sig, ...payload } = attestation;
      const data = new TextEncoder().encode(JSON.stringify(payload));
      const sigBytes = Buffer.from(sig, "base64url");
      return verifySig(publicKeyBytes, data, sigBytes);
    } catch {
      return false;
    }
  }

  getPublicKeyBytes(): Uint8Array {
    return this.requireSigningKey().publicKeyBytes();
  }
}
