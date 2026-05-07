import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextInput, Text } from '@gravity-ui/uikit';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';

export function LoginPage() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setStoreToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.post<{ ok: boolean }>('/api/auth/verify', { token });
      setStoreToken(token);
      navigate('/chat');
    } catch {
      setError('Неверный токен');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-form">
        <Text variant="header-2">Войти в Dexity</Text>
        <TextInput
          value={token}
          onUpdate={setToken}
          type="password"
          placeholder="Токен доступа"
          size="l"
          disabled={loading}
          autoComplete="current-password"
          autoFocus
        />
        {error && <Text color="danger">{error}</Text>}
        <Button type="submit" view="action" size="l" loading={loading} disabled={!token.trim()}>
          Войти
        </Button>
      </form>
    </div>
  );
}
