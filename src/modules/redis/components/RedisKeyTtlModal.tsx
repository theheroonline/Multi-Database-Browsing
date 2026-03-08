import { Modal } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface RedisKeyTtlModalProps {
  open: boolean;
  currentTtlMs: number | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (ttlMs: number | null) => Promise<void>;
}

export function RedisKeyTtlModal({ open, currentTtlMs, loading, error, onClose, onSubmit }: RedisKeyTtlModalProps) {
  const { t } = useTranslation();
  const [ttlEnabled, setTtlEnabled] = useState(false);
  const [ttlValue, setTtlValue] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setTtlEnabled(currentTtlMs !== null);
    setTtlValue(currentTtlMs === null ? "" : String(currentTtlMs));
    setLocalError("");
  }, [open, currentTtlMs]);

  const handleSubmit = async () => {
    let nextTtl: number | null = null;
    if (ttlEnabled) {
      const parsedTtl = Number(ttlValue);
      if (!Number.isFinite(parsedTtl) || parsedTtl < 0) {
        setLocalError(t("redis.browser.invalidTtl"));
        return;
      }
      nextTtl = Math.floor(parsedTtl);
    }

    setLocalError("");
    await onSubmit(nextTtl);
  };

  return (
    <Modal
      title={t("redis.browser.editTtl")}
      open={open}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      okText={t("redis.browser.saveTtl")}
      cancelText={t("common.cancel")}
      confirmLoading={loading}
    >
      <div className="redis-editor-ttl-row" style={{ marginTop: "12px" }}>
        <label className="redis-editor-checkbox-label">
          <input type="checkbox" checked={ttlEnabled} onChange={(event) => setTtlEnabled(event.target.checked)} />
          <span>{t("redis.browser.enableTtl")}</span>
        </label>
        <input
          className="form-control"
          type="number"
          min={0}
          value={ttlValue}
          onChange={(event) => setTtlValue(event.target.value)}
          placeholder={t("redis.browser.ttlMs")}
          disabled={!ttlEnabled}
        />
        <div className="muted">{t("redis.browser.ttlHelp")}</div>
      </div>
      {(localError || error) && <div className="text-danger" style={{ marginTop: "12px" }}>{localError || error}</div>}
    </Modal>
  );
}