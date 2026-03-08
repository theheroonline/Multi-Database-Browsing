import { Modal } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface RedisKeyDeleteModalProps {
  open: boolean;
  keys: string[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}

export function RedisKeyDeleteModal({ open, keys, loading, error, onClose, onSubmit }: RedisKeyDeleteModalProps) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (open) {
      setConfirmText("");
    }
  }, [open]);

  const isBatch = keys.length > 1;
  const previewKeys = keys.slice(0, 5);
  const canSubmit = confirmText === "DELETE" && keys.length > 0;

  return (
    <Modal
      title={isBatch ? t("redis.browser.deleteKeys") : t("redis.browser.deleteKey")}
      open={open}
      onOk={() => void onSubmit()}
      onCancel={onClose}
      okText={t("common.delete")}
      cancelText={t("common.cancel")}
      confirmLoading={loading}
      okButtonProps={{ danger: true, disabled: !canSubmit }}
    >
      <div className="redis-delete-modal" style={{ marginTop: "12px" }}>
        <div>{isBatch ? t("redis.browser.deleteBatchConfirm", { count: keys.length }) : t("redis.browser.deleteConfirm", { key: keys[0] ?? "" })}</div>
        {keys.length > 0 && (
          <div className="redis-delete-preview">
            {previewKeys.map((key) => (
              <div key={key} className="redis-delete-preview-item">{key}</div>
            ))}
            {keys.length > previewKeys.length && <div className="muted">{t("redis.browser.moreKeys", { count: keys.length - previewKeys.length })}</div>}
          </div>
        )}
        <div className="muted">{t("redis.browser.deleteTypeToConfirm")}</div>
        <input
          className="form-control"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder="DELETE"
        />
        {error && <div className="text-danger">{error}</div>}
      </div>
    </Modal>
  );
}