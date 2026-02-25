import { useTranslation } from "react-i18next";
import { useAppContext } from "../../../state/AppContext";

export default function SqlHistory() {
  const { t } = useTranslation();
  const { state, clearHistory } = useAppContext();

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">{t('sqlHistory.title')}</h3>
          <p className="muted" style={{ margin: 0 }}>{t('sqlHistory.description')}</p>
        </div>
        {state.history.length > 0 && (
          <button 
            className="btn btn-sm btn-ghost text-danger" 
            onClick={() => {
              if (window.confirm(t('sqlHistory.clearHistoryConfirm'))) {
                clearHistory();
              }
            }}
          >
            {t('sqlHistory.clearHistory')}
          </button>
        )}
      </div>
      <div className="card-body" style={{ padding: state.history.length === 0 ? '24px' : '0' }}>
        {state.history.length === 0 && <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{t('sqlHistory.noHistory')}</p>}
        {state.history.length > 0 && (
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '200px' }}>{t('sqlHistory.queryTitle')}</th>
                  <th style={{ width: '180px' }}>{t('sqlHistory.queryTime')}</th>
                  <th>{t('sqlHistory.querySql')}</th>
                </tr>
              </thead>
              <tbody>
                {state.history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td style={{ fontSize: '12px', color: '#86868b' }}>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>
                      <pre style={{ 
                        margin: 0, 
                        whiteSpace: 'pre-wrap', 
                        wordBreak: 'break-all',
                        fontSize: '12px',
                        background: '#f5f5f7',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        color: '#48484a',
                        border: '1px solid rgba(0,0,0,0.02)'
                      }}>{item.sql}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
