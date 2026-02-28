export type AuthType = "none" | "basic" | "apiKey";
export type EngineType = "elasticsearch" | "mysql";

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

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: EngineType;
  baseUrl: string;
  mysqlHost?: string;
  mysqlPort?: number;
  mysqlDatabase?: string;
  authType: AuthType;
  verifyTls: boolean;
  ssh?: SshTunnelConfig;
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
}
