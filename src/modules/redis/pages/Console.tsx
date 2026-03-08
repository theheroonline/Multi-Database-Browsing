import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "../../../lib/errorLog";
import { useRedisContext } from "../../../state/RedisContext";
import { redisExecute } from "../services/client";

function parseCommandLine(input: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export default function RedisConsolePage() {
  const { t } = useTranslation();
  const { activeRedisConnection, selectedDatabase } = useRedisContext();
  const [commandText, setCommandText] = useState("PING");
  const [output, setOutput] = useState("");
  const [executedCommand, setExecutedCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const database = useMemo(() => selectedDatabase ?? activeRedisConnection?.database ?? 0, [selectedDatabase, activeRedisConnection?.database]);

  const execute = async () => {
    if (!activeRedisConnection) {
      setError(t("redis.console.noConnection"));
      return;
    }

    const parts = parseCommandLine(commandText);
    if (parts.length === 0) {
      setError(t("redis.console.emptyCommand"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [command, ...args] = parts;
      const result = await redisExecute(activeRedisConnection.id, database, command, args);
      setExecutedCommand(result.command);
      setOutput(result.output);
    } catch (err) {
      logError(err, {
        source: "redisConsole.execute",
        message: `Failed to execute Redis command ${commandText}`
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 className="card-title">{t("redis.console.title")}</h3>
          <div className="muted">{activeRedisConnection ? `${activeRedisConnection.name} · DB ${database}` : t("redis.console.noConnection")}</div>
        </div>
        <button className="btn btn-primary" onClick={execute} disabled={loading || !activeRedisConnection}>
          {loading ? t("common.loading") : t("redis.console.execute")}
        </button>
      </div>

      <div className="muted" style={{ marginBottom: "12px" }}>{t("redis.console.help")}</div>

      <textarea
        className="form-control"
        rows={5}
        value={commandText}
        onChange={(event) => setCommandText(event.target.value)}
        placeholder="SCAN 0 MATCH user:* COUNT 50"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}
      />

      {error && <div className="text-danger" style={{ marginTop: "12px" }}>{error}</div>}

      <div style={{ marginTop: "16px" }}>
        <div style={{ fontSize: "12px", color: "#55606f", marginBottom: "8px" }}>{t("redis.console.lastCommand")}: {executedCommand || "-"}</div>
        <pre className="redis-detail-pre" style={{ minHeight: "240px" }}>{output || t("redis.console.noOutput")}</pre>
      </div>
    </div>
  );
}