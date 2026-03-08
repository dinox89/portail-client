"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Trash2 } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { getPerfDelay } from "@/lib/utils";

interface Message {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: string;
  read: boolean;
  clientTempId?: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatProps {
  conversationId: string;
  currentUser: User;
  portalToken?: string;
  onNewMessage?: () => void;
}

export default function Chat({ conversationId, currentUser, portalToken, onNewMessage }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const onNewMessageRef = useRef<(() => void) | undefined>(onNewMessage);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const pendingSendCountRef = useRef(0);

  const dedupeMessages = (list: Message[]) => {
    const seen = new Set<string>();
    const result: Message[] = [];
    for (const m of list) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        result.push(m);
      }
    }
    return result;
  };

  const renderMessageContent = (content: string) => {
    const regex = /((?:https?:\/\/|www\.)[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
    const parts: any[] = [];
    let lastIndex = 0;
    const toSafeHref = (raw: string) => {
      try {
        const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        const url = new URL(withProto);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.toString();
      } catch {
        return null;
      }
    };
    for (const match of content.matchAll(regex)) {
      const start = match.index || 0;
      if (start > lastIndex) parts.push(content.slice(lastIndex, start));
      let token = match[0];
      const trailing = token.match(/[)\].,!?;:]+$/)?.[0] || '';
      token = token.slice(0, token.length - trailing.length);
      if (token.includes('@')) {
        parts.push(token + trailing);
      } else {
        const href = toSafeHref(token);
        if (!href) {
          parts.push(token + trailing);
          lastIndex = start + match[0].length;
          continue;
        }
        parts.push(
          <a
            key={start}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-black hover:text-black break-all"
          >
            {token}
          </a>
        );
        if (trailing) parts.push(trailing);
      }
      lastIndex = start + match[0].length;
    }
    if (lastIndex < content.length) parts.push(content.slice(lastIndex));
    return parts;
  };

  const withPortalToken = (url: string) => {
    if (!portalToken) return url;
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}portalToken=${encodeURIComponent(portalToken)}`;
  };

  // Load messages on mount
  useEffect(() => {
    if (!conversationId) return;

    const loadMessages = async () => {
      try {
        const res = await fetch(withPortalToken(`/api/conversations/${conversationId}/messages`));
        if (res.ok) {
          const data = await res.json();
          const initial = Array.isArray(data) ? data : [];
          setMessages(dedupeMessages(initial));
          prevIdsRef.current = new Set(initial.map((m: any) => m.id));
        }
      } catch (error) {
        console.error("Erreur lors du chargement des messages:", error);
      }
    };

    loadMessages();
  }, [conversationId, portalToken]);

  // Setup socket connection (stabilisé: dépend seulement de conversationId et currentUser.id)
  useEffect(() => {
    if (!conversationId || !currentUser?.id) return;
    const attempts = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_ATTEMPTS ?? 10);
    const delay = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_DELAY ?? 500);
    const timeout = Number(process.env.NEXT_PUBLIC_SOCKET_TIMEOUT ?? 5000);

    const fetchToken = async () => {
      try {
        const query = portalToken
          ? `portalToken=${encodeURIComponent(portalToken)}`
          : `userId=${encodeURIComponent(currentUser.id)}`;
        const res = await fetch(`/api/realtime/token?${query}`);
        if (res.ok) {
          const data = await res.json();
          return data?.token || null;
        }
      } catch {}
      return null;
    };

    let active = true;
    let cleanup = () => {};

    const setup = async () => {
      const token = await fetchToken();
      const newSocket = io({
        path: "/socket.io",
        addTrailingSlash: false,
        auth: token ? { token } : { userId: currentUser.id },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: attempts,
        reconnectionDelay: delay,
        timeout,
      });

    newSocket.on("connect", () => {
      if (!active) return;
      setIsConnected(true);
      newSocket.emit("joinConversation", conversationId);
      // Marquer comme lu immédiatement à l'ouverture du chat
      newSocket.emit("markAsRead", { conversationId, userId: currentUser.id });
    });

    newSocket.on("disconnect", () => {
      if (!active) return;
      setIsConnected(false);
    });

    newSocket.on("newMessage", (message: Message) => {
      if (!active || message.conversationId !== conversationId) return;
      if (message.conversationId === conversationId) {
        prevIdsRef.current.add(message.id);
        setMessages(prev => {
          const withoutTemp = message.clientTempId ? prev.filter((m) => m.id !== message.clientTempId) : prev;
          return withoutTemp.some((m) => m.id === message.id) ? withoutTemp : [...withoutTemp, message];
        });

        if (onNewMessageRef.current && message.senderId !== currentUser.id) {
          onNewMessageRef.current();
        }
      }
    });

    newSocket.on("messageDeleted", (payload: { conversationId: string; messageId: string }) => {
      if (payload.conversationId === conversationId) {
        prevIdsRef.current.delete(payload.messageId);
        setMessages((prev) => prev.filter((message) => message.id !== payload.messageId));
      }
    });

    if (active) {
      setSocket(newSocket);
    }
    cleanup = () => {
      newSocket.close();
    };
    };
    setup();
    return () => {
      active = false;
      setSocket(null);
      cleanup();
    };
  }, [conversationId, currentUser?.id, portalToken]);

  useEffect(() => {
    if (!conversationId || !currentUser?.id) return;
    const t = window.setInterval(async () => {
      if (pendingSendCountRef.current > 0) return;
      try {
        const res = await fetch(withPortalToken(`/api/conversations/${conversationId}/messages`));
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        const deduped = dedupeMessages(data);
        const prevSet = prevIdsRef.current;
        let hasNewOther = false;
        for (const m of deduped) {
          if (!prevSet.has(m.id)) {
            if (m.senderId !== currentUser.id) hasNewOther = true;
            prevSet.add(m.id);
          }
        }
        setMessages(deduped);
        if (hasNewOther) {
          onNewMessageRef.current?.();
          try {
            await fetch(withPortalToken(`/api/conversations/${conversationId}/mark-read`), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: currentUser.id })
            });
          } catch {}
        }
      } catch {}
    }, 1500);
    return () => window.clearInterval(t);
  }, [conversationId, currentUser?.id, portalToken]);

  useEffect(() => {
    const delay = getPerfDelay();
    if (delay > 0) {
      const t = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, delay);
      return () => clearTimeout(t);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;
    const delay = getPerfDelay();
    const t = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }, delay);
    return () => clearTimeout(t);
  }, [conversationId, isConnected]);

  useEffect(() => {
    if (!inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    const maxHeight = 160;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, [input]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const content = input.trim();
    const clientTempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: clientTempId,
      clientTempId,
      content,
      senderId: currentUser.id,
      conversationId,
      createdAt: new Date().toISOString(),
      read: false,
    };

    pendingSendCountRef.current += 1;
    setMessages((prev) => [...prev, optimisticMessage]);
    setInput("");
    setSendError(null);
    setMessageActionError(null);

    try {
      const res = await fetch(withPortalToken(`/api/conversations/${conversationId}/messages`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, senderId: currentUser.id }),
      });

      if (res.ok) {
        const created = await res.json();
        prevIdsRef.current.add(created.id);
        setMessages((prev) => {
          const withoutTemp = prev.filter((message) => message.id !== clientTempId);
          return withoutTemp.some((message) => message.id === created.id)
            ? withoutTemp
            : [...withoutTemp, created];
        });
        setSendError(null);
        setMessageActionError(null);
      } else {
        setMessages((prev) => prev.filter((message) => message.id !== clientTempId));
        setInput(content);
        try {
          const err = await res.json();
          setSendError(typeof err?.error === "string" ? err.error : "Échec de l'envoi du message");
        } catch {
          setSendError("Échec de l'envoi du message");
        }
      }
    } catch (error) {
      setMessages((prev) => prev.filter((message) => message.id !== clientTempId));
      setInput(content);
      console.error("Erreur lors de l'envoi du message:", error);
      setSendError("Erreur réseau lors de l'envoi du message");
    } finally {
      pendingSendCountRef.current = Math.max(0, pendingSendCountRef.current - 1);
    }
  };

  const deleteMessage = async (messageId: string) => {
    try {
      const res = await fetch(withPortalToken(`/api/conversations/${conversationId}/messages`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, userId: currentUser.id }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setMessageActionError(typeof payload?.error === "string" ? payload.error : "Échec de la suppression du message");
        return;
      }

      prevIdsRef.current.delete(messageId);
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
      setMessageActionError(null);
    } catch (error) {
      console.error("Erreur lors de la suppression du message:", error);
      setMessageActionError("Erreur réseau lors de la suppression du message");
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-gray-900 text-white p-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">{currentUser.name.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <h3 className="font-semibold">Chat Support</h3>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Send className="w-8 h-8 text-gray-400" />
            </div>
            <p>Aucun message pour le moment</p>
            <p className="text-sm">Commencez la conversation !</p>
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.senderId === currentUser.id;
            return (
              <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className={`group relative max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                  isOwn 
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' 
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  {isOwn && (
                    <button
                      type="button"
                      onClick={() => deleteMessage(message.id)}
                      className="absolute -right-2 -top-2 rounded-full border border-white/20 bg-slate-950/85 p-1.5 text-white opacity-100 shadow-lg transition hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                      title="Supprimer le message"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {renderMessageContent(message.content)}
                  </p>
                  <p className={`text-xs mt-1 ${isOwn ? 'text-blue-100' : 'text-gray-500'}`}>
                    {formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tapez votre message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white resize-none min-h-[44px] max-h-40"
          />
          <button
            onClick={sendMessage}
            // Le bouton est désactivé uniquement si le champ est vide
            disabled={!input.trim()}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Envoyer</span>
          </button>
        </div>
        {sendError && (
          <p className="mt-2 text-sm text-red-600">{sendError}</p>
        )}
        {messageActionError && (
          <p className="mt-2 text-sm text-red-600">{messageActionError}</p>
        )}
      </div>
    </div>
  );
}
