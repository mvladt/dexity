import React from 'react';
import ReactDOM from 'react-dom/client';
import { configure } from '@gravity-ui/uikit';
import App from './App';
import '@gravity-ui/uikit/styles/fonts.css';
import '@gravity-ui/uikit/styles/styles.css';
import '@gravity-ui/aikit/styles';
import './styles.css';

configure({ lang: 'ru' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
