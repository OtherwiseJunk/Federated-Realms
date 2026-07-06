import { AtpAgent } from "@atproto/api";
import { Secp256k1Keypair } from "@atproto/crypto";
import { verifySig } from "@atproto/crypto/dist/secp256k1/operations";
import * as jose from "jose";
import type { AtProtoConfig } from "../config.js";
import { NSID } from "@realms/lexicons";

export interface TransferPayload {
  iss: string; // source server DID
  sub: string; // player DID
  aud: string; // target server DID
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
  iss: string; // server DID
  sub: string; // player DID
  iat: number;
  claims: AttestationClaims;
  sig: string; // base64url-encoded signature
}

export class ServerIdentity {
  did = "";
  agent!: AtpAgent;
  private signingKey!: Secp256k1Keypair;
  private jwtPrivateKey!: CryptoKey;

  async initialize(
    config: AtProtoConfig,
    serverName: string,
    serverDescription: string,
  ): Promise<void> {
    this.agent = new AtpAgent({ service: config.pdsUrl });

    // PDS uses .test as handle domain when hostname is localhost
    const handle = config.serverHandle.endsWith(".localhost")
      ? config.serverHandle.replace(/\.localhost$/, ".test")
      : config.serverHandle;

    if (config.serverDid) {
      // Existing server identity — log in
      await this.agent.login({
        identifier: handle,
        password: config.serverPassword,
      });
      this.did = config.serverDid;
      console.log(`   Server identity: ${this.did}`);
    } else {
      // First boot — create server account on co-located PDS
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
        // Account may already exist if SERVER_DID was lost
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

    // Generate signing key for attestations and transfer JWTs
    // Non-fatal: signing key is only needed for federation features
    try {
      await this.initSigningKey();
    } catch (err) {
      console.warn(
        "   Signing key init failed (federation features disabled):",
        err instanceof Error ? err.message : err,
      );
    }

    // Publish server metadata record
    await this.publishServerRecord(config, serverName, serverDescription);
  }

  private async initSigningKey(): Promise<void> {
    // Generate an ephemeral signing key for this server instance
    // In production, this should be loaded from persistent storage
    this.signingKey = await Secp256k1Keypair.create({ exportable: true });

    // Convert to jose-compatible key for JWT operations (transfer tokens)
    await this.initJwtKey();
  }

  private async initJwtKey(): Promise<void> {
    const rawKey = await this.signingKey.export();
    this.jwtPrivateKey = (await jose.importJWK(
      {
        kty: "EC",
        crv: "secp256k1",
        d: Buffer.from(rawKey).toString("base64url"),
        x: Buffer.from(this.signingKey.publicKeyBytes().slice(1, 33)).toString("base64url"),
        y: Buffer.from(this.signingKey.publicKeyBytes().slice(33, 65)).toString("base64url"),
      },
      "ES256K",
    )) as CryptoKey;
  }

  /**
   * Initialize just the signing key (without jose JWT key).
   * Used for testing attestation signing in isolation.
   */
  async initSigningKeyOnly(): Promise<void> {
    this.signingKey = await Secp256k1Keypair.create({ exportable: true });
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

  signTransferToken(payload: TransferPayload): Promise<string> {
    return new jose.SignJWT({
      characterHash: payload.characterHash,
      targetRoom: payload.targetRoom,
    })
      .setProtectedHeader({ alg: "ES256K" })
      .setIssuer(payload.iss)
      .setSubject(payload.sub)
      .setAudience(payload.aud)
      .setIssuedAt(payload.iat)
      .setExpirationTime(payload.exp)
      .sign(this.jwtPrivateKey);
  }

  async verifyTransferToken(
    jwt: string,
    expectedAudience: string,
  ): Promise<TransferPayload | null> {
    return this.verifyTransferTokenWithKey(jwt, expectedAudience, this.jwtPrivateKey);
  }

  /**
   * Verify a transfer JWT signed by a remote server using their public key.
   * The publicKeyBytes should come from the server's federation registration record.
   */
  async verifyRemoteTransferToken(
    jwt: string,
    expectedAudience: string,
    publicKeyBytes: Uint8Array,
  ): Promise<TransferPayload | null> {
    try {
      const jwtPublicKey = await this.importRemotePublicKey(publicKeyBytes);
      return this.verifyTransferTokenWithKey(jwt, expectedAudience, jwtPublicKey);
    } catch {
      return null;
    }
  }

  private async verifyTransferTokenWithKey(
    jwt: string,
    expectedAudience: string,
    key: CryptoKey,
  ): Promise<TransferPayload | null> {
    try {
      const { payload } = await jose.jwtVerify(jwt, key, {
        audience: expectedAudience,
      });

      return {
        iss: payload.iss ?? "",
        sub: payload.sub ?? "",
        aud: typeof payload.aud === "string" ? payload.aud : (payload.aud?.[0] ?? ""),
        iat: payload.iat ?? 0,
        exp: payload.exp ?? 0,
        characterHash: (payload as Record<string, unknown>).characterHash as string,
        targetRoom: (payload as Record<string, unknown>).targetRoom as string,
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

    // Sign the payload (excluding sig field) with the server's secp256k1 key
    const { sig: _, ...payload } = attestation;
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const sigBytes = await this.signingKey.sign(data);
    attestation.sig = Buffer.from(sigBytes).toString("base64url");

    return attestation;
  }

  /**
   * Verify an attestation signature against our own public key.
   */
  async verifyAttestation(attestation: SignedAttestation): Promise<boolean> {
    return this.verifyAttestationWithKey(attestation, this.signingKey.publicKeyBytes());
  }

  /**
   * Verify an attestation signed by a remote server using their public key.
   * The publicKeyBytes should come from the server's federation registration record.
   */
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

  /**
   * Import a remote server's base64url-encoded public key bytes into a CryptoKey
   * suitable for jose JWT verification.
   */
  private async importRemotePublicKey(publicKeyBytes: Uint8Array): Promise<CryptoKey> {
    // secp256k1 uncompressed public key is 65 bytes: 0x04 || x (32) || y (32)
    const x = publicKeyBytes.slice(1, 33);
    const y = publicKeyBytes.slice(33, 65);

    return (await jose.importJWK(
      {
        kty: "EC",
        crv: "secp256k1",
        x: Buffer.from(x).toString("base64url"),
        y: Buffer.from(y).toString("base64url"),
      },
      "ES256K",
    )) as CryptoKey;
  }

  getPublicKeyBytes(): Uint8Array {
    return this.signingKey.publicKeyBytes();
  }
}
