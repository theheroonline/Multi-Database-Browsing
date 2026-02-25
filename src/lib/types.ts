export type AuthType = "none" | "basic" | "apiKey";
export type EngineType = "elasticsearch";

export interface SshTunnelConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  username?: string;
}

export interface SecretConfig {
  username?: string;
  password?: string;
  apiKey?: string;
  sshPassword?: string;
}

export interface EsConnection {
  id: string;
  name: string;
  engine: EngineType;
  baseUrl: string;
  authType: AuthType;
  username?: string;
  password?: string;
  apiKey?: string;
  verifyTls: boolean;
  ssh?: SshTunnelConfig;
  sshPassword?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: EngineType;
  baseUrl: string;
  authType: AuthType;
  verifyTls: boolean;
  ssh?: SshTunnelConfig;
}

export interface IndexMeta {
  index: string;
  health?: string;
  docsCount?: string;
}

export interface QueryHistoryItem {
  id: string;
  title: string;
  sql: string;
  createdAt: string;
}

export interface LocalState {
  profiles: ConnectionProfile[];
  secrets: Record<string, SecretConfig>;
  history: QueryHistoryItem[];
  lastConnectionId?: string;
  selectedIndex?: string;
}
