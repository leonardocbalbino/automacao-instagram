import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '../api.js';
import AccountSelect from '../components/AccountSelect.jsx';

const TIPOS = { imagem: 'Imagem', carrossel: 'Carrossel', reel: 'Reel', story: 'Story' };

function toLocalInput(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Deixa claro quando o post sai: o campo já vem preenchido com daqui a 1h
function whenHint(local) {
  const diff = new Date(local).getTime() - Date.now();
  if (diff <= 60_000) return 'Publica assim que salvar.';
  const min = Math.round(diff / 60_000);
  const rel = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `Publica em ${new Date(local).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} (daqui a ${rel}).`;
}

const empty = () => ({
  account_id: '',
  tipo: 'imagem',
  legenda: '',
  media_urls: [],
  agendado_para: toLocalInput(Date.now() + 3600_000),
});

function PostForm({ initial, onDone }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const upload = async (files) => {
    if (!files.length) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const saved = await api('/uploads', { method: 'POST', form: fd });
      set('media_urls', [...form.media_urls, ...saved]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const save = useMutation({
    mutationFn: (rascunho) => {
      const body = { ...form, rascunho, agendado_para: form.agendado_para ? new Date(form.agendado_para).toISOString() : null };
      return form.id ? api(`/posts/${form.id}`, { method: 'PUT', body }) : api('/posts', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      onDone();
    },
    onError: (err) => setError(err.message),
  });

  return (
    <form className="card" onSubmit={(e) => (e.preventDefault(), save.mutate(false))}>
      <h2>{form.id ? 'Editar post' : 'Novo post'}</h2>
      <div className="grid2">
        <label>
          Conta
          <AccountSelect value={form.account_id} onChange={(v) => set('account_id', v)} />
        </label>
        <label>
          Tipo
          <select value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
            {Object.entries(TIPOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Mídia {form.tipo === 'carrossel' ? '(2 a 10 itens)' : '(1 item)'}
        <input
          type="file"
          multiple={form.tipo === 'carrossel'}
          accept="image/jpeg,image/png,video/mp4,video/quicktime"
          onChange={(e) => upload([...e.target.files])}
        />
      </label>
      {uploading && <p className="muted">Enviando…</p>}
      <div className="thumbs">
        {form.media_urls.map((m, i) => (
          <div key={m.url} className="thumb">
            {m.kind === 'video' ? <video src={m.url} muted /> : <img src={m.url} alt="" />}
            <button type="button" className="danger small" onClick={() => set('media_urls', form.media_urls.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>
      {form.tipo !== 'story' && (
        <label>
          Legenda
          <textarea rows={4} maxLength={2200} value={form.legenda} onChange={(e) => set('legenda', e.target.value)} />
        </label>
      )}
      <label>
        Publicar em
        <input type="datetime-local" value={form.agendado_para} onChange={(e) => set('agendado_para', e.target.value)} />
        {form.agendado_para && <span className="muted small">{whenHint(form.agendado_para)}</span>}
      </label>
      {form.tipo === 'story' && (
        <p className="muted small">
          Imagens de story fora do formato 9:16 são encaixadas em 1080×1920 com fundo desfocado, para não cortar no celular.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={save.isPending || uploading}>
          Agendar
        </button>
        <button type="button" className="secondary" disabled={save.isPending} onClick={() => save.mutate(true)}>
          Salvar rascunho
        </button>
        <button type="button" className="link" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export default function Posts() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const { data: posts = [], isLoading } = useQuery({ queryKey: ['posts'], queryFn: () => api('/posts'), refetchInterval: 15000 });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['posts'] });
  const remove = useMutation({ mutationFn: (id) => api(`/posts/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
  const now = useMutation({ mutationFn: (id) => api(`/posts/${id}/publish-now`, { method: 'POST' }), onSuccess: invalidate });

  return (
    <>
      <header className="page-header">
        <h1>Fila de posts</h1>
        {!editing && <button onClick={() => setEditing(empty())}>Novo post</button>}
      </header>
      {editing && <PostForm key={editing.id || 'novo'} initial={editing} onDone={() => setEditing(null)} />}
      <div className="card">
        {isLoading ? (
          <p>Carregando…</p>
        ) : !posts.length ? (
          <p className="muted">Nenhum post ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Conta</th>
                <th>Tipo</th>
                <th>Legenda</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.publicado_em || p.agendado_para)}</td>
                  <td>@{p.username}</td>
                  <td>{TIPOS[p.tipo]}</td>
                  <td className="truncate">{p.legenda}</td>
                  <td>
                    <span className={`badge ${p.status}`} title={p.erro || ''}>
                      {p.status}
                    </span>
                    {p.erro && <div className="error small">{p.erro}</div>}
                  </td>
                  <td className="right nowrap">
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noreferrer">
                        ver
                      </a>
                    )}
                    {['rascunho', 'agendado', 'falhou'].includes(p.status) && (
                      <>
                        <button
                          className="secondary small"
                          onClick={() => setEditing({ ...p, agendado_para: p.agendado_para ? toLocalInput(p.agendado_para) : '' })}
                        >
                          Editar
                        </button>
                        <button className="secondary small" onClick={() => now.mutate(p.id)}>
                          Publicar já
                        </button>
                        <button className="danger small" onClick={() => confirm('Excluir este post?') && remove.mutate(p.id)}>
                          Excluir
                        </button>
                      </>
                    )}
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
