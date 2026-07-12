import React from 'react'
window.__buildVersion = '2.0.1';
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister().then(success => {
        if (success) {
          console.log('[Service Worker] Unregistered successfully to clear cache.');
          window.location.reload();
        }
      });
    }
  });
}

