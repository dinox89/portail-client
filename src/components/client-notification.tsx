"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface ClientNotificationProps {
  clientId: string;
  conversationId?: string | null;
  onNewMessage?: () => void;
}

// Composant headless: aucune UI, uniquement la logique socket
export function ClientNotification({ clientId, conversationId, onNewMessage }: ClientNotificationProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const onNewMessageRef = useRef<(() => void) | undefined>(onNewMessage);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);

  useEffect(() => {
    const newSocket = io({
      path: "/socket.io",
      addTrailingSlash: false,
      auth: { userId: clientId },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
      timeout: 8000,
    });

    setSocket(newSocket);

    newSocket.on("connect", async () => {
      if (conversationId) {
        newSocket.emit("joinConversation", conversationId);
      } else {
        // Fallback: rejoindre toutes les conversations du client
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
      // Messages entrants (admin -> client). Si conversationId inconnu, on notifie quand même.
      const isFromOther = message?.senderId !== clientId;
      const isSameConv = conversationId ? message?.conversationId === conversationId : true;
      if (isFromOther && isSameConv) {
        onNewMessageRef.current?.();
      }
    });

    newSocket.on("connect_error", (err) => {
      console.warn("ClientNotification: erreur de connexion socket", err);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [clientId, conversationId]);

  // Si l'ID de conversation arrive après coup, rejoindre la room
  useEffect(() => {
    if (socket && socket.connected && conversationId) {
      socket.emit("joinConversation", conversationId);
    }
  }, [socket, conversationId]);

  return null;
}