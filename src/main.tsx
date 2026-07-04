import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: it double-mounts the WebGL map in dev, which doubles tile
// traffic against community tile servers and can stall style loading in
// throttled/background tabs.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
