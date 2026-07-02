import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { installStartupDebug, logStartupDebug } from '../debug/startupDebug';
import { installUiSurfaceModeApi } from './uiSurfaceMode';

installStartupDebug();
installUiSurfaceModeApi();
logStartupDebug('main:entry', { readyState: document.readyState });

logStartupDebug('react:render:start');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
logStartupDebug('react:render:scheduled');
