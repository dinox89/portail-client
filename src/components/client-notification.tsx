"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface ClientNotificationProps {
  clientId: string;
  conversationId?: string | null;
  onNewMessage?: () => void;
  onPortalUpdate?: (client: any) => void;
}

// Composant headless: aucune UI, uniquement la logique socket
export function ClientNotification({ clientId, conversationId, onNewMessage, onPortalUpdate }: ClientNotificationProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const onNewMessageRef = useRef<(() => void) | undefined>(onNewMessage);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);
  const onPortalUpdateRef = useRef<((client: any) => void) | undefined>(onPortalUpdate);
  useEffect(() => { onPortalUpdateRef.current = onPortalUpdate; }, [onPortalUpdate]);

  useEffect(() => {
    const attempts = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_ATTEMPTS ?? 10);
    const delay = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_DELAY ?? 500);
    const delayMax = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_DELAY_MAX ?? 2000);
    const timeout = Number(process.env.NEXT_PUBLIC_SOCKET_TIMEOUT ?? 8000);

    const fetchToken = async () => {
      try {
        const res = await fetch(`/api/realtime/token?userId=${clientId}`);
        if (res.ok) {
          const data = await res.json();
          return data?.token || null;
        }
      } catch {}
      return null;
    };

    const setup = async () => {
      const token = await fetchToken();
      const newSocket = io({
        path: "/socket.io",
        addTrailingSlash: false,
        auth: token ? { token } : { userId: clientId },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: attempts,
        reconnectionDelay: delay,
        reconnectionDelayMax: delayMax,
        timeout,
      });

    setSocket(newSocket);

    newSocket.on("connect", async () => {
      if (conversationId) {
        newSocket.emit("joinConversation", conversationId);
      } else {
        try {
          const res = await fetch(`/api/conversations/user/${clientId}`);
          if (res.ok) {
            const convs = await res.json();
            if (Array.isArray(convs)) {
              convs.forEach((c: any) => {
                if (c?.id) newSocket.emit("joinConversation", c.id);
              });
            }
          }
        } catch (err) {
          console.warn("ClientNotification: échec fetch conversations", err);
        }
      }
    });

    newSocket.on("newMessage", (message: any) => {
      const isFromOther = message?.senderId !== clientId;
      const isSameConv = conversationId ? message?.conversationId === conversationId : true;
      if (isFromOther && isSameConv) {
        const ts = new Date(message?.createdAt).getTime();
        const key = conversationId || message?.conversationId;
        if (key && ts) {
          lastSeenMapRef.current[key] = Math.max(lastSeenMapRef.current[key] || 0, ts);
        }
        onNewMessageRef.current?.();
      }
    });

    newSocket.on("portalUpdate", (payload: any) => {
      try {
        if (payload?.userId === clientId) {
          onPortalUpdateRef.current?.(payload.client);
        }
      } catch (err) {
        console.warn("ClientNotification: erreur traitement portalUpdate", err);
      }
    });

    newSocket.on("connect_error", (err) => {
      console.warn("ClientNotification: erreur de connexion socket", err);
    });

    return () => {
      newSocket.disconnect();
    };
    };
    setup();
  }, [clientId, conversationId]);

  // Si l'ID de conversation arrive après coup, rejoindre la room
  useEffect(() => {
    if (socket && socket.connected && conversationId) {
      socket.emit("joinConversation", conversationId);
    }
  }, [socket, conversationId]);

  const lastSeenMapRef = useRef<Record<string, number>>({});
  const initializedRef = useRef<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        if (conversationId) {
          const res = await fetch(`/api/conversations/${conversationId}/messages`);
          if (!res.ok) return;
          const data = await res.json();
          if (!Array.isArray(data)) return;
          const last = data[data.length - 1];
          if (last && last.senderId !== clientId) {
            const ts = new Date(last.createdAt).getTime();
            if (!cancelled) lastSeenMapRef.current[conversationId] = ts;
          }
        } else {
          const res = await fetch(`/api/conversations/user/${clientId}`);
          if (!res.ok) return;
          const convs = await res.json();
          if (!Array.isArray(convs)) return;
          for (const c of convs) {
            const last = Array.isArray(c.messages) ? c.messages[0] : null;
            if (last && last.senderId !== clientId) {
              const ts = new Date(last.createdAt).getTime();
              if (!cancelled) lastSeenMapRef.current[c.id] = ts;
            }
          }
        }
      } finally {
        if (!cancelled) initializedRef.current = true;
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [clientId, conversationId]);
  useEffect(() => {
    const t = window.setInterval(async () => {
      try {
        if (conversationId) {
          const res = await fetch(`/api/conversations/${conversationId}/messages`);
          if (!res.ok) return;
          const data = await res.json();
          if (!Array.isArray(data)) return;
          const last = data[data.length - 1];
          if (last && last.senderId !== clientId) {
            const ts = new Date(last.createdAt).getTime();
            const prev = lastSeenMapRef.current[conversationId] || 0;
            if (initializedRef.current && ts > prev) {
              lastSeenMapRef.current[conversationId] = ts;
              onNewMessageRef.current?.();
            }
          }
        } else {
          const res = await fetch(`/api/conversations/user/${clientId}`);
          if (!res.ok) return;
          const convs = await res.json();
          if (!Array.isArray(convs)) return;
          for (const c of convs) {
            const last = Array.isArray(c.messages) ? c.messages[0] : null;
            if (last && last.senderId !== clientId) {
              const ts = new Date(last.createdAt).getTime();
              const prev = lastSeenMapRef.current[c.id] || 0;
              if (initializedRef.current && ts > prev) {
                lastSeenMapRef.current[c.id] = ts;
                onNewMessageRef.current?.();
              }
            }
          }
        }
      } catch {}
    }, 3000);
    return () => window.clearInterval(t);
  }, [clientId, conversationId]);

  return null;
}
