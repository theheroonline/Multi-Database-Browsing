import type { EngineType, SshTunnelConfig } from "../../lib/types";

export interface MysqlConnection {
  id: string;
  name: string;
  engine: EngineType;
  host: string;
  port: number;
  database?: string;
  username?: string;
  password?: string;
  ssh?: SshTunnelConfig;
  sshPassword?: string;
}

export interface DatabaseMeta {
  name: string;
}

export interface TableMeta {
  name: string;
}

export interface ColumnMeta {
  field: string;
  type: string;
  null: string;
  key: string;
  default: string | null;
  extra: string;
}
