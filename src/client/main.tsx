import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './Home';
import Room from './Room';
import { currentRoute } from './router';
import { clearToken, socket } from './socket';
import './styles.css';

function App(): React.JSX.Element {
  const [r, setR] = useState(currentRoute);
  const routeRef = useRef(r);

  useEffect(() => {
    const onPop = (): void => {
      const prev = routeRef.current;
      const next = currentRoute();
      // Navigating away from a room (back button, Leave) gives up the seat.
      if (prev.view === 'room' && (next.view !== 'room' || next.code !== prev.code)) {
        socket.emit('room:leave');
        clearToken(prev.code);
      }
      routeRef.current = next;
      setR(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return r.view === 'room' ? <Room key={r.code} code={r.code} /> : <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
