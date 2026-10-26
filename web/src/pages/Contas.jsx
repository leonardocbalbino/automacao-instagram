import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';

export default function Contas() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => api('/accounts') });

  const connect = useMutation({
    mutationFn: () => api('/accounts/connect-url'),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const remove = useMutation({
    mutationFn: (id) => api(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  return (
    <>
      <header className="page-header">
        <h1>Contas do Instagram</h1>
        <button onClick={() => connect.mutate()} disabled={connect.isPending}>
          Conectar conta
        </button>
      </header>
      {params.get('ok') && <p className="success">Conta @{params.get('ok')} conectada.</p>}
      {params.get('erro') && <p className="error">{params.get('erro')}</p>}
      {connect.error && <p className="error">{connect.error.message}</p>}
      <p className="muted">
        A conta precisa ser profissional (Business ou Creator). Enquanto o app não passa no App Review, só contas
        adicionadas como testadoras no Meta for Developers conseguem conectar.
      </p>
      <div className="card">
        {isLoading ? (
          <p>Carregando…</p>
        ) : !accounts.length ? (
          <p className="muted">Nenhuma conta conectada.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Status</th>
                <th>Token vence em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>@{a.username}</td>
                  <td>
                    <span className={`badge ${a.status}`}>{a.status}</span>
                  </td>
                  <td>{fmtDate(a.token_expira_em)}</td>
                  <td className="right">
                    <button
                      className="danger small"
                      onClick={() => confirm(`Remover @${a.username} e todos os dados dela?`) && remove.mutate(a.id)}
                    >
                      Remover
                    </button>
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
