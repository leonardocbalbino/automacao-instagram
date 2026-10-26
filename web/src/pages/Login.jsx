import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, auth } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const { data: setup } = useQuery({ queryKey: ['setup'], queryFn: () => api('/auth/setup') });
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ nome: '', email: '', senha: '' });
  const [error, setError] = useState('');
  const register = mode === 'register' || setup?.needsSetup;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: form });
      auth.set(token);
      navigate('/metricas');
    } catch (err) {
      setError(err.message);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>{register ? 'Criar conta' : 'Entrar'}</h1>
        {setup?.needsSetup && <p className="muted">Primeiro acesso: este usuário será o administrador.</p>}
        {register && (
          <label>
            Nome
            <input value={form.nome} onChange={set('nome')} required />
          </label>
        )}
        <label>
          E-mail
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Senha
          <input type="password" minLength={8} value={form.senha} onChange={set('senha')} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">{register ? 'Criar conta' : 'Entrar'}</button>
        {!setup?.needsSetup && setup?.allowSignup && (
          <button type="button" className="link" onClick={() => setMode(register ? 'login' : 'register')}>
            {register ? 'Já tenho conta' : 'Criar uma conta'}
          </button>
        )}
      </form>
    </div>
  );
}
