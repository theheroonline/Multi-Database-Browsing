import type { RedisKeyDetail, RedisSortedSetMember } from "../types";

export function RedisKeyDetailValue({ detail }: { detail: RedisKeyDetail }) {
  if (detail.unsupported) {
    return <pre className="redis-detail-pre">Unsupported key type. Use Redis Console for raw commands.</pre>;
  }

  if (typeof detail.value === "string") {
    return <pre className="redis-detail-pre">{detail.value}</pre>;
  }

  if (Array.isArray(detail.value)) {
    const isZset = detail.value.length > 0 && typeof detail.value[0] === "object" && detail.value[0] !== null && "member" in detail.value[0];
    if (isZset) {
      const rows = detail.value as RedisSortedSetMember[];
      return (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ width: "120px" }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={`${item.member}-${item.score}`}>
                  <td>{item.member}</td>
                  <td>{item.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="redis-value-list">
        {detail.value.map((item, index) => (
          <div key={`${String(item)}-${index}`} className="redis-value-chip">{String(item)}</div>
        ))}
      </div>
    );
  }

  if (detail.value && typeof detail.value === "object") {
    const entries = Object.entries(detail.value);
    return (
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([field, value]) => (
              <tr key={field}>
                <td>{field}</td>
                <td style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <pre className="redis-detail-pre">(empty)</pre>;
}