import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmtDate } from '../api.js';
import AccountSelect from '../components/AccountSelect.jsx';

function messageText(conteudo) {
  return conteudo?.text || conteudo?.attachment?.payload?.text || conteudo?.title || conteudo?.payload || conteudo?.emoji || '';
}

export default function Historico() {
  const [tab, setTab] = useState('comentarios');
  const [account, setAccount] = useState('');
  const qs = account ? `?account_id=${account}` : '';
  const events = useQuery({ queryKey: ['events', account], queryFn: () => api(`/events${qs}`), enabled: tab === 'comentarios', refetchInterval: 10000 });
  const messages = useQuery({ queryKey: ['messages', account], queryFn: () => api(`/messages${qs}`), enabled: tab === 'mensagens', refetchInterval: 10000 });

  return (
    <>
      <header className="page-header">
        <h1>Histórico</h1>
        <AccountSelect value={account} onChange={setAccount} allowAll />
      </header>
      <div className="tabs">
        <button className={tab === 'comentarios' ? 'active' : ''} onClick={() => setTab('comentarios')}>
          Comentários
        </button>
        <button className={tab === 'mensagens' ? 'active' : ''} onClick={() => setTab('mensagens')}>
          Mensagens
        </button>
      </div>
      <div className="card">
        {tab === 'comentarios' ? (
          <table>
            <thead>
              <tr>
                <th>Recebido</th>
                <th>Autor</th>
                <th>Comentário</th>
                <th>Automação</th>
                <th>Status</th>
                <th>Respondido</th>
              </tr>
            </thead>
            <tbody>
              {(events.data || []).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDate(e.recebido_em)}</td>
                  <td>{e.autor_username ? `@${e.autor_username}` : e.autor_igsid || '—'}</td>
                  <td className="truncate">{e.texto}</td>
                  <td>{e.automacao || '—'}</td>
                  <td>
                    <span className={`badge ${e.status}`} title={e.erro || ''}>
                      {e.status}
                    </span>
                  </td>
                  <td className="nowrap">{fmtDate(e.respondido_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Direção</th>
                <th>Pessoa</th>
                <th>Tipo</th>
                <th>Conteúdo</th>
              </tr>
            </thead>
            <tbody>
              {(messages.data || []).map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{fmtDate(m.enviado_em)}</td>
                  <td>{m.direcao === 'entrada' ? '← entrada' : '→ saída'}</td>
                  <td>{m.username ? `@${m.username}` : m.igsid || '—'}</td>
                  <td>{m.tipo}</td>
                  <td className="truncate">
                    {messageText(m.conteudo)}
                    {m.erro && <div className="error small">{m.erro}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
