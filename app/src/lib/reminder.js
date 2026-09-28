import { useEffect } from 'react';
import { useApp, dayTasks } from './store.js';

// A gentle daily reminder. Web apps can only fire it while the app (or its installed
// window) is running; nothing is sent over the network.
export function useReminder() {
  const { settings } = useApp();
  const { on, time } = settings.reminder;
  useEffect(() => {
    if (!on || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const [h, m] = time.split(':').map(Number);
    const next = new Date();
    next.setHours(h, m, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    const timer = setTimeout(async () => {
      if (dayTasks().length) return;
      const reg = await navigator.serviceWorker?.getRegistration();
      const body = 'Today’s revision plan is ready.';
      if (reg) reg.showNotification('Hifdh', { body, icon: `${import.meta.env.BASE_URL}icon.svg`, tag: 'daily' });
      else new Notification('Hifdh', { body });
    }, next - new Date());
    return () => clearTimeout(timer);
  }, [on, time]);
}
