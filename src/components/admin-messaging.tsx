'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, User, Clock, CheckCircle, Trash2 } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface Message {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: string;
  read: boolean;
  sender?: {
    id: string;
    name: string;
  };
}

interface Conversation {
  id: string;
  users: Array<{
    id: string;
    name: string;
    role?: string;
    lastSeenAt?: string | null;
  }>;
  messages: Message[];
  lastMessage?: Message;
  unreadCount: number;
}

export default function AdminMessaging() {
  const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? 'admin-user-id'
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const selectedConvIdRef = useRef<string | null>(null);
  const autoSelectedRef = useRef<boolean>(false);

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

  useEffect(() => {
    if (!inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    const maxHeight = 160;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, [newMessage]);

  useEffect(() => {
    const attempts = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_ATTEMPTS ?? 20);
    const delay = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_DELAY ?? 300);
    const delayMax = Number(process.env.NEXT_PUBLIC_SOCKET_RECONNECT_DELAY_MAX ?? 10000);
    const timeout = Number(process.env.NEXT_PUBLIC_SOCKET_TIMEOUT ?? 8000);

    const fetchToken = async () => {
      try {
        const res = await fetch(`/api/realtime/token?userId=${ADMIN_USER_ID}`);
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
        path: '/socket.io',
        addTrailingSlash: false,
        auth: token ? { token } : { userId: ADMIN_USER_ID },
        reconnection: true,
        reconnectionAttempts: attempts,
        reconnectionDelay: delay,
        reconnectionDelayMax: delayMax,
        timeout,
        transports: ['websocket', 'polling'],
      });
    setSocket(newSocket);

    const hb = window.setInterval(() => {
      try {
        newSocket.emit('heartbeat', { t: Date.now() });
      } catch {}
    }, 15000);

    newSocket.on('connect', () => {
      if (selectedConvIdRef.current) {
        newSocket.emit('joinConversation', selectedConvIdRef.current);
      }
    });

    // Écouter les nouveaux messages dans la conversation rejointe
    newSocket.on('newMessage', (message: Message) => {
      // Append au chat ouvert si la conversation correspond, en évitant les doublons
      setSelectedConversation(prev => {
        if (prev && prev.id === message.conversationId) {
          const msgs = prev.messages || [];
          const exists = msgs.some(m => m.id === message.id);
          if (exists) return prev;
          return { ...prev, messages: [...msgs, message] };
        }
        return prev;
      });
    });

    // Écouter les notifications globales admin
    newSocket.on('adminNewMessage', () => {
      // Rafraîchir la liste des conversations pour mettre à jour lastMessage/unreadCount
      fetchConversations();
    });

    newSocket.on('messageDeleted', (payload: { conversationId: string; messageId: string }) => {
      setSelectedConversation(prev => {
        if (!prev || prev.id !== payload.conversationId) return prev;
        return {
          ...prev,
          messages: (prev.messages || []).filter(message => message.id !== payload.messageId),
        };
      });
      void fetchConversations();
    });

    // Charger les conversations initiales
    fetchConversations();

    return () => {
      newSocket.close();
      window.clearInterval(hb);
    };
    };
    setup();
  }, []);

  const fetchConversations = async () => {
    try {
      // Récupérer toutes les conversations (endpoint à créer)
      const res = await fetch('/api/conversations/admin');
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
        if (!autoSelectedRef.current && !selectedConversation && Array.isArray(data) && data.length > 0) {
          const preferred = data.find((c: any) => (c.unreadCount || 0) > 0) || data[0];
          if (preferred) {
            await selectConversation(preferred);
            autoSelectedRef.current = true;
          }
        }
      }
    } catch (error) {
      console.error('Erreur lors du chargement des conversations:', error);
    }
  };

  const loadConversationMessages = async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        const seen = new Set<string>();
        const unique: Message[] = [];
        for (const m of data) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            unique.push(m);
          }
        }
        return unique;
      }
    } catch (error) {
      console.error('Erreur lors du chargement des messages de la conversation:', error);
    }
    return [];
  };

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      await fetchConversations();
      if (selectedConversation?.id) {
        const currentConv = (conversations || []).find(c => c.id === selectedConversation.id);
        const currLastId = currentConv?.lastMessage?.id;
        const prevLastId = selectedConversation.lastMessage?.id;
        if (!currLastId || currLastId !== prevLastId) {
          const msgs = await loadConversationMessages(selectedConversation.id);
          setSelectedConversation(prev => prev ? { ...prev, messages: msgs, lastMessage: currentConv?.lastMessage || prev.lastMessage } : prev);
        }
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [selectedConversation?.id]);

  const selectConversation = async (conversation: Conversation) => {
    // Quitter l'ancienne room si nécessaire
    if (socket && selectedConversation?.id) {
      socket.emit('leaveConversation', selectedConversation.id);
    }

    // Rejoindre la room de la nouvelle conversation
    if (socket) {
      socket.emit('joinConversation', conversation.id);
    }

    // Charger les messages pour éviter erreurs d'accès
    const messages = await loadConversationMessages(conversation.id);
    setSelectedConversation({ ...conversation, messages });
    selectedConvIdRef.current = conversation.id;

    // Marquer les messages comme lus
    markMessagesAsRead(conversation.id);
  };

  const markMessagesAsRead = async (conversationId: string) => {
    try {
      await fetch(`/api/conversations/${conversationId}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: ADMIN_USER_ID })
      });
      setConversations(prev =>
        prev.map(conv =>
          conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv
        )
      );
    } catch (error) {
      console.error('Erreur lors du marquage des messages comme lus:', error);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newMessage,
          senderId: ADMIN_USER_ID,
          conversationId: selectedConversation.id
        })
      });

      if (res.ok) {
        const sentMessage = await res.json();
        // Mettre à jour la conversation localement en évitant les doublons
        setSelectedConversation(prev => {
          if (!prev) return null;
          const msgs = prev.messages || [];
          const exists = msgs.some(m => m.id === sentMessage.id);
          const nextMsgs = exists ? msgs : [...msgs, sentMessage];
          return { ...prev, messages: nextMsgs };
        });
        setNewMessage('');
        setSendError(null);
      } else {
        let errMsg = 'Échec de l’envoi du message';
        try {
          const payload = await res.json();
          if (typeof payload?.error === 'string') errMsg = payload.error;
        } catch {}
        setSendError(errMsg);
        console.error('Erreur lors de l’envoi du message:', errMsg);
      }
    } catch (error) {
      setSendError('Erreur réseau lors de l’envoi du message');
      console.error('Erreur lors de l\'envoi du message:', error);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!selectedConversation) return;

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          userId: ADMIN_USER_ID,
        })
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setSendError(typeof payload?.error === 'string' ? payload.error : 'Échec de la suppression du message');
        return;
      }

      setSelectedConversation(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: (prev.messages || []).filter(message => message.id !== messageId),
        };
      });
      setSendError(null);
      await fetchConversations();
    } catch (error) {
      setSendError('Erreur réseau lors de la suppression du message');
      console.error('Erreur lors de la suppression du message:', error);
    }
  };

  const getClientName = (conversation: Conversation) => {
    const clientUser = conversation.users.find(user => user.id !== ADMIN_USER_ID);
    return clientUser?.name || 'Client';
  };

  const getClientUser = (conversation: Conversation) => {
    return conversation.users.find(user => user.id !== ADMIN_USER_ID);
  };

  const formatLastSeen = (value?: string | null) => {
    if (!value) return 'Jamais connecté';
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return 'En ligne à l’instant';
    if (diff < 3_600_000) return `Vu il y a ${Math.max(1, Math.floor(diff / 60_000))} min`;
    if (diff < 86_400_000) return `Vu il y a ${Math.max(1, Math.floor(diff / 3_600_000))} h`;
    return `Vu le ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Liste des conversations */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center">
            <MessageCircle className="mr-2" size={20} />
            Messages Clients
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              onClick={() => selectConversation(conversation)}
              className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                selectedConversation?.id === conversation.id ? 'bg-blue-50 border-blue-200' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <User className="mr-2 text-gray-500" size={16} />
                  <div>
                    <span className="font-medium text-gray-800">
                      {getClientName(conversation)}
                    </span>
                    <p className="text-xs text-gray-500">
                      {formatLastSeen(getClientUser(conversation)?.lastSeenAt)}
                    </p>
                  </div>
                </div>
                {conversation.unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1">
                    {conversation.unreadCount}
                  </span>
                )}
              </div>
              {conversation.lastMessage && (
                <div className="mt-2 text-sm text-gray-600 truncate whitespace-pre-wrap">
                  {renderMessageContent(conversation.lastMessage.content)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Zone de chat */}
      <div className="flex-1 flex flex-col">
        {selectedConversation ? (
          <>
            {/* En-tête de la conversation */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <h3 className="font-semibold text-gray-800">
                Conversation avec {getClientName(selectedConversation)}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {formatLastSeen(getClientUser(selectedConversation)?.lastSeenAt)}
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(selectedConversation.messages || []).map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.senderId === ADMIN_USER_ID ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`group relative max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.senderId === ADMIN_USER_ID
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
                    {message.senderId === ADMIN_USER_ID && (
                      <button
                        type="button"
                        onClick={() => deleteMessage(message.id)}
                        className="absolute -right-2 -top-2 rounded-full border border-white/20 bg-slate-950/85 p-1.5 text-white opacity-0 shadow-lg transition group-hover:opacity-100 hover:bg-red-600"
                        title="Supprimer le message"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {renderMessageContent(message.content)}
                    </p>
                    <div className="flex items-center mt-1 text-xs opacity-70">
                      <Clock className="mr-1" size={12} />
                      {new Date(message.createdAt).toLocaleTimeString()}
                      {message.read && message.senderId === ADMIN_USER_ID && (
                        <CheckCircle className="ml-1" size={12} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Zone d'envoi */}
            <div className="p-4 border-t border-gray-200 bg-white">
              <div className="flex space-x-2">
                <textarea
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Tapez votre message..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[44px] max-h-40"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
              {sendError && (
                <div className="mt-2 text-sm text-red-600">{sendError}</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <MessageCircle className="mx-auto text-gray-400 mb-4" size={48} />
              <p className="text-gray-600">Sélectionnez une conversation pour commencer</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
