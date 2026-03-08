import { Modal } from "antd";
import { useTranslation } from "react-i18next";
import { useErrorLog } from "../lib/errorLog";

interface ErrorLogModalProps {
  open: boolean;
  onClose: () => void;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function ErrorLogModal({ open, onClose }: ErrorLogModalProps) {
  const { t } = useTranslation();
  const { entries, clear } = useErrorLog();

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      title={t("errorLog.title")}
    >
      <div className="error-log-modal">
        <div className="error-log-toolbar">
          <div className="muted">
            {t("errorLog.total", { count: entries.length })}
          </div>
          <div className="button-group">
            <button className="btn btn-sm btn-ghost" onClick={clear} disabled={entries.length === 0}>
              {t("errorLog.clear")}
            </button>
            <button className="btn btn-sm btn-primary" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="error-log-empty">{t("errorLog.empty")}</div>
        ) : (
          <div className="error-log-list">
            {entries.map((entry) => (
              <section key={entry.id} className="error-log-entry">
                <div className="error-log-entry-head">
                  <div>
                    <div className="error-log-entry-message">{entry.message}</div>
                    <div className="error-log-entry-meta">
                      <span>{entry.source}</span>
                      <span>{formatTimestamp(entry.timestamp)}</span>
                    </div>
                  </div>
                </div>
                {entry.detail && <pre className="error-log-entry-detail">{entry.detail}</pre>}
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}