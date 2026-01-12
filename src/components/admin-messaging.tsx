'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, User, Clock, CheckCircle } from 'lucide-react';
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
  const [notifications, setNotifications] = useState<Message[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingActiveRef = useRef<boolean>(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const selectedConvIdRef = useRef<string | null>(null);
  const autoSelectedRef = useRef<boolean>(false);

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

  useEffect(() => {
    if (!inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    const maxHeight = 160;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, [newMessage]);

  useEffect(() => {
    // Initialiser la connexion Socket.IO (admin)
    const newSocket = io({
      path: '/socket.io',
      addTrailingSlash: false,
      auth: { userId: ADMIN_USER_ID },
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 300,
      reconnectionDelayMax: 10000,
      timeout: 8000,
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
      if (message.senderId !== ADMIN_USER_ID) {
        setPartnerTyping(false);
      }
    });

    // Écouter les notifications globales admin
    newSocket.on('adminNewMessage', () => {
      // Rafraîchir la liste des conversations pour mettre à jour lastMessage/unreadCount
      fetchConversations();
    });

    newSocket.on('typing', (payload: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (payload.conversationId && selectedConvIdRef.current === payload.conversationId && payload.userId !== ADMIN_USER_ID) {
        setPartnerTyping(payload.isTyping);
      }
    });

    // Charger les conversations initiales
    fetchConversations();

    return () => {
      newSocket.close();
      window.clearInterval(hb);
    };
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
        emitTypingStopImmediate();
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

  const emitTypingStart = () => {
    if (!socket || !selectedConversation?.id) return;
    if (!typingActiveRef.current) {
      socket.emit('typing', { conversationId: selectedConversation.id });
      typingActiveRef.current = true;
    }
    window.clearTimeout(typingTimeoutRef.current as any);
  };

  const emitTypingStopImmediate = () => {
    window.clearTimeout(typingTimeoutRef.current as any);
    if (socket && selectedConversation?.id) {
      socket.emit('stopTyping', { conversationId: selectedConversation.id });
    }
    typingActiveRef.current = false;
  };

  const getClientName = (conversation: Conversation) => {
    const clientUser = conversation.users.find(user => user.id !== ADMIN_USER_ID);
    return clientUser?.name || 'Client';
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
                  <span className="font-medium text-gray-800">
                    {getClientName(conversation)}
                  </span>
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
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.senderId === ADMIN_USER_ID
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
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
              {partnerTyping && (
                <div className="text-xs text-gray-500 mb-1">
                  Le client est en train d’écrire...
                </div>
              )}
              <div className="flex space-x-2">
                <textarea
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewMessage(v);
                    if (v.trim().length > 0) {
                      emitTypingStart();
                    } else {
                      emitTypingStopImmediate();
                    }
                  }}
                  onBlur={emitTypingStopImmediate}
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
