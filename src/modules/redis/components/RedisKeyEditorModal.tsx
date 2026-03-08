import { Modal } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
    RedisHashEditorRow,
    RedisKeyDetail,
    RedisKeyType,
    RedisListEditorRow,
    RedisSetKeyRequest,
    RedisZsetEditorRow,
} from "../types";
import {
    buildRedisEditorValue,
    createEmptyHashRow,
    createEmptyListRow,
    createEmptyZsetRow,
    editableKeyTypes,
    getDefaultEditorValue,
    getEditorHint,
    getEditorStateFromDetail,
} from "../utils";

type EditorValueState = string | RedisHashEditorRow[] | RedisListEditorRow[] | RedisZsetEditorRow[];

interface RedisKeyEditorModalProps {
  open: boolean;
  mode: "create" | "edit";
  detail: RedisKeyDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (request: RedisSetKeyRequest) => Promise<void>;
}

export function RedisKeyEditorModal({ open, mode, detail, loading, error, onClose, onSubmit }: RedisKeyEditorModalProps) {
  const { t } = useTranslation();
  const [keyName, setKeyName] = useState("");
  const [keyType, setKeyType] = useState<RedisKeyType>("string");
  const [ttlEnabled, setTtlEnabled] = useState(false);
  const [ttlMs, setTtlMs] = useState("");
  const [valueState, setValueState] = useState<EditorValueState>("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === "edit" && detail) {
      setKeyName(detail.name);
      setKeyType(detail.keyType as RedisKeyType);
      setTtlEnabled(detail.ttlMs !== null);
      setTtlMs(detail.ttlMs === null ? "" : String(detail.ttlMs));
      setValueState(getEditorStateFromDetail(detail) as EditorValueState);
    } else {
      setKeyName("");
      setKeyType("string");
      setTtlEnabled(false);
      setTtlMs("");
      setValueState("");
    }
    setLocalError("");
  }, [open, mode, detail]);

  const keyTypeHint = useMemo(() => getEditorHint(t, keyType), [keyType, t]);

  const handleTypeChange = (nextType: RedisKeyType) => {
    setKeyType(nextType);
    setValueState(getDefaultEditorValue(nextType) as EditorValueState);
  };

  const handleSubmit = async () => {
    const trimmedKey = keyName.trim();
    if (!trimmedKey) {
      setLocalError(t("redis.browser.keyRequired"));
      return;
    }

    let nextTtl: number | null = null;
    if (ttlEnabled) {
      const parsedTtl = Number(ttlMs);
      if (!Number.isFinite(parsedTtl) || parsedTtl < 0) {
        setLocalError(t("redis.browser.invalidTtl"));
        return;
      }
      nextTtl = Math.floor(parsedTtl);
    }

    try {
      const value = buildRedisEditorValue(keyType, valueState);
      setLocalError("");
      await onSubmit({
        key: trimmedKey,
        originalKey: mode === "edit" ? detail?.name : undefined,
        keyType,
        ttlMs: nextTtl,
        value,
        overwrite: mode === "edit",
      });
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  };

  return (
    <Modal
      title={mode === "edit" ? t("redis.browser.editKey") : t("redis.browser.createKey")}
      open={open}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      okText={mode === "edit" ? t("redis.browser.saveKey") : t("redis.browser.createKey")}
      cancelText={t("common.cancel")}
      confirmLoading={loading}
      width={860}
    >
      <div className="redis-editor-grid">
        <div>
          <label>{t("redis.browser.keyName")}</label>
          <input className="form-control" value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="user:1" />
        </div>
        <div>
          <label>{t("redis.browser.type")}</label>
          <select className="form-control" value={keyType} onChange={(event) => handleTypeChange(event.target.value as RedisKeyType)} disabled={mode === "edit"}>
            {editableKeyTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="redis-editor-ttl-row">
          <label className="redis-editor-checkbox-label">
            <input type="checkbox" checked={ttlEnabled} onChange={(event) => setTtlEnabled(event.target.checked)} />
            <span>{t("redis.browser.enableTtl")}</span>
          </label>
          <input className="form-control" type="number" min={0} value={ttlMs} onChange={(event) => setTtlMs(event.target.value)} placeholder={t("redis.browser.ttlMs")} disabled={!ttlEnabled} />
        </div>
        <div className="redis-editor-value-row">
          <label>{t("redis.browser.value")}</label>
          <div className="muted" style={{ marginBottom: "8px" }}>{keyTypeHint}</div>
          <RedisValueEditor keyType={keyType} valueState={valueState} onChange={setValueState} />
        </div>
      </div>
      {(localError || error) && <div className="text-danger" style={{ marginTop: "12px" }}>{localError || error}</div>}
    </Modal>
  );
}

function RedisValueEditor({
  keyType,
  valueState,
  onChange,
}: {
  keyType: RedisKeyType;
  valueState: EditorValueState;
  onChange: (value: EditorValueState) => void;
}) {
  const { t } = useTranslation();

  if (keyType === "string") {
    return (
      <textarea
        className="form-control redis-editor-textarea"
        rows={12}
        value={typeof valueState === "string" ? valueState : ""}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    );
  }

  if (keyType === "hash") {
    const rows = Array.isArray(valueState) ? valueState as RedisHashEditorRow[] : [createEmptyHashRow()];
    return (
      <div className="redis-editor-table-wrapper">
        <table className="table redis-editor-table">
          <thead>
            <tr>
              <th>{t("redis.browser.fieldColumn")}</th>
              <th>{t("redis.browser.valueColumn")}</th>
              <th style={{ width: "84px" }}>{t("redis.browser.actionsColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><input className="form-control" value={row.field} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, field: event.target.value } : item))} /></td>
                <td><input className="form-control" value={row.value} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} /></td>
                <td><button className="btn btn-sm btn-ghost text-danger" onClick={() => onChange(rows.length > 1 ? rows.filter((item) => item.id !== row.id) : [createEmptyHashRow()])}>{t("common.delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost" onClick={() => onChange([...rows, createEmptyHashRow()])}>+ {t("redis.browser.addRow")}</button>
      </div>
    );
  }

  if (keyType === "zset") {
    const rows = Array.isArray(valueState) ? valueState as RedisZsetEditorRow[] : [createEmptyZsetRow()];
    return (
      <div className="redis-editor-table-wrapper">
        <table className="table redis-editor-table">
          <thead>
            <tr>
              <th>{t("redis.browser.memberColumn")}</th>
              <th style={{ width: "180px" }}>{t("redis.browser.scoreColumn")}</th>
              <th style={{ width: "84px" }}>{t("redis.browser.actionsColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><input className="form-control" value={row.member} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, member: event.target.value } : item))} /></td>
                <td><input className="form-control" value={row.score} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, score: event.target.value } : item))} /></td>
                <td><button className="btn btn-sm btn-ghost text-danger" onClick={() => onChange(rows.length > 1 ? rows.filter((item) => item.id !== row.id) : [createEmptyZsetRow()])}>{t("common.delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost" onClick={() => onChange([...rows, createEmptyZsetRow()])}>+ {t("redis.browser.addRow")}</button>
      </div>
    );
  }

  const rows = Array.isArray(valueState) ? valueState as RedisListEditorRow[] : [createEmptyListRow()];
  return (
    <div className="redis-editor-table-wrapper">
      <table className="table redis-editor-table">
        <thead>
          <tr>
            <th style={{ width: "72px" }}>#</th>
            <th>{t("redis.browser.valueColumn")}</th>
            <th style={{ width: "84px" }}>{t("redis.browser.actionsColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td><input className="form-control" value={row.value} onChange={(event) => onChange(rows.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))} /></td>
              <td><button className="btn btn-sm btn-ghost text-danger" onClick={() => onChange(rows.length > 1 ? rows.filter((item) => item.id !== row.id) : [createEmptyListRow()])}>{t("common.delete")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn btn-ghost" onClick={() => onChange([...rows, createEmptyListRow()])}>+ {t("redis.browser.addRow")}</button>
    </div>
  );
}