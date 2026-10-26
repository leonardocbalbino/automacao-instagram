import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

const GATILHOS = { comentario: 'Comentário → DM', dm: 'Palavra na DM', story: 'Resposta a story' };

export default function Automacoes() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['automations'], queryFn: () => api('/automations') });
  const toggle = useMutation({
    mutationFn: (id) => api(`/automations/${id}/toggle`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  return (
    <>
      <header className="page-header">
        <h1>Automações</h1>
        <Link className="button" to="/automacoes/nova">
          Nova automação
        </Link>
      </header>
      <div className="card">
        {isLoading ? (
          <p>Carregando…</p>
        ) : !data.length ? (
          <p className="muted">Crie a primeira regra: quem comentar uma palavra-chave recebe o link por DM.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Conta</th>
                <th>Gatilho</th>
                <th>Palavras</th>
                <th className="right">Disparos</th>
                <th className="right">Cliques</th>
                <th>Ativa</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/automacoes/${a.id}`}>{a.nome}</Link>
                  </td>
                  <td>@{a.username}</td>
                  <td>{GATILHOS[a.gatilho]}</td>
                  <td className="truncate">{a.palavras || '—'}</td>
                  <td className="right">{a.disparos}</td>
                  <td className="right">{a.cliques}</td>
                  <td>
                    <input type="checkbox" checked={a.ativo} onChange={() => toggle.mutate(a.id)} />
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
