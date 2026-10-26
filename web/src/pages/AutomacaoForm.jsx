import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import AccountSelect from '../components/AccountSelect.jsx';

const blank = {
  account_id: '',
  nome: '',
  gatilho: 'comentario',
  escopo: 'todos',
  media_ids: [],
  post_id: null,
  ativo: true,
  keywords: [{ palavra: '', modo: 'contem' }],
  resposta_publica: { variacoes: ['Te mandei no direct! 📩', 'Corre lá na DM 😉', 'Enviado! Confere o direct.'] },
  dm: { texto: 'Oi! Aqui está o link: {link}\n\nQuer que eu te mande o material completo também?' },
  botao: null,
  exigir_seguir: null,
  material: null,
  link_url: '',
};

function Toggle({ label, checked, onChange, children }) {
  return (
    <fieldset className={checked ? 'on' : ''}>
      <legend>
        <label className="inline">
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
        </label>
      </legend>
      {checked && children}
    </fieldset>
  );
}

export default function AutomacaoForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(blank);
  const [scope, setScope] = useState('todos'); // todos | lista | post
  const [error, setError] = useState('');

  const { data: existing } = useQuery({ queryKey: ['automation', id], queryFn: () => api(`/automations/${id}`), enabled: !!id });
  const { data: posts = [] } = useQuery({ queryKey: ['posts'], queryFn: () => api('/posts') });

  useEffect(() => {
    if (!existing) return;
    setForm({ ...blank, ...existing, link_url: existing.link_url || '' });
    setScope(existing.post_id && !existing.media_ids.length ? 'post' : existing.escopo);
  }, [existing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isComment = form.gatilho === 'comentario';

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        escopo: scope === 'todos' ? 'todos' : 'lista',
        media_ids: scope === 'lista' ? form.media_ids : scope === 'post' ? form.media_ids : [],
        post_id: scope === 'post' ? form.post_id : null,
        keywords: form.keywords.filter((k) => k.palavra.trim()),
        link_url: form.link_url || null,
        resposta_publica: isComment && form.resposta_publica ? form.resposta_publica : null,
        exigir_seguir: isComment ? form.exigir_seguir : null,
        material: isComment ? form.material : null,
      };
      return id ? api(`/automations/${id}`, { method: 'PUT', body }) : api('/automations', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      navigate('/automacoes');
    },
    onError: (err) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: () => api(`/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      navigate('/automacoes');
    },
  });

  const keyword = (i, patch) => set('keywords', form.keywords.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const scheduled = posts.filter((p) => p.account_id === Number(form.account_id) && ['agendado', 'rascunho'].includes(p.status));

  return (
    <form className="card form" onSubmit={(e) => (e.preventDefault(), setError(''), save.mutate())}>
      <h1>{id ? 'Editar automação' : 'Nova automação'}</h1>

      <div className="grid2">
        <label>
          Nome
          <input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Ebook grátis" required />
        </label>
        <label>
          Conta
          <AccountSelect value={form.account_id} onChange={(v) => set('account_id', v)} />
        </label>
      </div>

      <div className="grid2">
        <label>
          Gatilho
          <select value={form.gatilho} onChange={(e) => set('gatilho', e.target.value)}>
            <option value="comentario">Comentário em post → DM</option>
            <option value="dm">Palavra-chave recebida por DM</option>
            <option value="story">Resposta ou reação a story</option>
          </select>
        </label>
        {isComment && (
          <label>
            Vale para
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="todos">Todos os posts</option>
              <option value="lista">Posts específicos (IDs de mídia)</option>
              <option value="post">Um post agendado (ativa ao publicar)</option>
            </select>
          </label>
        )}
      </div>

      {isComment && scope === 'lista' && (
        <label>
          IDs de mídia (separados por vírgula)
          <input
            value={form.media_ids.join(', ')}
            onChange={(e) => set('media_ids', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          />
        </label>
      )}
      {isComment && scope === 'post' && (
        <label>
          Post agendado
          <select value={form.post_id || ''} onChange={(e) => set('post_id', Number(e.target.value) || null)} required>
            <option value="">Escolha o post</option>
            {scheduled.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id} · {p.tipo} · {(p.legenda || '').slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend>Palavras-chave {form.gatilho === 'story' && <span className="muted">(vazio = qualquer resposta)</span>}</legend>
        {form.keywords.map((k, i) => (
          <div key={i} className="row">
            <input value={k.palavra} onChange={(e) => keyword(i, { palavra: e.target.value })} placeholder="LINK" />
            <select value={k.modo} onChange={(e) => keyword(i, { modo: e.target.value })}>
              <option value="contem">contém</option>
              <option value="exata">exata</option>
            </select>
            <button type="button" className="link" onClick={() => set('keywords', form.keywords.filter((_, j) => j !== i))}>
              remover
            </button>
          </div>
        ))}
        <button type="button" className="secondary small" onClick={() => set('keywords', [...form.keywords, { palavra: '', modo: 'contem' }])}>
          + palavra
        </button>
        <p className="muted small">Comparação sem acento e sem diferenciar maiúsculas.</p>
      </fieldset>

      {isComment && (
        <Toggle
          label="Responder publicamente o comentário"
          checked={!!form.resposta_publica}
          onChange={(on) => set('resposta_publica', on ? blank.resposta_publica : null)}
        >
          <label>
            Variações (uma por linha; o sistema sorteia para não repetir texto)
            <textarea
              rows={3}
              value={form.resposta_publica?.variacoes.join('\n') || ''}
              onChange={(e) => set('resposta_publica', { variacoes: e.target.value.split('\n') })}
            />
          </label>
        </Toggle>
      )}

      <label>
        Link de destino (vira um link curto com contagem de cliques; use {'{link}'} no texto)
        <input type="url" value={form.link_url} onChange={(e) => set('link_url', e.target.value)} placeholder="https://..." />
      </label>
      {form.link && <p className="muted small">Link curto: /l/{form.link.slug} · {form.link.cliques} cliques</p>}

      {isComment && (
        <Toggle
          label="Siga para receber (pede o follow antes de mandar o link)"
          checked={!!form.exigir_seguir}
          onChange={(on) =>
            set(
              'exigir_seguir',
              on
                ? {
                    texto: 'Oi! Me segue e depois toca em "Já sigo" que eu te mando o link 👇',
                    texto_nao_segue: 'Ainda não encontrei o seu follow 🙂 Siga a conta e toque de novo.',
                    botao: 'Já sigo',
                  }
                : null,
            )
          }
        >
          <label>
            Primeira mensagem
            <textarea rows={2} value={form.exigir_seguir?.texto || ''} onChange={(e) => set('exigir_seguir', { ...form.exigir_seguir, texto: e.target.value })} />
          </label>
          <label>
            Se ainda não segue
            <textarea
              rows={2}
              value={form.exigir_seguir?.texto_nao_segue || ''}
              onChange={(e) => set('exigir_seguir', { ...form.exigir_seguir, texto_nao_segue: e.target.value })}
            />
          </label>
        </Toggle>
      )}

      <label>
        {isComment ? (form.exigir_seguir ? 'DM com o link (após confirmar o follow)' : 'Primeira DM (resposta privada)') : 'Resposta na DM'}
        <textarea rows={4} maxLength={1000} value={form.dm.texto} onChange={(e) => set('dm', { texto: e.target.value })} required />
      </label>
      {isComment && !form.exigir_seguir && (
        <p className="muted small">
          A Meta permite uma única DM por comentário. Termine com uma pergunta ou botão: se a pessoa responder, abre a janela de 24h.
        </p>
      )}

      <Toggle label="Adicionar botão" checked={!!form.botao} onChange={(on) => set('botao', on ? { titulo: 'Quero!' } : null)}>
        <label>
          Texto do botão (até 20 caracteres)
          <input maxLength={20} value={form.botao?.titulo || ''} onChange={(e) => set('botao', { titulo: e.target.value })} />
        </label>
        <p className="muted small">
          {isComment && form.material ? 'O clique envia o material abaixo.' : 'O clique abre o link de destino.'}
        </p>
      </Toggle>

      {isComment && (
        <Toggle
          label="Enviar material quando a pessoa responder"
          checked={!!form.material}
          onChange={(on) => set('material', on ? { texto: 'Aqui está o material completo: {link}' } : null)}
        >
          <textarea rows={3} maxLength={1000} value={form.material?.texto || ''} onChange={(e) => set('material', { texto: e.target.value })} />
        </Toggle>
      )}

      <label className="inline">
        <input type="checkbox" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Ativa
      </label>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          Salvar
        </button>
        <button type="button" className="link" onClick={() => navigate('/automacoes')}>
          Cancelar
        </button>
        {id && (
          <button type="button" className="danger" onClick={() => confirm('Excluir esta automação?') && remove.mutate()}>
            Excluir
          </button>
        )}
      </div>
    </form>
  );
}
