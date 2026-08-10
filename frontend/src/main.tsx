import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StartupGate } from './components/onboarding/StartupGate';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StartupGate>
      {(ready) => <App workshopQueryEnabled={ready} />}
    </StartupGate>
  </React.StrictMode>,
);
