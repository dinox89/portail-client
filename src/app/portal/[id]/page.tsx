"use client";

import { useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Users, Calendar, FileText, Download, ExternalLink, CheckCircle, Clock, AlertCircle, Image as ImageIcon, MessageSquare } from "lucide-react";
import Chat from "@/components/chat";
import { ClientNotification } from "@/components/client-notification";

interface Step {
  id: number;
  name: string;
  date: string;
  status: 'En cours' | 'Terminé';
}

interface ProjectFile {
  id: number;
  name: string;
  date: string;
  size: string;
  status: 'completed' | 'in-progress' | 'pending';
  fileData?: string;
  fileType?: string;
}

interface Project {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: string;
  steps: Step[];
  files: ProjectFile[];
}

interface Client {
  id: number;
  uniqueId: string;
  name: string;
  contact: string;
  email: string;
  progression: number;
  project: Project;
}

export default function ClientPage() {
  const params = useParams();
  const clientId = params.id as string;
  const [activeTab, setActiveTab] = useState("project");
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const chatEndRef = useRef(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const defaultTitleRef = useRef<string>('');

  useEffect(() => {
    const loadClientData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/${clientId}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setClient({
            id: 0,
            uniqueId: clientId,
            name: data.name,
            contact: data.contact,
            email: data.email,
            progression: data.progression ?? 0,
            project: data.project,
          });
          setError(false);
        } else {
          const fallbackLoaded = (() => {
            const savedData = localStorage.getItem('clientData');
            if (!savedData) return false;
            try {
              const clients: Client[] = JSON.parse(savedData);
              const foundClient = clients.find(c => c.uniqueId === clientId);
              if (foundClient) {
                setClient(foundClient);
                setError(false);
                return true;
              }
            } catch {
              return false;
            }
            return false;
          })();
          if (!fallbackLoaded) {
            setError(true);
          }
        }
      } catch (error) {
        console.error('Erreur lors du chargement des données client:', error);
        const savedData = localStorage.getItem('clientData');
        if (savedData) {
          try {
            const clients: Client[] = JSON.parse(savedData);
            const foundClient = clients.find(c => c.uniqueId === clientId);
            if (foundClient) {
              setClient(foundClient);
              setError(false);
            } else {
              setError(true);
            }
          } catch {
            setError(true);
          }
        } else {
          setError(true);
        }
      } finally {
        setLoading(false);
      }
    };

    if (clientId) {
      loadClientData();
    }
  }, [clientId]);

  useEffect(() => {
    if (clientId) {
      const fetchConversation = async () => {
        try {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId1: clientId, userId2: 'admin-user-id' }),
          });
          
          if (!res.ok) {
            const errorData = await res.json();
            console.error('API Error:', errorData);
            return;
          }
          
          const data = await res.json();
          setConversationId(data.id);
        } catch (error) {
          console.error('Error fetching conversation:', error);
        }
      };
      fetchConversation();
    }
  }, [clientId]);

  // Seed initial unread count from server messages on load
  useEffect(() => {
    const seedUnread = async () => {
      if (!conversationId || !clientId) return;
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const initialCount = data.filter((m: any) => !m.read && m.senderId !== clientId).length;
            setUnreadCount(prev => Math.max(prev, initialCount));
          }
        }
      } catch (err) {
        console.error('Erreur lors du calcul initial des non lus:', err);
      }
    };
    seedUnread();
  }, [conversationId, clientId]);

  const switchTab = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'chat') {
      setUnreadCount(0);
      if (typeof document !== 'undefined') {
        document.title = defaultTitleRef.current || document.title;
      }
    }
  };

  const handleNewMessage = () => {
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const shouldCount = isHidden || activeTab !== 'chat';
    if (shouldCount) {
      setUnreadCount((prev) => prev + 1);
    }
    if (isHidden) {
      if (!defaultTitleRef.current) defaultTitleRef.current = document.title;
      document.title = 'Nouveau message !';
    }
  };

  useEffect(() => {
    if (typeof document !== 'undefined' && !defaultTitleRef.current) {
      defaultTitleRef.current = document.title;
    }
  }, []);

  const prevUnreadRef = useRef<number>(0);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const base = defaultTitleRef.current || document.title;
    if (activeTab !== 'chat' && unreadCount > 0 && !document.hidden) {
      const prefix = `(${unreadCount}) `;
      const withoutPrefix = base.replace(/^\(\d+\)\s*/, '');
      document.title = prefix + withoutPrefix;
    } else if (!document.hidden) {
      document.title = defaultTitleRef.current || document.title;
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount, activeTab]);

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        document.title = defaultTitleRef.current || document.title;
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, []);

  // Mise à jour en temps réel du portail
  const handlePortalUpdate = (updated: any) => {
    try {
      setClient((prev) => {
        const base = {
          id: prev?.id ?? 0,
          uniqueId: clientId,
        } as Client;
        return {
          ...base,
          name: updated?.name ?? prev?.name ?? '',
          contact: updated?.contact ?? prev?.contact ?? '',
          email: updated?.email ?? prev?.email ?? '',
          progression: (updated?.progression ?? prev?.progression ?? 0) as number,
          project: (updated?.project ?? prev?.project ?? {
            name: '', description: '', startDate: '', endDate: '', status: '', steps: [], files: []
          }) as Project,
        };
      });
    } catch (err) {
      console.warn('Erreur lors de la mise à jour du portail:', err);
    }
  };

  const downloadFile = (file: ProjectFile) => {
    if (file.fileData) {
      try {
        // Créer un lien de téléchargement
        const link = document.createElement('a');
        link.href = file.fileData;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        alert('Erreur lors du téléchargement du fichier');
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Terminé':
      case 'completed':
        return <CheckCircle className="text-green-600" size={20} />;
      case 'En cours':
      case 'in-progress':
        return <Clock className="text-blue-600" size={20} />;
      case 'pending':
        return <AlertCircle className="text-orange-600" size={20} />;
      default:
        return <Clock className="text-gray-600" size={20} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Terminé':
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'En cours':
      case 'in-progress':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'pending':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  const FORM_URL = "https://tally.so/r/wQgVk1";

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement de votre espace client...</p>
        </div>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="text-red-600" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Lien invalide</h1>
          <p className="text-gray-600 mb-6">
            Ce lien d'accès client n'est pas valide ou a expiré. Veuillez contacter votre gestionnaire de projet.
          </p>
          <button
            onClick={() => window.close()}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Fermer cette page
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style jsx>{`
        /* Custom animations */
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-bounce {
          animation: bounce 1s infinite;
        }

        /* Custom scrollbar for chat */
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
          border-radius:10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.3);
          border-radius:10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.5);
        }

        /* Tab styles */
        .tab-active {
          background: linear-gradient(to right, rgb(51 65 85), rgb(55 65 81), rgb(17 24 39));
          color: white;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
          transform: scale(1.05);
        }
        .tab-inactive {
          color: rgb(75 85 99);
        }
        .tab-inactive:hover {
          background-color: rgba(255,255,255,0.7);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
        }

        /* Smooth transitions */
        .tab-btn, .group, button {
          transition: all 0.3s ease;
        }

        /* Gradient text animation */
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .gradient-text {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>
      
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100">
        {/* Background décoratif */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-gray-200/30 to-transparent rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-gray-300/20 to-transparent rounded-full blur-3xl"></div>
        </div>

        <div className="relative z-10">
          {/* Header */}
          <header className="bg-white/70 backdrop-blur-2xl border-b border-gray-200/60 sticky top-0 z-50 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
              <div className="flex items-center justify-center">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                  Bienvenue {client.name}
                </h1>
              </div>
            </div>
          </header>
      
          {/* Navigation */}
          <nav className="max-w-7xl mx-auto px-4 sm:px-8 mt-10 flex justify-center">
            <div className="bg-white/80 backdrop-blur-2xl rounded-3xl p-2 shadow-2xl border border-gray-200/60 flex gap-2 justify-center w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl">
              {["project", "files", "formulaire", "chat"].map((tab) => {
                const active = activeTab === tab;
                const chatUnread = tab === "chat" ? unreadCount : 0;
                
                return (
                  <button
                    key={tab}
                    onClick={() => switchTab(tab)}
                    aria-label={tab}
                    className={`tab-btn flex-1 px-3 sm:px-6 lg:px-7 py-3 sm:py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 sm:gap-3 text-sm sm:text-base relative ${
                      active ? "tab-active" : "tab-inactive"
                    }`}
                  >
                    <span className={`inline-flex ${active ? "text-white" : "text-gray-400"}`}>
                      {tab === "project" && (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M12 3l9 8h-3v8h-12v-8h-3l9-8z" />
                        </svg>
                      )}
                      {tab === "files" && (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9z" />
                        </svg>
                      )}
                      {tab === "formulaire" && (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M7 3h10v2h-10v-2zm0 4h10v2h-10v-2zm0 4h7v2h-7v-2z" />
                        </svg>
                      )}
                      {tab === "chat" && (
                        <MessageSquare className="w-5 h-5" />
                      )}
                    </span>
                    
                    {chatUnread > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-5 px-1.5 bg-red-600 text-white text-[10px] leading-5 rounded-full border border-white flex items-center justify-center">
                        {chatUnread}
                      </span>
                    )}
      
                    <span className="hidden sm:inline">
                      {tab === "project"
                        ? "Mon projet"
                        : tab === "files"
                        ? "Mes fichiers"
                        : tab === "formulaire"
                        ? "Formulaire"
                        : tab === "chat"
                        ? "Chat"
                        : "Contact"}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
      
          <main className="max-w-7xl mx-auto px-4 sm:px-8 py-10 pb-20 space-y-10">
            {/* Project Tab */}
            {activeTab === "project" && (
              <div className="space-y-8">
                <div className="bg-gradient-to-br from-slate-800 via-gray-900 to-zinc-900 rounded-3xl p-6 sm:p-10 shadow-2xl text-white relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent"></div>
                  <div className="relative z-10">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-8 gap-4">
                      <div>
                        <h2 className="text-2xl sm:text-4xl font-bold mb-2">{client.project.name}</h2>
                        <p className="text-gray-300 text-base sm:text-lg">{client.project.description}</p>
                      </div>
                      <div className="bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/30 text-emerald-300 px-4 sm:px-6 py-2 sm:py-3 rounded-2xl font-bold shadow-lg text-sm sm:text-base">
                        {client.project.status}
                      </div>
                    </div>
      
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-300 font-medium text-lg">Avancement du projet</span>
                        <span className="text-3xl font-bold">{client.progression}%</span>
                      </div>
                      <div className="h-4 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm border border-white/20">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 rounded-full transition-all duration-1000 shadow-lg"
                          style={{ width: `${client.progression}%` }}
                        />
                      </div>
                    </div>
      
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mt-8">
                      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                        <p className="text-gray-300 text-sm mb-2">Début du projet</p>
                        <p className="text-2xl font-bold">{formatDate(client.project.startDate)}</p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                        <p className="text-gray-300 text-sm mb-2">Livraison prévue</p>
                        <p className="text-2xl font-bold">{formatDate(client.project.endDate)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Étapes du projet */}
                <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden">
                  <div className="p-6 sm:p-10 border-b border-gray-200/60 bg-gradient-to-br from-gray-50/50 to-white/50">
                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <CheckCircle className="text-green-600" size={24} />
                      </div>
                      Étapes du projet
                    </h2>
                    <p className="text-gray-600 text-base sm:text-lg">Suivez l'avancement des différentes étapes</p>
                  </div>
                  <div className="p-6 sm:p-8 space-y-4">
                    {client.project.steps.length === 0 ? (
                      <div className="text-center py-12 bg-gray-50 rounded-xl">
                        <Clock className="mx-auto mb-3 text-gray-400" size={48} />
                        <p className="text-gray-600">Aucune étape définie pour le moment</p>
                      </div>
                    ) : (
                      client.project.steps.map((step, index) => (
                        <div key={step.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                            <span className="text-sm font-bold text-gray-600">{index + 1}</span>
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">{step.name}</h3>
                            <p className="text-sm text-gray-600">Prévu pour : {step.date}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(step.status)}
                            <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(step.status)}`}>
                              {step.status}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
      
            {/* Files Tab */}
            {activeTab === "files" && (
              <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden">
                <div className="p-6 sm:p-10 border-b border-gray-200/60 bg-gradient-to-br from-gray-50/50 to-white/50">
                  <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <ImageIcon className="text-purple-600" size={24} />
                    </div>
                    Vos fichiers PNG
                  </h2>
                  <p className="text-gray-600 text-base sm:text-lg">Téléchargez les fichiers PNG de votre projet</p>
                </div>
                <div className="p-6 sm:p-8 space-y-4">
                  {(!client.project.files || client.project.files.length === 0) ? (
                    <div className="text-center py-12 bg-gray-50 rounded-xl">
                      <ImageIcon className="mx-auto mb-3 text-gray-400" size={48} />
                      <p className="text-gray-600">Aucun fichier PNG disponible pour le moment</p>
                    </div>
                  ) : (
                    client.project.files.map(file => (
                      <div key={file.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                        <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                          <ImageIcon className="text-purple-600" size={24} />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{file.name}</h3>
                          <div className="flex items-center gap-3 text-sm text-gray-600">
                            <span>{formatDate(file.date)}</span>
                            <span>•</span>
                            <span>{file.size}</span>
                            <span>•</span>
                            <span className="text-purple-600 font-medium">PNG</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {file.fileData && (
                            <button
                              onClick={() => downloadFile(file)}
                              className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                              title="Télécharger le fichier PNG"
                            >
                              <Download size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
      
            {/* Formulaire Tab - always show button to open in new tab */}
            {activeTab === "formulaire" && (
              <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden p-6 sm:p-10">
                <div className="flex flex-col items-center justify-center gap-4 py-12">
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mt-1">Le formulaire s'ouvre dans un nouvel onglet pour garantir le bon affichage.</p>
                  </div>
                  <a
                    href={FORM_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block bg-gradient-to-r from-slate-700 via-gray-800 to-zinc-900 text-white px-6 py-3 rounded-2xl font-bold hover:shadow-2xl transition-all duration-300"
                  >
                    Ouvrir le formulaire
                  </a>
                </div>
              </div>
            )}
      
            {/* Chat Tab */}
            {activeTab === "chat" && conversationId && (
              <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden p-6 sm:p-10 flex flex-col h-[500px]">
                <Chat 
                  conversationId={conversationId} 
                  currentUser={{ 
                    id: clientId, 
                    email: client.email, 
                    name: client.name, 
                    role: 'user', 
                    createdAt: new Date(), 
                    updatedAt: new Date() 
                  }}
                  onNewMessage={handleNewMessage}
                />
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Notifications client */}
      <ClientNotification 
        clientId={clientId}
        conversationId={conversationId}
        onNewMessage={handleNewMessage}
        onPortalUpdate={handlePortalUpdate}
      />
    </>
  );
}
