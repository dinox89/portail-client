"use client";

import { useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Download, CheckCircle, Clock, AlertCircle, MessageSquare, PlayCircle, ExternalLink } from "lucide-react";
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
  url?: string;
  fileData?: string;
  fileType?: string;
}

interface Project {
  name: string;
  description: string;
  videoUrl?: string;
  reportVideoUrl?: string;
  startDate: string;
  endDate: string;
  status: string;
  steps: Step[];
  files: ProjectFile[];
}

interface Client {
  id: number;
  uniqueId: string;
  accessToken?: string;
  name: string;
  contact: string;
  email: string;
  progression: number;
  project: Project;
}

const defaultProjectDates = () => {
  const startDate = new Date().toISOString().split('T')[0];
  const endDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return { startDate, endDate };
};

const normalizeProject = (project: Partial<Project> | null | undefined): Project => {
  const { startDate, endDate } = defaultProjectDates();
  const rawSteps = Array.isArray(project?.steps) ? project.steps : [];
  const rawFiles = Array.isArray(project?.files) ? project.files : [];

  return {
    name: typeof project?.name === 'string' ? project.name : '',
    description: typeof project?.description === 'string' ? project.description : '',
    videoUrl: typeof project?.videoUrl === 'string' ? project.videoUrl.trim() : '',
    reportVideoUrl: typeof project?.reportVideoUrl === 'string' ? project.reportVideoUrl.trim() : '',
    startDate: typeof project?.startDate === 'string' ? project.startDate : startDate,
    endDate: typeof project?.endDate === 'string' ? project.endDate : endDate,
    status: typeof project?.status === 'string' ? project.status : '',
    steps: rawSteps.map((step, index) => ({
      id: typeof step?.id === 'number' ? step.id : Date.now() + index,
      name: typeof step?.name === 'string' ? step.name : '',
      date: typeof step?.date === 'string' ? step.date : '',
      status: step?.status === 'Terminé' ? 'Terminé' : 'En cours',
    })),
    files: rawFiles.map((file, index) => ({
      id: typeof file?.id === 'number' ? file.id : Date.now() + index,
      name: typeof file?.name === 'string' ? file.name : '',
      date: typeof file?.date === 'string' ? file.date : startDate,
      size: typeof file?.size === 'string' ? file.size : '-',
      status: file?.status === 'completed' || file?.status === 'in-progress' ? file.status : 'pending',
      url: typeof file?.url === 'string' ? file.url.trim() : undefined,
      fileData: typeof file?.fileData === 'string' ? file.fileData : undefined,
      fileType: typeof file?.fileType === 'string' ? file.fileType : undefined,
    })),
  };
};

