'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle } from 'lucide-react';
import { io } from 'socket.io-client';

interface NotificationMessage {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  senderName: string;
  createdAt: string;
}

interface MessageNotificationProps {        
  userId?: string;
  onNewMessageCount?: (count: number) => void;
}

interface AdminNewMessageEvent {
  conversationId: string;
  message: {
    id: string;
    content: string;
    senderId: string;
    createdAt: string;
  };
  unreadCount: number;
  clientName: string;
}

interface AdminUnreadCountEvent {
  totalUnreadCount: number;
  conversations: { conversationId: string; unreadCount: number }[];
}

export default function MessageNotification({ userId = 'admin-user-id', onNewMessageCount }: MessageNotificationProps) {
  const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? userId
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevTotalRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);
  const lastNotifiedIdRef = useRef<string | null>(null);
  const newCountRef = useRef<number>(0);

  useEffect(() => {
    const socket = io({
      path: '/socket.io',
      addTrailingSlash: false,
      auth: { userId: ADMIN_USER_ID },
    });

    socket.on('adminNewMessage', (payload: AdminNewMessageEvent) => {
      const notif: NotificationMessage = {
        id: payload.message.id,
        content: payload.message.content,
        senderId: payload.message.senderId,
        conversationId: payload.conversationId,
        senderName: payload.clientName,
        createdAt: payload.message.createdAt,
      };
      setNotifications(prev => [notif, ...prev]);
      setUnreadCount(prev => {
        const next = prev + 1;
        newCountRef.current = newCountRef.current + 1;
        onNewMessageCount?.(newCountRef.current);
        return next;
      });
      lastNotifiedIdRef.current = notif.id;
      showToast(notif, true);
    });

    socket.on('adminUnreadCount', (payload: AdminUnreadCountEvent) => {
      setUnreadCount(payload.totalUnreadCount);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
    });

    return () => {
      socket.close();
    };
  }, [ADMIN_USER_ID, onNewMessageCount]);

  useEffect(() => {
    const t = window.setInterval(async () => {
      try {
        const res = await fetch('/api/conversations/admin');
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        const total = data.reduce((acc: number, conv: any) => acc + (conv.unreadCount || 0), 0);
        setUnreadCount(total);
        if (!initializedRef.current) {
          initializedRef.current = true;
          prevTotalRef.current = total;
        } else if (total > prevTotalRef.current) {
          const delta = total - prevTotalRef.current;
          prevTotalRef.current = total;
          const latest = data.find((c: any) => c.lastMessage && c.unreadCount > 0)?.lastMessage;
          if (latest) {
            const notif: NotificationMessage = {
              id: latest.id,
              content: latest.content,
              senderId: latest.senderId,
              conversationId: latest.conversationId,
              senderName: 'Client',
              createdAt: latest.createdAt,
            };
            if (lastNotifiedIdRef.current !== notif.id) {
              lastNotifiedIdRef.current = notif.id;
              setNotifications(prev => [notif, ...prev]);
              const isPriority = total - prevTotalRef.current >= 3 || /urgent|important/i.test(notif.content) || (notif.content.match(/!/g) || []).length >= 3;
              showToast(notif, isPriority);
              newCountRef.current = newCountRef.current + delta;
              onNewMessageCount?.(newCountRef.current);
            }
          }
        } else {
          prevTotalRef.current = total;
        }
      } catch {}
    }, 3000);
    return () => window.clearInterval(t);
  }, [ADMIN_USER_ID, onNewMessageCount]);

  const showToast = (message: NotificationMessage, priority = false) => {
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 ${priority ? 'bg-red-600' : 'bg-purple-500'} text-white px-4 py-3 rounded-lg shadow-lg z-50 transform transition-all duration-300 translate-x-full`;
    toast.innerHTML = `
      <div class="flex items-center">
        <div>
          <div class="font-semibold">${message.senderName}</div>
          <div class="text-sm opacity-90">${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}</div>
        </div>
      </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('translate-x-full');
    }, 100);

    setTimeout(() => {
      toast.classList.add('translate-x-full');
      setTimeout(() => {
        if (toast.parentNode) {
          document.body.removeChild(toast);
        }
      }, 300);
    }, priority ? 7000 : 5000);
  };

  const markAsRead = async (notification: NotificationMessage) => {
    try {
      await fetch(`/api/conversations/${notification.conversationId}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: ADMIN_USER_ID })
      });
    } catch {}
    setNotifications(prev => prev.filter(msg => msg.id !== notification.id));
    setUnreadCount(prev => {
      const next = Math.max(0, prev - 1);
      onNewMessageCount?.(next);
      return next;
    });
  };

  const markAllAsRead = async () => {
    const uniqueConversations = Array.from(new Set(notifications.map(n => n.conversationId)));
    for (const conversationId of uniqueConversations) {
      try {
        await fetch(`/api/conversations/${conversationId}/mark-read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: ADMIN_USER_ID })
        });
      } catch {}
    }
    setNotifications([]);
    setUnreadCount(0);
    newCountRef.current = 0;
    onNewMessageCount?.(0);
    setShowNotifications(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className="relative p-2 text-gray-600 hover:text-purple-600 transition-colors"
      >
        <MessageCircle size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Messages</h3>
            {notifications.length > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-purple-600 hover:text-purple-800"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <MessageCircle className="mx-auto mb-2 opacity-50" size={24} />
                <p>Aucun nouveau message</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => markAsRead(notification)}
                >
                  <div className="flex items-start space-x-3">
                    <div className="bg-purple-100 rounded-full p-2">
                      <MessageCircle className="text-purple-600" size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 text-sm">
                        {notification.senderName}
                      </div>
                      <div className="text-gray-600 text-sm mt-1">
                        {notification.content}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(notification.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
