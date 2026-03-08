import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "../../../lib/errorLog";
import { useRedisContext } from "../../../state/RedisContext";
import { RedisKeyDeleteModal } from "../components/RedisKeyDeleteModal";
import { RedisKeyDetailValue } from "../components/RedisKeyDetailValue";
import { RedisKeyEditorModal } from "../components/RedisKeyEditorModal";
import { RedisKeyTtlModal } from "../components/RedisKeyTtlModal";
import { redisDeleteKey, redisDeleteKeys, redisGetKeyDetail, redisListDatabases, redisScanKeys, redisSetKey, redisUpdateKeyTtl } from "../services/client";
import type { RedisSetKeyRequest } from "../types";
import { formatTtl, isEditableKeyType } from "../utils";

const SCAN_COUNT_OPTIONS = [100, 200, 500];

export default function RedisBrowserPage() {
  const { t } = useTranslation();
  const {
    activeRedisConnection,
    databases,
    setDatabases,
    selectedDatabase,
    setSelectedDatabase,
    keyPattern,
    setKeyPattern,
    scannedKeys,
    setScannedKeys,
    nextCursor,
    setNextCursor,
    hasMoreKeys,
    setHasMoreKeys,
    selectedKey,
    setSelectedKey,
    selectedKeyDetail,
    setSelectedKeyDetail,
  } = useRedisContext();
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedKeyNames, setSelectedKeyNames] = useState<string[]>([]);
  const [scanCount, setScanCount] = useState(100);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [ttlModalOpen, setTtlModalOpen] = useState(false);
  const [ttlSaving, setTtlSaving] = useState(false);
  const [ttlError, setTtlError] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
  const [liveTtlMs, setLiveTtlMs] = useState<number | null>(null);
  const [error, setError] = useState("");

  const currentDatabase = selectedDatabase ?? activeRedisConnection?.database ?? 0;

  const loadDatabases = useCallback(async () => {
    if (!activeRedisConnection) {
      return;
    }

    setLoadingDatabases(true);
    setError("");
    try {
      const items = await redisListDatabases(activeRedisConnection.id);
      setDatabases(items);
      if (selectedDatabase === null) {
        setSelectedDatabase(activeRedisConnection.database);
      }
    } catch (err) {
      logError(err, {
        source: "redisBrowser.loadDatabases",
        message: `Failed to load Redis databases for ${activeRedisConnection.name}`
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDatabases(false);
    }
  }, [activeRedisConnection, selectedDatabase, setDatabases, setSelectedDatabase]);

  const loadKeyDetail = useCallback(async (key: string) => {
    if (!activeRedisConnection) {
      return;
    }

    setLoadingDetail(true);
    setError("");
    try {
      const detail = await redisGetKeyDetail(activeRedisConnection.id, currentDatabase, key);
      setSelectedKey(key);
      setSelectedKeyDetail(detail);
    } catch (err) {
      logError(err, {
        source: "redisBrowser.loadKeyDetail",
        message: `Failed to load Redis key detail ${key}`
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, [activeRedisConnection, currentDatabase, setSelectedKey, setSelectedKeyDetail]);

  const loadKeys = useCallback(async (reset: boolean, preferredKey?: string | null) => {
    if (!activeRedisConnection) {
      return;
    }

    setLoadingKeys(true);
    setError("");
    try {
      const result = await redisScanKeys(
        activeRedisConnection.id,
        currentDatabase,
        keyPattern || "*",
        reset ? "0" : nextCursor,
        scanCount,
      );

      const nextItems = result.items;
      const nextNames = new Set(nextItems.map((item) => item.name));
      const nextSelectedKey = preferredKey ?? (nextNames.has(selectedKey ?? "") ? selectedKey : result.items[0]?.name ?? null);

      setScannedKeys(nextItems);
      setNextCursor(result.nextCursor);
      setHasMoreKeys(result.hasMore);
      setSelectedKeyNames((current) => current.filter((item) => nextNames.has(item)));
      setSelectedKey(nextSelectedKey);
      setSelectedKeyDetail(null);

      if (nextSelectedKey) {
        void loadKeyDetail(nextSelectedKey);
      }
    } catch (err) {
      logError(err, {
        source: "redisBrowser.loadKeys",
        message: `Failed to scan Redis keys in DB ${currentDatabase}`
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingKeys(false);
    }
  }, [activeRedisConnection, currentDatabase, keyPattern, nextCursor, scanCount, selectedKey, setScannedKeys, setNextCursor, setHasMoreKeys, setSelectedKey, setSelectedKeyDetail, loadKeyDetail]);

  useEffect(() => {
    if (!activeRedisConnection) {
      return;
    }

    void loadDatabases();
  }, [activeRedisConnection?.id]);

  useEffect(() => {
    if (!activeRedisConnection) {
      return;
    }

    void loadKeys(true);
  }, [activeRedisConnection?.id, currentDatabase, scanCount]);

  useEffect(() => {
    setLiveTtlMs(selectedKeyDetail?.ttlMs ?? null);
  }, [selectedKeyDetail?.name, selectedKeyDetail?.ttlMs]);

  useEffect(() => {
    if (liveTtlMs === null || liveTtlMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setLiveTtlMs((current) => {
        if (current === null) {
          return null;
        }

        return current <= 1000 ? 0 : current - 1000;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [liveTtlMs]);

  const databaseOptions = useMemo(() => {
    if (databases.length > 0) {
      return databases;
    }

    return [{ index: currentDatabase, label: `DB${currentDatabase}`, keyCount: undefined, isDefault: true }];
  }, [databases, currentDatabase]);

  const allVisibleSelected = scannedKeys.length > 0 && scannedKeys.every((item) => selectedKeyNames.includes(item.name));
  const ttlButtonValue = liveTtlMs === null ? -1 : Math.max(0, Math.ceil(liveTtlMs / 1000));

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorError("");
    setEditorSaving(false);
  };

  const openCreateEditor = () => {
    setEditorMode("create");
    setEditorError("");
    setEditorOpen(true);
  };

  const openEditEditor = () => {
    if (!selectedKeyDetail || !isEditableKeyType(selectedKeyDetail.keyType)) {
      return;
    }

    setEditorMode("edit");
    setEditorError("");
    setEditorOpen(true);
  };

  const handleSaveEditor = async (request: RedisSetKeyRequest) => {
    if (!activeRedisConnection) {
      return;
    }

    setEditorSaving(true);
    setEditorError("");

    try {
      await redisSetKey(activeRedisConnection.id, currentDatabase, request);
      closeEditor();
      await loadDatabases();
      await loadKeys(true, request.key);
    } catch (err) {
      logError(err, {
        source: "redisBrowser.saveKey",
        message: `Failed to save Redis key ${request.key}`,
        detail: { mode: editorMode, database: currentDatabase, keyType: request.keyType }
      });
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditorSaving(false);
    }
  };

  const closeTtlModal = () => {
    setTtlModalOpen(false);
    setTtlError("");
    setTtlSaving(false);
  };

  const handleSaveTtl = async (ttlMs: number | null) => {
    if (!activeRedisConnection || !selectedKeyDetail) {
      return;
    }

    setTtlSaving(true);
    setTtlError("");

    try {
      await redisUpdateKeyTtl(activeRedisConnection.id, currentDatabase, {
        key: selectedKeyDetail.name,
        ttlMs,
      });
      closeTtlModal();
      await loadDatabases();
      await loadKeys(true, selectedKeyDetail.name);
    } catch (err) {
      logError(err, {
        source: "redisBrowser.updateTtl",
        message: `Failed to update Redis TTL ${selectedKeyDetail.name}`,
        detail: { database: currentDatabase, ttlMs }
      });
      setTtlError(err instanceof Error ? err.message : String(err));
    } finally {
      setTtlSaving(false);
    }
  };

  const openDeleteModal = (keys: string[]) => {
    const validKeys = keys.filter(Boolean);
    if (validKeys.length === 0) {
      return;
    }

    setDeleteTargets(validKeys);
    setDeleteError("");
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteError("");
    setDeleteSaving(false);
    setDeleteTargets([]);
  };

  const handleDeleteKeys = async () => {
    if (!activeRedisConnection || deleteTargets.length === 0) {
      return;
    }

    setDeleteSaving(true);
    setDeleteError("");

    try {
      if (deleteTargets.length === 1) {
        await redisDeleteKey(activeRedisConnection.id, currentDatabase, deleteTargets[0]);
      } else {
        await redisDeleteKeys(activeRedisConnection.id, currentDatabase, deleteTargets);
      }

      const removedSelectedKey = selectedKey !== null && deleteTargets.includes(selectedKey);
      closeDeleteModal();
      setSelectedKeyNames((current) => current.filter((item) => !deleteTargets.includes(item)));
      if (removedSelectedKey) {
        setSelectedKey(null);
        setSelectedKeyDetail(null);
      }
      await loadDatabases();
      await loadKeys(true, removedSelectedKey ? undefined : selectedKey);
    } catch (err) {
      logError(err, {
        source: "redisBrowser.deleteKeys",
        message: `Failed to delete Redis keys (${deleteTargets.length})`,
        detail: { database: currentDatabase, keys: deleteTargets }
      });
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteSaving(false);
    }
  };

  const toggleVisibleSelection = () => {
    if (allVisibleSelected) {
      setSelectedKeyNames((current) => current.filter((item) => !scannedKeys.some((key) => key.name === item)));
      return;
    }

    const merged = new Set(selectedKeyNames);
    for (const item of scannedKeys) {
      merged.add(item.name);
    }
    setSelectedKeyNames(Array.from(merged));
  };

  const toggleKeySelection = (key: string) => {
    setSelectedKeyNames((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  if (!activeRedisConnection) {
    return (
      <div className="card">
        <div className="muted">{t("redis.browser.noConnection")}</div>
      </div>
    );
  }

  return (
    <div className="redis-browser-grid">
      <div className="card redis-browser-panel">
        <div className="card-header redis-toolbar">
          <div>
            <h3 className="card-title">{t("redis.browser.title")}</h3>
            <div className="muted">{activeRedisConnection.name}</div>
          </div>
          <div className="redis-toolbar-actions">
            <button className="btn btn-primary" onClick={openCreateEditor}>
              + {t("redis.browser.newKey")}
            </button>
            <button className="btn btn-ghost text-danger" onClick={() => openDeleteModal(selectedKeyNames)} disabled={selectedKeyNames.length === 0}>
              {t("redis.browser.deleteSelected", { count: selectedKeyNames.length })}
            </button>
            <select className="form-control" value={currentDatabase} onChange={(event) => setSelectedDatabase(Number(event.target.value))}>
              {databaseOptions.map((item) => (
                <option key={item.index} value={item.index}>
                  {item.label}{typeof item.keyCount === "number" ? ` (${item.keyCount})` : ""}
                </option>
              ))}
            </select>
            <select className="form-control redis-scan-count-select" value={scanCount} onChange={(event) => setScanCount(Number(event.target.value))}>
              {SCAN_COUNT_OPTIONS.map((item) => (
                <option key={item} value={item}>{t("redis.browser.batchSize", { count: item })}</option>
              ))}
            </select>
            <input className="form-control" value={keyPattern} onChange={(event) => setKeyPattern(event.target.value)} placeholder={t("redis.browser.patternPlaceholder")} />
            <button className="btn btn-primary" onClick={() => void loadKeys(true)} disabled={loadingKeys}>
              {loadingKeys ? t("common.loading") : t("common.search")}
            </button>
            <button className="btn btn-ghost" onClick={() => void loadDatabases()} disabled={loadingDatabases}>
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {error && <div className="text-danger" style={{ marginBottom: "12px" }}>{error}</div>}
        <div className="redis-batch-hint muted">{t("redis.browser.batchHint", { count: scannedKeys.length, batch: scanCount })}</div>

        <div className="redis-selection-bar">
          <label className="redis-checkbox-label">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} />
            <span>{t("redis.browser.selectVisible")}</span>
          </label>
          <div className="muted">{t("redis.browser.selectedCount", { count: selectedKeyNames.length })}</div>
        </div>

        <div className="table-wrapper redis-key-table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "44px" }} />
                <th>{t("redis.browser.key")}</th>
                <th style={{ width: "110px" }}>{t("redis.browser.type")}</th>
                <th style={{ width: "110px" }}>{t("redis.browser.ttl")}</th>
              </tr>
            </thead>
            <tbody>
              {scannedKeys.map((item) => {
                const checked = selectedKeyNames.includes(item.name);
                return (
                  <tr
                    key={item.name}
                    className={selectedKey === item.name ? "redis-row-active" : undefined}
                    onClick={() => void loadKeyDetail(item.name)}
                    style={{ cursor: "pointer" }}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleKeySelection(item.name)} />
                    </td>
                    <td style={{ wordBreak: "break-all" }}>{item.name}</td>
                    <td><span className="pill">{item.keyType}</span></td>
                    <td>{formatTtl(item.ttlMs)}</td>
                  </tr>
                );
              })}
              {scannedKeys.length === 0 && !loadingKeys && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "32px" }}>
                    {t("redis.browser.emptyKeys")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="redis-toolbar-actions" style={{ marginTop: "12px", justifyContent: "space-between" }}>
          <div className="muted">{t("redis.browser.cursor")}: {nextCursor}</div>
          <button className="btn btn-ghost" onClick={() => void loadKeys(false)} disabled={!hasMoreKeys || loadingKeys}>
            {t("redis.browser.nextBatch")}
          </button>
        </div>
      </div>

      <div className="card redis-browser-panel">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="card-title">{t("redis.browser.detail")}</h3>
            <div className="muted">{selectedKey ?? t("redis.browser.noKeySelected")}</div>
          </div>
          <div className="redis-detail-header-actions">
            {selectedKeyDetail && (
              <div className="redis-meta-list">
                <span className="pill">{selectedKeyDetail.keyType}</span>
                <span className="pill">TTL {formatTtl(selectedKeyDetail.ttlMs)}</span>
                {selectedKeyDetail.encoding && <span className="pill">{selectedKeyDetail.encoding}</span>}
                {typeof selectedKeyDetail.size === "number" && <span className="pill">size {selectedKeyDetail.size}</span>}
              </div>
            )}
            {selectedKeyDetail && <button className="btn btn-ghost redis-ttl-button" onClick={() => setTtlModalOpen(true)} title={t("redis.browser.editTtl")}>TTL {ttlButtonValue}</button>}
            {selectedKeyDetail && isEditableKeyType(selectedKeyDetail.keyType) && <button className="btn btn-ghost" onClick={openEditEditor}>{t("common.edit")}</button>}
            {selectedKeyDetail && <button className="btn btn-ghost text-danger" onClick={() => openDeleteModal([selectedKeyDetail.name])}>{t("common.delete")}</button>}
          </div>
        </div>

        {!selectedKey && <div className="muted">{t("redis.browser.noKeySelected")}</div>}
        {selectedKey && loadingDetail && <div className="muted">{t("common.loading")}</div>}
        {selectedKeyDetail && !isEditableKeyType(selectedKeyDetail.keyType) && <div className="text-warning" style={{ marginBottom: "12px" }}>{t("redis.browser.editUnsupported")}</div>}
        {selectedKeyDetail && (
          <>
            {selectedKeyDetail.truncated && <div className="text-warning" style={{ marginBottom: "12px" }}>{t("redis.browser.truncated")}</div>}
            <RedisKeyDetailValue detail={selectedKeyDetail} />
          </>
        )}
      </div>

      <RedisKeyEditorModal
        open={editorOpen}
        mode={editorMode}
        detail={editorMode === "edit" ? selectedKeyDetail : null}
        loading={editorSaving}
        error={editorError}
        onClose={closeEditor}
        onSubmit={handleSaveEditor}
      />

      <RedisKeyTtlModal
        open={ttlModalOpen}
        currentTtlMs={selectedKeyDetail?.ttlMs ?? null}
        loading={ttlSaving}
        error={ttlError}
        onClose={closeTtlModal}
        onSubmit={handleSaveTtl}
      />

      <RedisKeyDeleteModal
        open={deleteModalOpen}
        keys={deleteTargets}
        loading={deleteSaving}
        error={deleteError}
        onClose={closeDeleteModal}
        onSubmit={handleDeleteKeys}
      />
    </div>
  );
}
