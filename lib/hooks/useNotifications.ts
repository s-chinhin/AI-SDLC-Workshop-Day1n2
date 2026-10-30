'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Todo } from '@/lib/db';
import { REMINDER_LABELS, type ReminderMinutes } from '@/lib/constants';
import { formatSingaporeDate } from '@/lib/timezone';

export const NOTIFICATION_POLL_MS = 30_000;

type PermissionState = NotificationPermission | 'unsupported';

function currentPermission(): PermissionState {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

/**
 * Polls /api/notifications/check while permission is granted. For each due reminder it
 * claims the reminder on the server (which stamps last_notification_sent) and shows a
 * browser notification only if the claim succeeded, so each reminder fires once.
 */
export function useNotifications(onNotified?: (todo: Todo) => void) {
  const [permission, setPermission] = useState<PermissionState>('default');

  // Read the real permission after mount (it isn't available during server render).
  useEffect(() => {
    Promise.resolve().then(() => setPermission(currentPermission()));
  }, []);

  const requestPermission = useCallback(async () => {
    if (currentPermission() === 'unsupported') return;
    setPermission(await Notification.requestPermission());
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;

    let stopped = false;
    const poll = async () => {
      const res = await fetch('/api/notifications/check').catch(() => null);
      if (!res?.ok || stopped) return;
      const { data } = (await res.json()) as { data: Todo[] };
      for (const todo of data) {
        // Re-check every time: permission can be revoked mid-session.
        if (stopped) return;
        if (currentPermission() !== 'granted') {
          setPermission(currentPermission());
          return;
        }
        // Claim first: only one poll (in any tab) wins, so each reminder shows once.
        const claim = await fetch(`/api/notifications/${todo.id}/claim`, { method: 'POST' }).catch(() => null);
        if (!claim?.ok || !(await claim.json()).claimed) continue;

        const when = todo.due_date ? formatSingaporeDate(todo.due_date) : '';
        new Notification(`Reminder: ${todo.title}`, { body: `Due ${when}`, tag: `todo-${todo.id}` });
        onNotified?.(todo);
      }
    };

    poll();
    const timer = setInterval(poll, NOTIFICATION_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [permission, onNotified]);

  return { permission, requestPermission };
}

export function reminderLabel(minutes: number): string {
  return REMINDER_LABELS[minutes as ReminderMinutes] ?? `${minutes}m`;
}
