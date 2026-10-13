import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './v2/App';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
});
