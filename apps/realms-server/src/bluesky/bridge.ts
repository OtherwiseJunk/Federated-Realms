import { AtpAgent, RichText } from "@atproto/api";
import type { BlueskyConfig, BlueskyPostType } from "../config.js";

interface RoomThread {
  rootUri: string;
  rootCid: string;
  latestUri: string;
  latestCid: string;
  createdAt: number;
}

export interface GameEvent {
  type: BlueskyPostType;
  roomId: string;
  roomTitle: string;
  playerName?: string;
  playerDid?: string;
  text: string;
}

export class BlueskyBridge {
  private agent: AtpAgent;
  private config: BlueskyConfig;
  private roomThreads = new Map<string, RoomThread>();
  private postQueue: GameEvent[] = [];
  private processing = false;
  private authenticated = false;

  constructor(config: BlueskyConfig) {
    this.config = config;
    this.agent = new AtpAgent({ service: config.service });
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      console.log("Bluesky bridge: disabled");
      return;
    }

    if (!this.config.identifier || !this.config.password) {
      console.warn(
        "Bluesky bridge: enabled but no credentials configured (set BSKY_IDENTIFIER and BSKY_PASSWORD)",
      );
      return;
    }

    try {
      await this.agent.login({
        identifier: this.config.identifier,
        password: this.config.password,
      });
      this.authenticated = true;
      console.log(`Bluesky bridge: authenticated as ${this.config.identifier}`);
      console.log(`Bluesky bridge: posting ${this.config.postTypes.join(", ")}`);

      // Start the post processing loop
      this.startProcessing();
    } catch (err) {
      console.error("Bluesky bridge: authentication failed", err);
    }
  }

  /** Queue a game event for posting to Bluesky */
  post(event: GameEvent): void {
    if (!this.authenticated) return;
    if (!this.config.postTypes.includes(event.type)) return;

    this.postQueue.push(event);
  }

  /** Check if player cross-posting is enabled */
  get crossPostEnabled(): boolean {
    return this.config.playerCrossPost;
  }

  get isActive(): boolean {
    return this.authenticated;
  }

  // ── Internal ──

  private startProcessing(): void {
    setInterval(() => this.processQueue(), this.config.throttleMs);
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.postQueue.length === 0) return;
    this.processing = true;

    try {
      const event = this.postQueue.shift()!;
      await this.postEvent(event);
    } catch (err) {
      console.error("Bluesky bridge: post failed", err);
    } finally {
      this.processing = false;
    }
  }

  private async postEvent(event: GameEvent): Promise<void> {
    const thread = await this.getOrCreateRoomThread(event.roomId, event.roomTitle);
    const text = this.formatEventText(event);

    const rt = new RichText({ text });
    await rt.detectFacets(this.agent);

    const response = await this.agent.post({
      text: rt.text,
      facets: rt.facets,
      reply: {
        root: { uri: thread.rootUri, cid: thread.rootCid },
        parent: { uri: thread.latestUri, cid: thread.latestCid },
      },
    });

    // Update thread's latest post for threading
    thread.latestUri = response.uri;
    thread.latestCid = response.cid;
  }

  private async getOrCreateRoomThread(roomId: string, roomTitle: string): Promise<RoomThread> {
    const existing = this.roomThreads.get(roomId);
    const refreshMs = this.config.roomThreadRefreshMinutes * 60 * 1000;

    if (existing && Date.now() - existing.createdAt < refreshMs) {
      return existing;
    }

    // Create a new root post for this room
    const text = `${roomTitle}\n\n— Live from the realm —`;
    const rt = new RichText({ text });
    await rt.detectFacets(this.agent);

    const response = await this.agent.post({
      text: rt.text,
      facets: rt.facets,
    });

    const thread: RoomThread = {
      rootUri: response.uri,
      rootCid: response.cid,
      latestUri: response.uri,
      latestCid: response.cid,
      createdAt: Date.now(),
    };

    this.roomThreads.set(roomId, thread);
    return thread;
  }

  private formatEventText(event: GameEvent): string {
    switch (event.type) {
      case "chat":
        return `${event.playerName}: "${event.text}"`;
      case "shout":
        return `${event.playerName} shouts: "${event.text}"`;
      case "emote":
        return `* ${event.playerName} ${event.text}`;
      case "event":
        return event.text;
      case "narrative":
        return event.text;
      case "movement":
        return event.text;
      case "combat":
        return event.text;
      case "system":
        return event.text;
      default:
        return event.text;
    }
  }
}