const toSafeExternalUrl = (value: string) => {
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeClient = (client: any): Client => ({
  id: 0,
  uniqueId: String(client?.uniqueId ?? client?.id ?? ''),
  accessToken: typeof client?.accessToken === 'string' ? client.accessToken : undefined,
  name: typeof client?.name === 'string' ? client.name : '',
  contact: typeof client?.contact === 'string' ? client.contact : '',
  email: typeof client?.email === 'string' ? client.email : '',
  progression: Number.isFinite(Number(client?.progression)) ? Math.min(100, Math.max(0, Number(client.progression))) : 0,
  project: normalizeProject(client?.project),
});

export default function ClientPage() {
  const params = useParams();
  const portalToken = params.id as string;
  const adminUserId = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? 'admin-user-id';
  const [activeTab, setActiveTab] = useState("introduction");
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isIntroductionPlaying, setIsIntroductionPlaying] = useState(false);
  const [isIntroductionReady, setIsIntroductionReady] = useState(false);
  const [introductionThumbnailUrl, setIntroductionThumbnailUrl] = useState("");
  const [isReportPlaying, setIsReportPlaying] = useState(false);
  const [isReportReady, setIsReportReady] = useState(false);
  const [reportThumbnailUrl, setReportThumbnailUrl] = useState("");
  const defaultTitleRef = useRef<string>('');
  const clientUniqueId = client?.uniqueId || '';
  const getYoutubeId = (url: string) => {
    try {
      const candidateUrl = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
      const parsed = new URL(candidateUrl);
      if (parsed.hostname === "youtu.be") {
        return parsed.pathname.replace("/", "").split("/")[0] || "";
      }
      if (parsed.hostname.includes("youtube.com")) {
        if (parsed.pathname.startsWith("/embed/")) {
          return parsed.pathname.split("/embed/")[1] || "";
        }
        if (parsed.pathname.startsWith("/shorts/")) {
          return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
        }
        if (parsed.pathname.startsWith("/live/")) {
          return parsed.pathname.split("/live/")[1]?.split("/")[0] || "";
        }
        return parsed.searchParams.get("v") || "";
      }
    } catch {}
    return "";
  };

  useEffect(() => {
    const loadClientData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/${portalToken}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setClient(normalizeClient(data));
          setError(false);
        } else {
          const fallbackLoaded = (() => {
            const savedData = localStorage.getItem('clientData');
            if (!savedData) return false;
            try {
              const clients: Client[] = JSON.parse(savedData);
              const foundClient = clients.find(c => c.accessToken === portalToken);
              if (foundClient) {
                setClient(normalizeClient(foundClient));
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
            const foundClient = clients.find(c => c.accessToken === portalToken);
            if (foundClient) {
              setClient(normalizeClient(foundClient));
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

    if (portalToken) {
      loadClientData();
    }
  }, [portalToken]);

  const loadConversation = async (userId: string) => {
    setIsConversationLoading(true);
    setConversationError(null);
    setConversationId(null);

    try {
      const res = await fetch(`/api/conversations?portalToken=${encodeURIComponent(portalToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId1: userId, userId2: adminUserId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setConversationError(typeof errorData?.error === 'string' ? errorData.error : 'Impossible de charger le chat');
        return;
      }

      const data = await res.json();
      setConversationId(data.id);
      setConversationError(null);
    } catch (error) {
      console.error('Error fetching conversation:', error);
      setConversationId(null);
      setConversationError('Impossible de charger le chat');
    } finally {
      setIsConversationLoading(false);
    }
  };

  useEffect(() => {
    if (clientUniqueId) {
      void loadConversation(clientUniqueId);
    }
  }, [clientUniqueId, portalToken, adminUserId]);

  // Seed initial unread count from server messages on load
  useEffect(() => {
    const seedUnread = async () => {
      if (!conversationId || !clientUniqueId) return;
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages?portalToken=${encodeURIComponent(portalToken)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const initialCount = data.filter((m: any) => !m.read && m.senderId !== clientUniqueId).length;
            setUnreadCount(prev => Math.max(prev, initialCount));
          }
        }
      } catch (err) {
        console.error('Erreur lors du calcul initial des non lus:', err);
      }
    };
    seedUnread();
  }, [conversationId, clientUniqueId]);

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
  }, [unreadCount, activeTab]);

  const introductionVideoUrl = client?.project?.videoUrl || "";
  const introductionVideoId = getYoutubeId(introductionVideoUrl);
  const defaultIntroductionThumbnailUrl = introductionVideoId
    ? `https://i.ytimg.com/vi/${introductionVideoId}/maxresdefault.jpg`
    : "";
  const introductionEmbedUrl = introductionVideoId
    ? `https://www.youtube-nocookie.com/embed/${introductionVideoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&controls=1&fs=1&cc_load_policy=0`
    : "";
  const reportVideoUrl = client?.project?.reportVideoUrl || "";
  const reportVideoId = getYoutubeId(reportVideoUrl);
  const defaultReportThumbnailUrl = reportVideoId
    ? `https://i.ytimg.com/vi/${reportVideoId}/maxresdefault.jpg`
    : "";
  const reportEmbedUrl = reportVideoId
    ? `https://www.youtube-nocookie.com/embed/${reportVideoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&controls=1&fs=1&cc_load_policy=0`
    : "";

  useEffect(() => {
    setIsIntroductionPlaying(false);
    setIsIntroductionReady(false);
  }, [introductionVideoUrl]);

  useEffect(() => {
    setIntroductionThumbnailUrl(defaultIntroductionThumbnailUrl);
  }, [defaultIntroductionThumbnailUrl]);

  useEffect(() => {
    setIsReportPlaying(false);
    setIsReportReady(false);
  }, [reportVideoUrl]);

  useEffect(() => {
    setReportThumbnailUrl(defaultReportThumbnailUrl);
  }, [defaultReportThumbnailUrl]);

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
          uniqueId: prev?.uniqueId || clientUniqueId,
        } as Client;
        return {
          ...base,
          name: updated?.name ?? prev?.name ?? '',
          contact: updated?.contact ?? prev?.contact ?? '',
          email: updated?.email ?? prev?.email ?? '',
          progression: (updated?.progression ?? prev?.progression ?? 0) as number,
          project: normalizeProject(updated?.project ?? prev?.project),
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
  const tabs = ["introduction", "project", "files", "formulaire", "chat", "report"] as const;

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
            <div className="bg-white/80 backdrop-blur-2xl rounded-3xl p-2 shadow-2xl border border-gray-200/60 flex gap-2 justify-center w-full max-w-5xl lg:max-w-6xl xl:max-w-7xl">
              {tabs.map((tab) => {
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
                      {tab === "introduction" && (
                        <PlayCircle className="w-5 h-5" />
                      )}
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
                      {tab === "report" && (
                        <PlayCircle className="w-5 h-5" />
                      )}
                    </span>
                    
                    {chatUnread > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-5 px-1.5 bg-red-600 text-white text-[10px] leading-5 rounded-full border border-white flex items-center justify-center">
                        {chatUnread}
                      </span>
                    )}
      
                    <span className="hidden sm:inline">
                      {tab === "introduction"
                        ? "Introduction"
                        : tab === "project"
                        ? "Mon projet"
                        : tab === "files"
                        ? "Mes fichiers"
                        : tab === "formulaire"
                        ? "Formulaire"
                        : tab === "chat"
                        ? "Chat"
                        : tab === "report"
                        ? "Rapport de votre site"
                        : "Contact"}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
      
          <main className="max-w-7xl mx-auto px-4 sm:px-8 py-10 pb-20 space-y-10">
            {activeTab === "introduction" && (
              <div className="space-y-8">
                <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden">
                  <div className="p-6 sm:p-8">
                    {introductionVideoId ? (
                      <div className="relative overflow-hidden rounded-[28px] border border-gray-200 bg-slate-950 shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
                        <div className="relative pt-[56.25%]">
                          {!isIntroductionPlaying ? (
                            <button
                              type="button"
                              onClick={() => setIsIntroductionPlaying(true)}
                              className="group absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden"
                              aria-label="Lire la vidéo d'introduction"
                            >
                              <img
                                src={introductionThumbnailUrl}
                                alt="Aperçu de la vidéo d'introduction"
                                className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-100"
                                loading="eager"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onError={() => {
                                  const fallbackThumbnail = introductionVideoId
                                    ? `https://i.ytimg.com/vi/${introductionVideoId}/hqdefault.jpg`
                                    : "";
                                  if (fallbackThumbnail && introductionThumbnailUrl !== fallbackThumbnail) {
                                    setIntroductionThumbnailUrl(fallbackThumbnail);
                                  }
                                }}
                              />
                              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.36))] transition duration-500 group-hover:bg-[linear-gradient(180deg,rgba(15,23,42,0.03),rgba(15,23,42,0.24))]" />
                            </button>
                          ) : (
                            <>
                              {!isIntroductionReady && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 px-6">
                                  <div className="w-full overflow-hidden rounded-full bg-white/15">
                                    <div className="h-1.5 w-1/3 rounded-full bg-gradient-to-r from-white via-slate-200 to-white animate-[gradient_1.8s_ease-in-out_infinite]" />
                                  </div>
                                </div>
                              )}
                              <iframe
                                className="absolute inset-0 h-full w-full"
                                src={introductionEmbedUrl}
                                title="Vidéo d'introduction"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                loading="lazy"
                                referrerPolicy="strict-origin-when-cross-origin"
                                onLoad={() => setIsIntroductionReady(true)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[28px] border border-dashed border-gray-300 bg-gradient-to-br from-gray-50 to-white p-10 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
                          <PlayCircle size={30} />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900">Introduction bientôt disponible</h3>
                        <p className="mt-2 text-sm text-gray-600 sm:text-base">
                          La vidéo d&apos;introduction n&apos;a pas encore été ajoutée pour ce projet.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "report" && (
              <div className="space-y-8">
                <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden">
                  <div className="p-6 sm:p-8">
                    {reportVideoId ? (
                      <div className="relative overflow-hidden rounded-[28px] border border-gray-200 bg-slate-950 shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
                        <div className="relative pt-[56.25%]">
                          {!isReportPlaying ? (
                            <button
                              type="button"
                              onClick={() => setIsReportPlaying(true)}
                              className="group absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden"
                              aria-label="Lire le rapport vidéo"
                            >
                              <img
                                src={reportThumbnailUrl}
                                alt="Aperçu du rapport vidéo"
                                className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-100"
                                loading="eager"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onError={() => {
                                  const fallbackThumbnail = reportVideoId
                                    ? `https://i.ytimg.com/vi/${reportVideoId}/hqdefault.jpg`
                                    : "";
                                  if (fallbackThumbnail && reportThumbnailUrl !== fallbackThumbnail) {
                                    setReportThumbnailUrl(fallbackThumbnail);
                                  }
                                }}
                              />
                              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.36))] transition duration-500 group-hover:bg-[linear-gradient(180deg,rgba(15,23,42,0.03),rgba(15,23,42,0.24))]" />
                            </button>
                          ) : (
                            <>
                              {!isReportReady && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 px-6">
                                  <div className="w-full overflow-hidden rounded-full bg-white/15">
                                    <div className="h-1.5 w-1/3 rounded-full bg-gradient-to-r from-white via-slate-200 to-white animate-[gradient_1.8s_ease-in-out_infinite]" />
                                  </div>
                                </div>
                              )}
                              <iframe
                                className="absolute inset-0 h-full w-full"
                                src={reportEmbedUrl}
                                title="Rapport de votre site"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                loading="lazy"
                                referrerPolicy="strict-origin-when-cross-origin"
                                onLoad={() => setIsReportReady(true)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[28px] border border-dashed border-gray-300 bg-gradient-to-br from-gray-50 to-white p-10 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
                          <PlayCircle size={30} />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900">Rapport bientôt disponible</h3>
                        <p className="mt-2 text-sm text-gray-600 sm:text-base">
                          Le rapport vidéo de votre site n&apos;a pas encore été ajouté.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

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
                  <p className="text-center text-lg sm:text-xl font-semibold text-gray-700">
                    Vous pouvez consulter l&apos;avancement de la maquette
                  </p>
                </div>
                <div className="p-6 sm:p-8 space-y-4">
                  {(!client.project.files || client.project.files.length === 0) ? (
                    <div className="text-center py-12 bg-gray-50 rounded-xl">
                      <p className="text-gray-600">Aucun lien de fichier disponible pour le moment</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-4 py-4">
                      {client.project.files.map(file => (
                        <div key={file.id} className="w-full max-w-xl text-center">
                          {toSafeExternalUrl(file.url || '') ? (
                            <a
                              href={toSafeExternalUrl(file.url || '') || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-700 via-gray-800 to-zinc-900 px-6 py-4 text-sm font-bold text-white transition-all duration-300 hover:shadow-2xl"
                              title={file.name}
                            >
                              <ExternalLink size={16} />
                              Ouvrir {file.name}
                            </a>
                          ) : file.fileData ? (
                            <button
                              onClick={() => downloadFile(file)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-700 via-gray-800 to-zinc-900 px-6 py-4 text-sm font-bold text-white transition-all duration-300 hover:shadow-2xl"
                              title={file.name}
                            >
                              <Download size={16} />
                              Télécharger {file.name}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
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
            {activeTab === "chat" && (
              <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-2xl border border-gray-200/60 overflow-hidden p-6 sm:p-10 flex flex-col h-[500px]">
                {conversationId && clientUniqueId ? (
                  <Chat 
                    conversationId={conversationId} 
                    currentUser={{ 
                      id: clientUniqueId, 
                      email: client.email, 
                      name: client.name, 
                      role: 'user', 
                      createdAt: new Date(), 
                      updatedAt: new Date() 
                    }}
                    portalToken={portalToken}
                    onNewMessage={handleNewMessage}
                  />
                ) : isConversationLoading ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="h-12 w-12 rounded-full border-4 border-slate-200 border-t-slate-700 animate-spin" />
                    <div>
                      <p className="text-lg font-semibold text-gray-900">Chargement du chat…</p>
                      <p className="mt-1 text-sm text-gray-600">
                        La conversation se prépare, elle va s&apos;afficher automatiquement.
                      </p>
                    </div>
                  </div>
                ) : conversationError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div>
                      <p className="text-lg font-semibold text-gray-900">Le chat n&apos;a pas pu se lancer</p>
                      <p className="mt-1 text-sm text-gray-600">{conversationError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadConversation(clientUniqueId)}
                      className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      Réessayer
                    </button>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="h-12 w-12 rounded-full border-4 border-slate-200 border-t-slate-700 animate-spin" />
                    <div>
                      <p className="text-lg font-semibold text-gray-900">Chargement du chat…</p>
                      <p className="mt-1 text-sm text-gray-600">
                        La conversation se prépare, elle va s&apos;afficher automatiquement.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Notifications client */}
      {clientUniqueId && (
        <ClientNotification 
          clientId={clientUniqueId}
          portalToken={portalToken}
          conversationId={conversationId}
          onNewMessage={handleNewMessage}
          onPortalUpdate={handlePortalUpdate}
        />
      )}
    </>
  );
}
