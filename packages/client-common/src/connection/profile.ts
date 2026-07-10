export interface SavedProfile {
  handle: string;
  did: string;
  pdsUrl: string;
  lastServer?: string;
  lastServerName?: string;
  /** Game-server bearer token — only valid for lastServer. */
  authToken?: string;
}
