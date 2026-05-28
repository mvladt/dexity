import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, Text, TextInput } from '@gravity-ui/uikit';
import { ArrowRight, ArrowRightFromSquare, Book } from '@gravity-ui/icons';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';

const REPO_URL = 'https://github.com/mvladt/dexity';

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
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">D</div>
          <Text variant="display-1" as="h1">
            Войти в Dexity
          </Text>
          <Text variant="body-2" color="secondary">
            Персональный AI-чат на Yandex Cloud
          </Text>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-field__label" htmlFor="access-token">
              Токен доступа
            </label>
            <TextInput
              id="access-token"
              value={token}
              onUpdate={setToken}
              type="password"
              placeholder="••••••••••••••••"
              size="l"
              disabled={loading}
              autoComplete="current-password"
              autoFocus
              validationState={error ? 'invalid' : undefined}
            />
            {error ? (
              <span className="login-field__error">{error}</span>
            ) : (
              <span className="login-field__hint">
                ACCESS_TOKEN из <code>server/.env</code>
              </span>
            )}
          </div>
          <Button
            type="submit"
            view="action"
            size="l"
            width="max"
            loading={loading}
            disabled={!token.trim()}
          >
            <Icon data={ArrowRight} size={16} />
            Войти
          </Button>
        </form>

        <div className="login-divider">или</div>

        <div className="login-extras">
          <Button
            view="outlined"
            size="l"
            width="max"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon data={Book} size={14} />
            Документация
          </Button>
          <Button
            view="flat"
            size="l"
            width="max"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon data={ArrowRightFromSquare} size={14} />
            GitHub репозиторий
          </Button>
        </div>

        <div className="login-footer">
          Dexity v0.1 · Open Source ·{' '}
          <a href="https://yandex.cloud/ru/services/yandexgpt" target="_blank" rel="noopener noreferrer">
            Yandex Cloud AI Studio
          </a>
        </div>
      </div>
    </div>
  );
}
