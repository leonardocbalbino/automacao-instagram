import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import AccountSelect from '../components/AccountSelect.jsx';

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default function Metricas() {
  const [account, setAccount] = useState('');
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ['metrics', account, days],
    queryFn: () => api(`/metrics?days=${days}${account ? `&account_id=${account}` : ''}`),
  });
  const f = data?.funnel;
  const max = Math.max(1, ...(data?.daily || []).map((d) => d.comentarios));

  return (
    <>
      <header className="page-header">
        <h1>Métricas</h1>
        <div className="row">
          <AccountSelect value={account} onChange={setAccount} allowAll />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </div>
      </header>
      {isLoading || !f ? (
        <p>Carregando…</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span>Comentários</span>
              <strong>{f.comentarios}</strong>
            </div>
            <div className="stat">
              <span>Com palavra-chave</span>
              <strong>{f.com_palavra_chave}</strong>
              <small>{pct(f.com_palavra_chave, f.comentarios)} dos comentários</small>
            </div>
            <div className="stat">
              <span>DMs enviadas</span>
              <strong>{f.dms}</strong>
              <small>{pct(f.dms, f.com_palavra_chave)} dos gatilhos</small>
            </div>
            <div className="stat">
              <span>Cliques no link</span>
              <strong>{f.cliques}</strong>
              <small>acumulado · {pct(f.cliques, f.dms)} das DMs</small>
            </div>
            <div className="stat">
              <span>Falhas</span>
              <strong>{f.falhas}</strong>
            </div>
          </div>

          <div className="card">
            <h2>Comentários e DMs por dia</h2>
            {!data.daily.length ? (
              <p className="muted">Sem dados no período.</p>
            ) : (
              <div className="bars">
                {data.daily.map((d) => (
                  <div key={d.dia} className="bar" title={`${d.dia}: ${d.comentarios} comentários, ${d.dms} DMs`}>
                    <div className="bar-total" style={{ height: `${(d.comentarios / max) * 100}%` }}>
                      <div className="bar-dm" style={{ height: `${d.comentarios ? (d.dms / d.comentarios) * 100 : 0}%` }} />
                    </div>
                    <span>{d.dia.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small">
              <span className="legend total" /> comentários <span className="legend dm" /> DMs enviadas
            </p>
          </div>

          <div className="card">
            <h2>Por automação</h2>
            <table>
              <thead>
                <tr>
                  <th>Automação</th>
                  <th>Conta</th>
                  <th className="right">Disparos</th>
                  <th className="right">DMs com link</th>
                  <th className="right">Cliques</th>
                  <th className="right">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {data.byAutomation.map((a) => (
                  <tr key={a.id}>
                    <td>{a.nome}</td>
                    <td>@{a.username}</td>
                    <td className="right">{a.disparos}</td>
                    <td className="right">{a.dms_com_link}</td>
                    <td className="right">{a.cliques}</td>
                    <td className="right">{pct(a.cliques, a.dms_com_link)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
