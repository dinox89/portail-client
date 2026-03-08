'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Search, Edit2, Trash2, X, Save, Building2, ExternalLink, Copy, Check, Lock, LogOut, MessageSquare, RefreshCcw } from "lucide-react";
import Chat from "@/components/chat";
import AdminMessaging from '@/components/admin-messaging';
import { io } from 'socket.io-client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useRouter } from "next/navigation";

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

  // Type pour la gestion du formulaire d'ajout de fichier
  interface NewFile {
    name: string;
    url: string;
    date: string;
    status: 'completed' | 'in-progress' | 'pending';
    size?: string;
  }

interface Project {
  name: string;
  description: string;
  videoUrl?: string;
  reportVideoUrl?: string;
  reportVideos?: Array<{
    id: number;
    name: string;
    url: string;
  }>;
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

const createEmptyProject = (): Project => {
  const { startDate, endDate } = defaultProjectDates();

  return {
    name: '',
    description: '',
    videoUrl: '',
    reportVideoUrl: '',
    reportVideos: [],
    startDate,
    endDate,
    status: '',
    steps: [],
    files: [],
  };
};

const clampProgression = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
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

const createLocalId = (value: string) => {
  if (!value) {
    return Date.now();
  }

  return Array.from(value).reduce((hash, char) => {
    return ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }, 7) || Date.now();
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

const normalizeProject = (project: Partial<Project> | null | undefined): Project => {
  const fallback = createEmptyProject();
  const rawSteps = Array.isArray(project?.steps) ? project.steps : [];
  const rawFiles = Array.isArray(project?.files) ? project.files : [];

  return {
    ...fallback,
    ...project,
    videoUrl: typeof project?.videoUrl === 'string' ? project.videoUrl.trim() : '',
    reportVideoUrl: typeof project?.reportVideoUrl === 'string' ? project.reportVideoUrl.trim() : '',
    reportVideos: Array.isArray((project as any)?.reportVideos)
      ? (project as any).reportVideos.map((item: any, index: number) => ({
          id: typeof item?.id === 'number' ? item.id : Date.now() + index,
          name: typeof item?.name === 'string' ? item.name : `Rapport ${index + 1}`,
          url: typeof item?.url === 'string' ? item.url.trim() : '',
        }))
      : (typeof project?.reportVideoUrl === 'string' && project.reportVideoUrl.trim()
          ? [{
              id: Date.now(),
              name: 'Rapport vidéo',
              url: project.reportVideoUrl.trim(),
            }]
          : []),
    steps: rawSteps.map((step, index) => ({
      id: typeof step?.id === 'number' ? step.id : Date.now() + index,
      name: typeof step?.name === 'string' ? step.name : '',
      date: typeof step?.date === 'string' ? step.date : '',
      status: step?.status === 'Terminé' ? 'Terminé' : 'En cours',
    })),
    files: rawFiles.map((file, index) => ({
      id: typeof file?.id === 'number' ? file.id : Date.now() + index,
      name: typeof file?.name === 'string' ? file.name : '',
      date: typeof file?.date === 'string' ? file.date : fallback.startDate,
      size: typeof file?.size === 'string' ? file.size : '-',
      status: file?.status === 'completed' || file?.status === 'in-progress' ? file.status : 'pending',
      url: typeof file?.url === 'string' ? file.url.trim() : undefined,
      fileData: typeof file?.fileData === 'string' ? file.fileData : undefined,
      fileType: typeof file?.fileType === 'string' ? file.fileType : undefined,
    })),
  };
};

const normalizeClient = (client: Partial<Client> & { project?: Partial<Project> | null; id?: unknown; uniqueId?: string }): Client => {
  const uniqueId = String(client.uniqueId ?? client.id ?? '');

  return {
    id: typeof client.id === 'number' ? client.id : createLocalId(uniqueId),
    uniqueId,
    accessToken: typeof client.accessToken === 'string' ? client.accessToken : undefined,
    name: typeof client.name === 'string' ? client.name : '',
    contact: typeof client.contact === 'string' ? client.contact : '',
    email: typeof client.email === 'string' ? client.email : '',
    progression: clampProgression(client.progression),
    project: normalizeProject(client.project),
  };
};

const readStoredClients = () => {
  if (typeof window === 'undefined') {
    return [];
  }

  const savedData = window.localStorage.getItem('clientData');
  if (!savedData) {
    return [];
  }

  try {
    const parsedData = JSON.parse(savedData);
    if (!Array.isArray(parsedData)) {
      return [];
    }

    return parsedData.map((client) => normalizeClient(client));
  } catch (error) {
    console.error('Erreur lors du chargement des données:', error);
    return [];
  }
};

const mergeClients = (primary: Client[], secondary: Client[]) => {
  const merged = new Map<string, Client>();

  primary.forEach((client) => {
    merged.set(client.uniqueId, normalizeClient(client));
  });

  secondary.forEach((client) => {
    if (!merged.has(client.uniqueId)) {
      merged.set(client.uniqueId, normalizeClient(client));
    }
  });

  return Array.from(merged.values());
};

const App: React.FC = () => {
  const adminUserId = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? 'admin-user-id';
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [password, setPassword] = useState('');
  const [showPasswordError, setShowPasswordError] = useState(false);
  const router = useRouter();
  
  const [clients, setClients] = useState<Client[]>([]);
  
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newClient, setNewClient] = useState({ name: '', contact: '', email: '' });
  const [editingProject, setEditingProject] = useState<Client | null>(null);
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [newStep, setNewStep] = useState({ name: '', date: '', status: 'En cours' as const });
  const [showAddFileModal, setShowAddFileModal] = useState(false);
  const [newFile, setNewFile] = useState<NewFile>({ name: '', url: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedChatClient, setSelectedChatClient] = useState<Client | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showAdminMessaging, setShowAdminMessaging] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [unreadByClient, setUnreadByClient] = useState<Record<string, number>>({});
  const [lastSeenByClient, setLastSeenByClient] = useState<Record<string, string | null>>({});
  const [conversationClientMap, setConversationClientMap] = useState<Record<string, string>>({});
  const socketRef = useRef<any>(null);
  const editingProjectRef = useRef<Client | null>(null);
  const defaultTitleRef = useRef<string>('');
  const baselineUnreadRef = useRef<number>(0);
  const adminInitRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const loadClients = async () => {
      const storedClients = readStoredClients();
      let nextClients = storedClients;

      try {
        const res = await fetch('/api/portal', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const remoteClients = Array.isArray(data)
            ? data.map((client) => normalizeClient({ ...client, uniqueId: client.id }))
            : [];
          nextClients = mergeClients(remoteClients, storedClients);
        }
      } catch (error) {
        console.error('Erreur lors du chargement des clients depuis le serveur:', error);
      }

      if (!cancelled) {
        setClients(nextClients);
      }
    };

    void loadClients();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined' && !defaultTitleRef.current) {
      defaultTitleRef.current = document.title;
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const base = defaultTitleRef.current || document.title;
    const shouldIndicate = newMessageCount > 0 && (document.hidden || (!showChatModal && !showAdminMessaging));
    if (shouldIndicate) {
      const prefix = `(${newMessageCount}) `;
      const withoutPrefix = base.replace(/^\(\d+\)\s*/, '');
      document.title = prefix + withoutPrefix;
    } else if (!document.hidden) {
      document.title = defaultTitleRef.current || document.title;
    }
  }, [newMessageCount, showChatModal, showAdminMessaging]);

  useEffect(() => {
    if (clients.length > 0) {
      localStorage.setItem('clientData', JSON.stringify(clients));
    } else {
      localStorage.removeItem('clientData');
    }
  }, [clients]);

  useEffect(() => {
    editingProjectRef.current = editingProject;
  }, [editingProject]);

  // Charger les conversations admin et initialiser les compteurs par client
  useEffect(() => {
    if (!isAuthenticated) return;
    const loadAdminConversations = async () => {
      try {
        const res = await fetch('/api/conversations/admin');
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, string> = {};
        const unreadMap: Record<string, number> = {};
        data.forEach((conv: any) => {
          const clientUser = conv.users.find((u: any) => u.id !== adminUserId);
          if (clientUser) {
            map[conv.id] = clientUser.id;
            unreadMap[clientUser.id] = conv.unreadCount || 0;
          }
        });
        const lastSeenMap = Object.fromEntries(
          data
            .map((conv: any) => conv.users.find((u: any) => u.id !== adminUserId))
            .filter(Boolean)
            .map((user: any) => [user.id, user.lastSeenAt ?? null])
        );
        setConversationClientMap(map);
        setUnreadByClient(unreadMap);
        setLastSeenByClient(lastSeenMap);
        const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
        baselineUnreadRef.current = total;
        setNewMessageCount(0);
      } catch (e) {
        console.error('Erreur de chargement des conversations admin:', e);
      }
    };
    loadAdminConversations();
  }, [isAuthenticated, adminUserId]);

  // Initialiser le socket admin et synchroniser les compteurs
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const setup = async () => {
      const adminId = adminUserId;
      let token: string | null = null;
      try {
        const res = await fetch(`/api/realtime/token?userId=${encodeURIComponent(adminId)}`);
        if (res.ok) {
          const data = await res.json();
          token = data?.token || null;
        }
      } catch {}
      if (cancelled) return;
      const socket = io({
        path: '/socket.io',
        addTrailingSlash: false,
        auth: token ? { token } : { userId: adminId },
      });
      socketRef.current = socket;

      socket.on('adminUnreadCount', (payload: { totalUnreadCount: number; conversations: { conversationId: string; unreadCount: number }[] }) => {
        if (!adminInitRef.current) {
          adminInitRef.current = true;
          baselineUnreadRef.current = payload.totalUnreadCount;
          setNewMessageCount(0);
        } else {
          const delta = Math.max(0, payload.totalUnreadCount - baselineUnreadRef.current);
          setNewMessageCount(delta);
        }
        setUnreadByClient(prev => {
          const next = { ...prev };
          payload.conversations.forEach(item => {
            const clientId = conversationClientMap[item.conversationId];
            if (clientId) {
              next[clientId] = item.unreadCount;
            }
          });
          return next;
        });
      });

      socket.on('adminNewMessage', (payload: { conversationId: string; unreadCount: number }) => {
        setNewMessageCount(prev => prev + 1);
        setUnreadByClient(prev => {
          const next = { ...prev };
          const clientId = conversationClientMap[payload.conversationId];
          if (clientId) {
            next[clientId] = payload.unreadCount;
          }
          return next;
        });
      });

      socket.on('connect_error', (err: any) => {
        console.error('Socket connection error:', err);
      });
    };
    setup();

    return () => {
      cancelled = true;
      if (socketRef.current) socketRef.current.close();
    };
  }, [conversationClientMap, isAuthenticated, adminUserId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const t = window.setInterval(async () => {
      try {
        const res = await fetch('/api/conversations/admin');
        if (!res.ok) return;
        const data = await res.json();
        const unreadMap: Record<string, number> = {};
        const map: Record<string, string> = {};
        data.forEach((conv: any) => {
          const clientUser = conv.users.find((u: any) => u.id !== adminUserId);
          if (clientUser) {
            map[conv.id] = clientUser.id;
            unreadMap[clientUser.id] = conv.unreadCount || 0;
          }
        });
        const lastSeenMap = Object.fromEntries(
          data
            .map((conv: any) => conv.users.find((u: any) => u.id !== adminUserId))
            .filter(Boolean)
            .map((user: any) => [user.id, user.lastSeenAt ?? null])
        );
        setConversationClientMap(map);
        setUnreadByClient(unreadMap);
        setLastSeenByClient(lastSeenMap);
        const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
        const delta = Math.max(0, total - baselineUnreadRef.current);
        setNewMessageCount(delta);
      } catch {}
    }, 2000);
    return () => window.clearInterval(t);
  }, [isAuthenticated, adminUserId]);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
        localStorage.setItem('isAuthenticated', 'true');
        setShowPasswordError(false);
        setPassword('');
        return;
      }
    } catch {}
    setShowPasswordError(true);
    setTimeout(() => setShowPasswordError(false), 3000);
  };

  const handleLogout = async () => {
    setIsAuthenticated(false);
    localStorage.removeItem('isAuthenticated');
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {}
    router.replace('/admin/login');
  };

  const generateUniqueId = () => {
    const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as any) : undefined;
    if (cryptoObj?.randomUUID) {
      return cryptoObj.randomUUID();
    }
    return 'client-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  };

  const getPortalLink = (accessToken?: string) => {
    if (!accessToken) return 'Lien en cours de génération...';
    return `${window.location.origin}/portal/${accessToken}`;
  };

  const syncClientState = (client: Client) => {
    const normalizedClient = normalizeClient(client);

    setClients((prev) => {
      const exists = prev.some((current) => current.uniqueId === normalizedClient.uniqueId);
      if (!exists) {
        return [normalizedClient, ...prev];
      }

      return prev.map((current) => current.uniqueId === normalizedClient.uniqueId ? normalizedClient : current);
    });
    setSelectedClient((prev) => prev?.uniqueId === normalizedClient.uniqueId ? normalizedClient : prev);
  };

  const updateEditingProject = (updater: (current: Client) => Client) => {
    const current = editingProjectRef.current;
    if (!current) {
      return;
    }

    const next = normalizeClient(updater(current));
    editingProjectRef.current = next;
    setEditingProject(next);
    syncClientState(next);
  };

  const persistClientPortal = async (client: Client) => {
    const normalizedClient = normalizeClient(client);

    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uniqueId: normalizedClient.uniqueId,
          name: normalizedClient.name,
          contact: normalizedClient.contact,
          email: normalizedClient.email,
          progression: normalizedClient.progression,
          project: normalizedClient.project,
        }),
      });
      if (!res.ok) {
        return normalizedClient.accessToken || null;
      }

      const data = await res.json();
      const savedClient = normalizeClient({
        ...normalizedClient,
        ...data,
        uniqueId: data?.id ?? normalizedClient.uniqueId,
        accessToken: data?.accessToken ?? normalizedClient.accessToken,
      });

      syncClientState(savedClient);
      setEditingProject((prev) => prev?.uniqueId === savedClient.uniqueId ? savedClient : prev);

      return savedClient.accessToken || normalizedClient.accessToken || null;
    } catch (e) {
      console.error('Erreur de persistance ClientPortal:', e);
    }

    return normalizedClient.accessToken || null;
  };

  const copyPortalLink = async (client: Client) => {
    const accessToken = await persistClientPortal(client);
    if (!accessToken) return;
    const link = getPortalLink(accessToken);
    await navigator.clipboard.writeText(link);
    setCopiedId(accessToken);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const regeneratePortalLink = async (client: Client) => {
    try {
      const res = await fetch('/api/portal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: client.uniqueId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const updatedClient = normalizeClient({
        ...client,
        accessToken: data?.accessToken ?? client.accessToken,
      });
      syncClientState(updatedClient);
      setEditingProject((prev) => prev?.uniqueId === updatedClient.uniqueId ? updatedClient : prev);
    } catch {}
  };

  const openClientPortal = async (client: Client) => {
    const accessToken = await persistClientPortal(client);
    if (!accessToken) return;
    const portalUrl = getPortalLink(accessToken);
    console.log('🚀 Ouverture du portail pour:', client.name);
    console.log('📋 URL:', portalUrl);
    console.log('📊 Données du projet:', client.project);

    window.open(portalUrl, '_blank', 'noopener,noreferrer');
  };

  const openChatModal = async (client: Client) => {
    setSelectedChatClient(client);
    setShowChatModal(true);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId1: client.uniqueId, userId2: adminUserId }),
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error('API Error:', errorData);
        return;
      }
      
      const data = await res.json();
      setConversationId(data.id);
      setConversationClientMap(prev => ({ ...prev, [data.id]: client.uniqueId }));
      socketRef.current?.emit('joinConversation', data.id);
      socketRef.current?.emit('markAsRead', { conversationId: data.id, userId: adminUserId });
      setUnreadByClient(prev => ({ ...prev, [client.uniqueId]: 0 }));
      try {
        await fetch(`/api/conversations/${data.id}/mark-read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: adminUserId })
        });
      } catch {}
    } catch (error) {
      console.error('Error fetching conversation:', error);
    }
  };

  const handleAddClient = () => {
    if (newClient.name && newClient.contact && newClient.email) {
      const uniqueId = generateUniqueId();
      const client = normalizeClient({
        id: createLocalId(uniqueId),
        uniqueId: uniqueId,
        ...newClient,
        progression: 0,
        project: createEmptyProject(),
      });

      syncClientState(client);
      setNewClient({ name: '', contact: '', email: '' });
      setShowNewClientModal(false);
      setSelectedClient(client);
      setEditingProject(client);
      void persistClientPortal(client);
    }
  };

  const handleDeleteClient = async (client: Client) => {
    const clientUniqueId = client.uniqueId;

    setClients(prev => prev.filter(c => c.uniqueId !== clientUniqueId));
    if (selectedClient?.uniqueId === clientUniqueId) {
      setSelectedClient(null);
      setEditingProject(null);
    }

    try {
      await fetch('/api/portal', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: clientUniqueId }),
      });
    } catch (e) {
      console.error('Erreur de suppression client côté serveur:', e);
    }
  };

  const handleSaveProject = async () => {
    if (editingProject) {
      const currentProject = normalizeClient(editingProject);
      syncClientState(currentProject);
      setEditingProject(currentProject);
      setShowSuccessMessage(true);
      
      console.log('🔄 Données sauvegardées:', {
        clientId: currentProject.uniqueId,
        projectData: currentProject.project,
        progression: currentProject.progression
      });

      await persistClientPortal(currentProject);
      
      setTimeout(() => setShowSuccessMessage(false), 3000);
    }
  };

  const handleUpdateProject = async () => {
    await handleSaveProject();
    setEditingProject(null);
  };

  const handleProgressionChange = (value: string) => {
    const nextProgression = clampProgression(value);
    updateEditingProject((current) => ({ ...current, progression: nextProgression }));
  };

  const handleAddStep = () => {
    if (newStep.name && newStep.date && editingProject) {
      const step: Step = { id: Date.now(), ...newStep };
      updateEditingProject((current) => ({
        ...current,
        project: { ...current.project, steps: [...current.project.steps, step] }
      }));
      setNewStep({ name: '', date: '', status: 'En cours' });
      setShowAddStepModal(false);
    }
  };

  const handleDeleteStep = (stepId: number) => {
    updateEditingProject((current) => ({
      ...current,
      project: { ...current.project, steps: current.project.steps.filter((step) => step.id !== stepId) }
    }));
  };

  const handleUpdateStep = (stepId: number, field: keyof Step, value: string) => {
    updateEditingProject((current) => ({
      ...current,
      project: {
        ...current.project,
        steps: current.project.steps.map((step) => step.id === stepId ? { ...step, [field]: value } : step)
      }
    }));
  };

  const handleAddFile = () => {
    if (!editingProject) return;

    const safeUrl = toSafeExternalUrl(newFile.url);
    if (!newFile.name.trim() || !safeUrl) {
      alert('Veuillez saisir un nom et un lien valide');
      return;
    }

    const file: ProjectFile = {
      id: Date.now(),
      name: newFile.name.trim(),
      date: newFile.date,
      size: 'Lien externe',
      status: newFile.status,
      url: safeUrl,
    };

    updateEditingProject((current) => ({
      ...current,
      project: { ...current.project, files: [...current.project.files, file] }
    }));

    setNewFile({ name: '', url: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
    setShowAddFileModal(false);
  };

  const handleDeleteFile = (fileId: number) => {
    updateEditingProject((current) => ({
      ...current,
      project: { ...current.project, files: current.project.files.filter((file) => file.id !== fileId) }
    }));
  };

  const handleUpdateFile = (fileId: number, field: keyof ProjectFile, value: string) => {
    updateEditingProject((current) => ({
      ...current,
      project: {
        ...current.project,
        files: current.project.files.map((file) => file.id === fileId ? { ...file, [field]: value } : file)
      }
    }));
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.contact.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Page de connexion
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="text-white" size={40} />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Gestion Clients</h1>
            <p className="text-gray-600">Accédez à votre espace de gestion</p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Entrez votre mot de passe"
                  className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {showPasswordError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                Mot de passe incorrect
              </div>
            )}

            <button
              onClick={handleLogin}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Se connecter
            </button>
          </div>

        </div>
      </div>
    );
  }

  // Interface de gestion des clients
  if (selectedClient && editingProject) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <button 
              onClick={() => { 
                setSelectedClient(null); 
                setEditingProject(null); 
              }} 
              className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
            >
              Retour à la liste
            </button>
            <h1 className="text-2xl font-bold">{selectedClient.name}</h1>
            <div className="flex gap-3">
              <button 
                onClick={() => openClientPortal(editingProject)} 
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2" 
                title="Ouvrir le portail client"
              >
                <ExternalLink size={20} />
                Voir le portail
              </button>
              <button 
                onClick={handleSaveProject} 
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
              >
                <Save size={20} />
                Enregistrer
              </button>
              <button 
                onClick={handleLogout} 
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
                title="Se déconnecter"
              >
                <LogOut size={20} />
                Déconnexion
              </button>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-800 font-semibold mb-1">🔗 Lien du portail client :</p>
                <code className="text-sm text-blue-600 bg-white px-3 py-1 rounded">
                  {getPortalLink(editingProject.accessToken)}
                </code>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => copyPortalLink(editingProject)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  {copiedId === editingProject.accessToken ? (
                    <>
                      <Check size={18} />
                      Copié !
                    </>
                  ) : (
                    <>
                      <Copy size={18} />
                      Copier
                    </>
                  )}
                </button>
                <button
                  onClick={() => regeneratePortalLink(editingProject)}
                  className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex items-center gap-2"
                  title="Régénérer le lien"
                >
                  <RefreshCcw size={18} />
                  Régénérer
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-8 mb-6">
            <h2 className="text-xl font-bold mb-6">Détails du Projet</h2>
            
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Nom du projet</label>
              <input
                type="text"
                value={editingProject.project.name}
                onChange={(e) => updateEditingProject((current) => ({
                  ...current,
                  project: { ...current.project, name: e.target.value }
                }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Description du projet</label>
              <input
                type="text"
                value={editingProject.project.description}
                onChange={(e) => updateEditingProject((current) => ({
                  ...current,
                  project: { ...current.project, description: e.target.value }
                }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium mb-2">Lien vidéo YouTube</label>
                  <input
                type="url"
                value={editingProject.project.videoUrl || ''}
                onChange={(e) => updateEditingProject((current) => ({
                  ...current,
                  project: { ...current.project, videoUrl: e.target.value }
                }))}
                placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">Date de début</label>
                <input
                  type="date"
                  value={editingProject.project.startDate}
                  onChange={(e) => updateEditingProject((current) => ({
                    ...current,
                    project: { ...current.project, startDate: e.target.value }
                  }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Date de fin</label>
                <input
                  type="date"
                  value={editingProject.project.endDate}
                  onChange={(e) => updateEditingProject((current) => ({
                    ...current,
                    project: { ...current.project, endDate: e.target.value }
                  }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Statut du projet</label>
              <input
                type="text"
                value={editingProject.project.status}
                onChange={(e) => updateEditingProject((current) => ({
                  ...current,
                  project: { ...current.project, status: e.target.value }
                }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Avancement du projet ({editingProject.progression}%)
              </label>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all"
                  style={{ width: `${editingProject.progression}%` }}
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={editingProject.progression}
                onChange={(e) => handleProgressionChange(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Étapes du Projet</h2>
              <button
                onClick={() => setShowAddStepModal(true)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
              >
                <Plus size={20} />
                Ajouter
              </button>
            </div>

            {editingProject.project.steps.length === 0 ? (
              <p className="text-gray-500 text-center py-8">Aucune étape ajoutée</p>
            ) : (
              editingProject.project.steps.map(step => (
                <div key={step.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg mb-4">
                  <input
                    type="text"
                    value={step.name}
                    onChange={(e) => handleUpdateStep(step.id, 'name', e.target.value)}
                    className="font-medium flex-1 mr-4 px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex items-center gap-4">
                    <input
                      type="text"
                      value={step.date}
                      onChange={(e) => handleUpdateStep(step.id, 'date', e.target.value)}
                      placeholder="Ex: 1 Nov"
                      className="text-gray-600 w-24 px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={step.status}
                      onChange={(e) => handleUpdateStep(step.id, 'status', e.target.value)}
                      className="px-3 py-1 bg-gray-100 rounded-lg border border-transparent hover:border-gray-300 focus:outline-none focus:border-blue-500"
                    >
                      <option value="En cours">En cours</option>
                      <option value="Terminé">Terminé</option>
                    </select>
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-8 mt-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Liens de fichiers du projet</h2>
              <button
                onClick={() => setShowAddFileModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <ExternalLink size={20} />
                Ajouter un lien
              </button>
            </div>

            {(!editingProject.project.files || editingProject.project.files.length === 0) ? (
              <p className="text-gray-500 text-center py-8">Aucun lien de fichier ajouté</p>
            ) : (
              <div className="space-y-4">
                {editingProject.project.files.map(file => (
                  <div key={file.id} className="flex items-center justify-between gap-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="flex-1">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={file.name}
                          onChange={(e) => handleUpdateFile(file.id, 'name', e.target.value)}
                          className="font-medium w-full px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        />
                        <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                          <input
                            type="date"
                            value={file.date}
                            onChange={(e) => handleUpdateFile(file.id, 'date', e.target.value)}
                            className="text-sm px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                          />
                          <span>•</span>
                          <input
                            type="url"
                            value={file.url || ''}
                            onChange={(e) => handleUpdateFile(file.id, 'url', e.target.value)}
                            placeholder="https://..."
                            className="min-w-[260px] text-sm px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={file.status}
                        onChange={(e) => handleUpdateFile(file.id, 'status', e.target.value)}
                        className="px-3 py-1 bg-white rounded-lg border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
                      >
                        <option value="completed">Disponible</option>
                        <option value="in-progress">En préparation</option>
                        <option value="pending">Bientôt</option>
                      </select>
                      {toSafeExternalUrl(file.url || '') && (
                        <a
                          href={toSafeExternalUrl(file.url || '') || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                          title="Ouvrir le lien"
                        >
                          <ExternalLink size={18} />
                        </a>
                      )}
                      <button
                        onClick={() => handleDeleteFile(file.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-8 mt-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Rapports du site</h2>
              <button
                onClick={() => updateEditingProject((current) => ({
                  ...current,
                  project: {
                    ...current.project,
                    reportVideos: [
                      ...(current.project.reportVideos || []),
                      { id: Date.now(), name: '', url: '' },
                    ],
                  },
                }))}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 flex items-center gap-2"
              >
                <ExternalLink size={20} />
                Ajouter une video
              </button>
            </div>

            {(!editingProject.project.reportVideos || editingProject.project.reportVideos.length === 0) ? (
              <p className="text-gray-500 text-center py-8">Aucune video de rapport ajoutée</p>
            ) : (
              <div className="space-y-4">
                {editingProject.project.reportVideos.map((video) => (
                  <div key={video.id} className="flex items-center justify-between gap-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={video.name}
                        onChange={(e) => updateEditingProject((current) => ({
                          ...current,
                          project: {
                            ...current.project,
                            reportVideos: (current.project.reportVideos || []).map((item) =>
                              item.id === video.id ? { ...item, name: e.target.value } : item
                            ),
                          },
                        }))}
                        className="font-medium w-full px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        placeholder="Nom du rapport"
                      />
                      <div className="mt-2">
                        <input
                          type="url"
                          value={video.url}
                          onChange={(e) => updateEditingProject((current) => ({
                            ...current,
                            project: {
                              ...current.project,
                              reportVideos: (current.project.reportVideos || []).map((item) =>
                                item.id === video.id ? { ...item, url: e.target.value } : item
                              ),
                            },
                          }))}
                          placeholder="https://www.youtube.com/watch?v=..."
                          className="w-full text-sm px-2 py-1 border border-transparent hover:border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {toSafeExternalUrl(video.url) && (
                        <a
                          href={toSafeExternalUrl(video.url) || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                          title="Ouvrir la video"
                        >
                          <ExternalLink size={18} />
                        </a>
                      )}
                      <button
                        onClick={() => updateEditingProject((current) => ({
                          ...current,
                          project: {
                            ...current.project,
                            reportVideos: (current.project.reportVideos || []).filter((item) => item.id !== video.id),
                          },
                        }))}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {showAddFileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Ajouter un lien de fichier</h2>
                <button
                  onClick={() => {
                    setShowAddFileModal(false);
                    setNewFile({ name: '', url: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Nom d'affichage <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newFile.name}
                    onChange={(e) => setNewFile({ ...newFile, name: e.target.value })}
                    placeholder="Ex: Maquette Figma"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Lien du fichier <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={newFile.url}
                    onChange={(e) => setNewFile({ ...newFile, url: e.target.value })}
                    placeholder="https://..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Date</label>
                  <input
                    type="date"
                    value={newFile.date}
                    onChange={(e) => setNewFile({ ...newFile, date: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Statut</label>
                  <select
                    value={newFile.status}
                    onChange={(e) => setNewFile({ ...newFile, status: e.target.value as any })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="completed">Disponible</option>
                    <option value="in-progress">En préparation</option>
                    <option value="pending">Bientôt disponible</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => {
                    setShowAddFileModal(false);
                    setNewFile({ name: '', url: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
                  }}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddFile}
                  disabled={!newFile.name.trim() || !toSafeExternalUrl(newFile.url)}
                  className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        )}

        {showAddStepModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Nouvelle Étape</h2>
                <button
                  onClick={() => {
                    setShowAddStepModal(false);
                    setNewStep({ name: '', date: '', status: 'En cours' });
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Nom de l'étape <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newStep.name}
                    onChange={(e) => setNewStep({ ...newStep, name: e.target.value })}
                    placeholder="Ex: Démarrage et échanges"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newStep.date}
                    onChange={(e) => setNewStep({ ...newStep, date: e.target.value })}
                    placeholder="Ex: 1 Nov"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Statut</label>
                  <select
                    value={newStep.status}
                    onChange={(e) => setNewStep({ ...newStep, status: e.target.value as any })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="En cours">En cours</option>
                    <option value="Terminé">Terminé</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => {
                    setShowAddStepModal(false);
                    setNewStep({ name: '', date: '', status: 'En cours' });
                  }}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddStep}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        )}

        {showSuccessMessage && (
          <div className="fixed bottom-8 right-8 bg-white shadow-lg rounded-lg p-4 border-l-4 border-green-500">
            <p className="font-semibold">✅ Modifications enregistrées et sauvegardées !</p>
          </div>
        )}

        {/* Notification par bulle supprimée: les badges s'affichent directement sur l'icône de chat du client */}

        {/* Modale de messagerie admin */}
        {showAdminMessaging && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-8 max-w-6xl w-full max-h-[90vh] overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Messagerie Admin</h2>
                <button
                  onClick={() => setShowAdminMessaging(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>
              <AdminMessaging />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center">
                <Users className="text-white" size={32} />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Gestion Clients</h1>
                <p className="text-gray-600">Suivi des onboardings et clients</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowNewClientModal(true)} 
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium"
              >
                <Plus size={20} />
                Nouveau Client
              </button>
              <button 
                onClick={handleLogout} 
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
                title="Se déconnecter"
              >
                <LogOut size={20} />
                Déconnexion
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Rechercher un client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClients.map(client => (
            <div key={client.uniqueId} className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold">{client.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const normalizedClient = normalizeClient(client);
                      setSelectedClient(normalizedClient);
                      setEditingProject(normalizedClient);
                    }}
                    className="text-blue-600 hover:text-blue-700"
                    title="Modifier le projet"
                  >
                    <Edit2 size={20} />
                  </button>
                  <button
                    onClick={() => openClientPortal(client)}
                    className="text-green-600 hover:text-green-700"
                    title="Ouvrir le portail client"
                  >
                    <ExternalLink size={20} />
                  </button>
                  <button
                    onClick={() => openChatModal(client)}
                    className="text-purple-600 hover:text-purple-700 relative"
                    title="Ouvrir le chat"
                  >
                    <MessageSquare size={20} />
                    {unreadByClient[client.uniqueId] > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {unreadByClient[client.uniqueId]}
                      </span>
                    )}
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        className="text-red-500 hover:text-red-700"
                        title="Supprimer le client"
                      >
                        <Trash2 size={20} />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer ce client ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Êtes-vous sûr de vouloir supprimer cette fiche client ? Cette action est définitive.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteClient(client)}>
                          Supprimer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <div className="flex items-center gap-2 text-gray-600 mb-2">
                <Building2 size={16} />
                <span className="text-sm">{client.contact}</span>
              </div>

              <div className="text-sm text-gray-500 mb-2">
                Dernière connexion : {formatLastSeen(lastSeenByClient[client.uniqueId])}
              </div>

              <div className="text-xs text-gray-500 mb-4 font-mono bg-gray-50 p-2 rounded">
                ID: {client.uniqueId}
              </div>

              <div className="mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">Progression</span>
                  <span className="font-bold">{client.progression}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${client.progression}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {showNewClientModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Nouveau Client</h2>
                <button
                  onClick={() => setShowNewClientModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Nom de l'entreprise <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newClient.name}
                    onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Contact principal <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newClient.contact}
                    onChange={(e) => setNewClient({ ...newClient, contact: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={newClient.email}
                    onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => setShowNewClientModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddClient}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        )}

        {showChatModal && selectedChatClient && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh]">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Chat avec {selectedChatClient.name}</h2>
                <button
                  onClick={() => setShowChatModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="h-96 overflow-y-auto border rounded-lg p-4 mb-4">
                {conversationId ? (
                  <Chat 
                    conversationId={conversationId} 
                    currentUser={{
                      id: adminUserId,
                      email: 'admin@example.com',
                      name: 'Admin',
                      role: 'admin',
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    Chargement de la conversation...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showAdminMessaging && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh]">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Messagerie Administrative</h2>
                <button
                  onClick={() => setShowAdminMessaging(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="h-[70vh]">
                <AdminMessaging />
              </div>
            </div>
          </div>
        )}

        {editingProject && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Modifier le projet - {editingProject.name}</h2>
                <button
                  onClick={() => setEditingProject(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Nom du projet</label>
                  <input
                    type="text"
                    value={editingProject.name}
                    onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Contact</label>
                  <input
                    type="text"
                    value={editingProject.contact}
                    onChange={(e) => setEditingProject({ ...editingProject, contact: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Email</label>
                  <input
                    type="email"
                    value={editingProject.email}
                    onChange={(e) => setEditingProject({ ...editingProject, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Progression (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editingProject.progression}
                    onChange={(e) => setEditingProject({ ...editingProject, progression: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description du projet</label>
                  <textarea
                    value={editingProject.project.description || ''}
                    onChange={(e) => setEditingProject({ 
                      ...editingProject, 
                      project: { ...editingProject.project, description: e.target.value }
                    })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Lien vidéo YouTube</label>
                  <input
                    type="text"
                    value={editingProject.project.videoUrl || ''}
                    onChange={(e) => setEditingProject({ 
                      ...editingProject, 
                      project: { ...editingProject.project, videoUrl: e.target.value }
                    })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Étapes du projet</label>
                  <div className="space-y-2">
                    {editingProject.project.steps?.map((step, index) => (
                      <div key={step.id ?? index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={step.name}
                          onChange={(e) => {
                            const newSteps = editingProject.project.steps.map((s, i) => 
                              i === index ? { ...s, name: e.target.value } : s
                            );
                            setEditingProject({ 
                              ...editingProject, 
                              project: { ...editingProject.project, steps: newSteps }
                            });
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => {
                            const newSteps = editingProject.project.steps.filter((_, i) => i !== index);
                            setEditingProject({ 
                              ...editingProject, 
                              project: { ...editingProject.project, steps: newSteps }
                            });
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const newSteps = [
                          ...(editingProject.project.steps || []),
                          { id: Date.now(), name: '', date: new Date().toISOString().split('T')[0], status: 'En cours' as const }
                        ];
                        setEditingProject({ 
                          ...editingProject, 
                          project: { ...editingProject.project, steps: newSteps }
                        });
                      }}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      + Ajouter une étape
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Liens de fichiers du projet</label>
                  <div className="space-y-2">
                    {editingProject.project.files?.map((file, index) => (
                      <div key={file.id ?? index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={file.name}
                          onChange={(e) => {
                            const newFiles = editingProject.project.files.map((f, i) => 
                              i === index ? { ...f, name: e.target.value } : f
                            );
                            setEditingProject({ 
                              ...editingProject, 
                              project: { ...editingProject.project, files: newFiles }
                            });
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                          type="url"
                          value={file.url || ''}
                          onChange={(e) => {
                            const newFiles = editingProject.project.files.map((f, i) =>
                              i === index ? { ...f, url: e.target.value } : f
                            );
                            setEditingProject({
                              ...editingProject,
                              project: { ...editingProject.project, files: newFiles }
                            });
                          }}
                          placeholder="https://..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => {
                            const newFiles = editingProject.project.files.filter((_, i) => i !== index);
                            setEditingProject({ 
                              ...editingProject, 
                              project: { ...editingProject.project, files: newFiles }
                            });
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const newFiles = [
                          ...(editingProject.project.files || []),
                          { id: Date.now(), name: '', url: '', date: new Date().toISOString().split('T')[0], size: 'Lien externe', status: 'pending' as const }
                        ];
                        setEditingProject({ 
                          ...editingProject, 
                          project: { ...editingProject.project, files: newFiles }
                        });
                      }}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      + Ajouter un lien
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Rapports du site</label>
                  <div className="space-y-2">
                    {editingProject.project.reportVideos?.map((video, index) => (
                      <div key={video.id ?? index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={video.name}
                          onChange={(e) => {
                            const nextVideos = (editingProject.project.reportVideos || []).map((item, i) =>
                              i === index ? { ...item, name: e.target.value } : item
                            );
                            setEditingProject({
                              ...editingProject,
                              project: { ...editingProject.project, reportVideos: nextVideos }
                            });
                          }}
                          placeholder="Nom du rapport"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                          type="url"
                          value={video.url}
                          onChange={(e) => {
                            const nextVideos = (editingProject.project.reportVideos || []).map((item, i) =>
                              i === index ? { ...item, url: e.target.value } : item
                            );
                            setEditingProject({
                              ...editingProject,
                              project: { ...editingProject.project, reportVideos: nextVideos }
                            });
                          }}
                          placeholder="https://www.youtube.com/watch?v=..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => {
                            const nextVideos = (editingProject.project.reportVideos || []).filter((_, i) => i !== index);
                            setEditingProject({
                              ...editingProject,
                              project: { ...editingProject.project, reportVideos: nextVideos }
                            });
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const nextVideos = [
                          ...(editingProject.project.reportVideos || []),
                          { id: Date.now(), name: '', url: '' }
                        ];
                        setEditingProject({
                          ...editingProject,
                          project: { ...editingProject.project, reportVideos: nextVideos }
                        });
                      }}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      + Ajouter une video
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  onClick={() => setEditingProject(null)}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleUpdateProject}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notification par bulle supprimée: les badges sont gérés via socket et l'onglet Messagerie */}
    </div>
  );
}

export default App;
