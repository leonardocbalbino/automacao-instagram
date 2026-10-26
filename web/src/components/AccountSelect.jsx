import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api('/accounts') });
}

export default function AccountSelect({ value, onChange, allowAll = false }) {
  const { data: accounts = [] } = useAccounts();
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} required={!allowAll}>
      {allowAll ? <option value="">Todas as contas</option> : <option value="">Escolha a conta</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          @{a.username}
        </option>
      ))}
    </select>
  );
}
