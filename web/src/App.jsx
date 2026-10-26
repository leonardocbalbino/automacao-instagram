import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from './api.js';
import Login from './pages/Login.jsx';
import Contas from './pages/Contas.jsx';
import Posts from './pages/Posts.jsx';
import Automacoes from './pages/Automacoes.jsx';
import AutomacaoForm from './pages/AutomacaoForm.jsx';
import Historico from './pages/Historico.jsx';
import Metricas from './pages/Metricas.jsx';
import Privacidade from './pages/Privacidade.jsx';

function Layout({ children }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = () => {
    auth.set(null);
    qc.clear();
    navigate('/login');
  };
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Automação IG</div>
        <nav>
          <NavLink to="/metricas">Métricas</NavLink>
          <NavLink to="/automacoes">Automações</NavLink>
          <NavLink to="/posts">Posts</NavLink>
          <NavLink to="/historico">Histórico</NavLink>
          <NavLink to="/contas">Contas</NavLink>
        </nav>
        <button className="link" onClick={logout}>
          Sair
        </button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

function Private({ children }) {
  if (!auth.token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/privacidade" element={<Privacidade />} />
      <Route path="/metricas" element={<Private><Metricas /></Private>} />
      <Route path="/automacoes" element={<Private><Automacoes /></Private>} />
      <Route path="/automacoes/nova" element={<Private><AutomacaoForm /></Private>} />
      <Route path="/automacoes/:id" element={<Private><AutomacaoForm /></Private>} />
      <Route path="/posts" element={<Private><Posts /></Private>} />
      <Route path="/historico" element={<Private><Historico /></Private>} />
      <Route path="/contas" element={<Private><Contas /></Private>} />
      <Route path="*" element={<Navigate to="/metricas" replace />} />
    </Routes>
  );
}
