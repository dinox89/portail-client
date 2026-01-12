"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Bell, BellOff } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { getPerfDelay } from "@/lib/utils";

interface Message {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: string;
  read: boolean;
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
  onNewMessage?: () => void;
}

export default function Chat({ conversationId, currentUser, onNewMessage }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Refs pour éviter de recréer la connexion socket quand ces valeurs changent
  const soundRef = useRef<boolean>(soundEnabled);
  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  const notifyPermRef = useRef<boolean>(hasNotificationPermission);
  useEffect(() => { notifyPermRef.current = hasNotificationPermission; }, [hasNotificationPermission]);
  const onNewMessageRef = useRef<(() => void) | undefined>(onNewMessage);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingActiveRef = useRef<boolean>(false);
  const prevIdsRef = useRef<Set<string>>(new Set());

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
    for (const match of content.matchAll(regex)) {
      const start = match.index || 0;
      if (start > lastIndex) parts.push(content.slice(lastIndex, start));
      let token = match[0];
      const trailing = token.match(/[)\].,!?;:]+$/)?.[0] || '';
      token = token.slice(0, token.length - trailing.length);
      if (token.includes('@')) {
        parts.push(token + trailing);
      } else {
        const href =
          token.startsWith('http://') || token.startsWith('https://')
            ? token
            : `https://${token.startsWith('www.') ? token : token}`;
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

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        setHasNotificationPermission(permission === "granted");
      });
    } else if ("Notification" in window && Notification.permission === "granted") {
      setHasNotificationPermission(true);
    }
  }, []);

  // Load messages on mount
  useEffect(() => {
    if (!conversationId) return;

    const loadMessages = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
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
  }, [conversationId]);

  // Setup socket connection (stabilisé: dépend seulement de conversationId et currentUser.id)
  useEffect(() => {
    if (!conversationId || !currentUser?.id) return;

    const newSocket = io({
      path: "/socket.io",
      addTrailingSlash: false,
      auth: { userId: currentUser.id },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      timeout: 5000,
    });

    newSocket.on("connect", () => {
      setIsConnected(true);
      newSocket.emit("joinConversation", conversationId);
      // Marquer comme lu immédiatement à l'ouverture du chat
      newSocket.emit("markAsRead", { conversationId, userId: currentUser.id });
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    newSocket.on("newMessage", (message: Message) => {
      if (message.conversationId === conversationId) {
        setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);

        // Lecture son / notification via refs pour éviter les re-creations
        if (soundRef.current && message.senderId !== currentUser.id) {
          playNotificationSound();
        }
        if (notifyPermRef.current && message.senderId !== currentUser.id) {
          showBrowserNotification(message);
        }
        if (onNewMessageRef.current && message.senderId !== currentUser.id) {
          onNewMessageRef.current();
        }
      }
    });
    newSocket.on("typing", (payload: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (payload.conversationId === conversationId && payload.userId !== currentUser.id) {
        setPartnerTyping(payload.isTyping);
        if (payload.isTyping) {
          window.clearTimeout(typingTimeoutRef.current as any);
          typingTimeoutRef.current = window.setTimeout(() => setPartnerTyping(false), 3000);
        }
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [conversationId, currentUser?.id]);

  useEffect(() => {
    if (!conversationId || !currentUser?.id) return;
    const t = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
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
            await fetch(`/api/conversations/${conversationId}/mark-read`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: currentUser.id })
            });
          } catch {}
        }
      } catch {}
    }, 10000);
    return () => window.clearInterval(t);
  }, [conversationId, currentUser?.id]);

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

  const playNotificationSound = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(e => console.log("Erreur lecture son:", e));
    }
  };

  const showBrowserNotification = (message: Message) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Nouveau message", {
        body: `${message.senderId === currentUser.id ? 'Vous' : 'Admin'}: ${message.content}`,
        icon: "/favicon.ico",
        tag: "chat-message"
      });
    }
  };

  const emitTypingStart = () => {
    if (!socket || !isConnected || !conversationId) return;
    if (!typingActiveRef.current) {
      socket.emit("typing", { conversationId });
      typingActiveRef.current = true;
    }
    window.clearTimeout(typingTimeoutRef.current as any);
    typingTimeoutRef.current = window.setTimeout(() => {
      if (socket && isConnected) {
        socket.emit("stopTyping", { conversationId });
      }
      typingActiveRef.current = false;
    }, 1200);
  };

  const emitTypingStopImmediate = () => {
    window.clearTimeout(typingTimeoutRef.current as any);
    if (socket && isConnected && conversationId) {
      socket.emit("stopTyping", { conversationId });
    }
    typingActiveRef.current = false;
  };

  const sendMessage = async () => {
    // Autoriser l'envoi même sans connexion socket (fallback HTTP)
    if (!input.trim()) return;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input.trim(), senderId: currentUser.id }),
      });

      if (res.ok) {
        const created = await res.json();
        setMessages(prev => prev.some(m => m.id === created.id) ? prev : [...prev, created]);
        setInput("");
        emitTypingStopImmediate();
        setSendError(null);
      } else {
        try {
          const err = await res.json();
          setSendError(typeof err?.error === "string" ? err.error : "Échec de l'envoi du message");
        } catch {
          setSendError("Échec de l'envoi du message");
        }
      }
    } catch (error) {
      console.error("Erreur lors de l'envoi du message:", error);
      setSendError("Erreur réseau lors de l'envoi du message");
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
      {/* Audio element for notification sound */}
      <audio ref={audioRef} src="/notification.mp3" preload="auto" />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-gray-900 text-white p-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">{currentUser.name.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <h3 className="font-semibold">Chat Support</h3>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <span className="text-sm text-gray-300">{isConnected ? 'En ligne' : 'Hors ligne'}</span>
            </div>
          </div>
        </div>
        
        {/* Sound toggle */}
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          title={soundEnabled ? "Désactiver les sons" : "Activer les sons"}
        >
          {soundEnabled ? (
            <Bell className="w-5 h-5" />
          ) : (
            <BellOff className="w-5 h-5" />
          )}
        </button>
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
                <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                  isOwn 
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' 
                    : 'bg-gray-100 text-gray-900'
                }`}>
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
        {partnerTyping && (
          <div className="text-xs text-gray-500 mb-1">
            {currentUser.role === 'user' ? 'Le prestataire est en train d’écrire...' : 'Le client est en train d’écrire...'}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v);
              if (v.trim().length > 0) {
                emitTypingStart();
              } else {
                emitTypingStopImmediate();
              }
            }}
            onBlur={emitTypingStopImmediate}
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
      </div>
    </div>
  );
}
