'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Search, Edit2, Trash2, X, Save, Building2, ExternalLink, Copy, Check, Upload, FileText, Download, Lock, LogOut, Image as ImageIcon, MessageSquare } from "lucide-react";
import Chat from "@/components/chat";
import AdminMessaging from '@/components/admin-messaging';
import { io } from 'socket.io-client';

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
    fileData?: string; // Base64 data for PNG files
    fileType?: string;
  }

  // Type pour la gestion du formulaire d'ajout de fichier
  interface NewFile {
    name: string;
    date: string;
    status: 'completed' | 'in-progress' | 'pending';
    size?: string;
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

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [showPasswordError, setShowPasswordError] = useState(false);
  
  const [clients, setClients] = useState<Client[]>([
    {
      id: 1,
      uniqueId: 'client-demo-001',
      name: 'Demo Client',
      contact: 'John Doe',
      email: 'john@example.com',
      progression: 10,
      project: {
        name: 'Landing Page',
        description: 'Votre projet est en cours de réalisation',
        startDate: '2025-10-25',
        endDate: '2025-11-09',
        status: 'En production',
        steps: [
          { id: 1, name: 'Démarrage et échanges', date: '1 Nov', status: 'Terminé' }
        ],
        files: []
      }
    }
  ]);
  
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newClient, setNewClient] = useState({ name: '', contact: '', email: '' });
  const [editingProject, setEditingProject] = useState<Client | null>(null);
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [newStep, setNewStep] = useState({ name: '', date: '', status: 'En cours' as const });
  const [showAddFileModal, setShowAddFileModal] = useState(false);
  const [newFile, setNewFile] = useState<NewFile>({ name: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedChatClient, setSelectedChatClient] = useState<Client | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showAdminMessaging, setShowAdminMessaging] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [unreadByClient, setUnreadByClient] = useState<Record<string, number>>({});
  const [conversationClientMap, setConversationClientMap] = useState<Record<string, string>>({});
  const socketRef = useRef<any>(null);

  // Charger les données sauvegardées au démarrage
  useEffect(() => {
    const savedData = localStorage.getItem('clientData');
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        setClients(parsedData);
      } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
      }
    }
  }, []);

  // Sauvegarder automatiquement les données à chaque modification
  useEffect(() => {
    if (clients.length > 0) {
      localStorage.setItem('clientData', JSON.stringify(clients));
    }
  }, [clients]);

  // Vérifier si l'utilisateur est déjà authentifié
  useEffect(() => {
    const auth = localStorage.getItem('isAuthenticated');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Charger les conversations admin et initialiser les compteurs par client
  useEffect(() => {
    const loadAdminConversations = async () => {
      try {
        const res = await fetch('/api/conversations/admin');
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, string> = {};
        const unreadMap: Record<string, number> = {};
        data.forEach((conv: any) => {
          const clientUser = conv.users.find((u: any) => u.id !== 'admin-user-id');
          if (clientUser) {
            map[conv.id] = clientUser.id;
            unreadMap[clientUser.id] = conv.unreadCount || 0;
          }
        });
        setConversationClientMap(map);
        setUnreadByClient(unreadMap);
        const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
        setNewMessageCount(total);
      } catch (e) {
        console.error('Erreur de chargement des conversations admin:', e);
      }
    };
    loadAdminConversations();
  }, []);

  // Initialiser le socket admin et synchroniser les compteurs
  useEffect(() => {
    const socket = io({ path: '/socket.io', addTrailingSlash: false, auth: { userId: 'admin-user-id' } });
    socketRef.current = socket;

    socket.on('adminUnreadCount', (payload: { totalUnreadCount: number; conversations: { conversationId: string; unreadCount: number }[] }) => {
      setNewMessageCount(payload.totalUnreadCount);
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

    return () => {
      socket.close();
    };
  }, [conversationClientMap]);

  const handleLogin = () => {
    if (password === 'admin') {
      setIsAuthenticated(true);
      localStorage.setItem('isAuthenticated', 'true');
      setShowPasswordError(false);
      setPassword('');
    } else {
      setShowPasswordError(true);
      setTimeout(() => setShowPasswordError(false), 3000);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('isAuthenticated');
  };

  const generateUniqueId = () => {
    return 'client-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
  };

  const getPortalLink = (uniqueId: string) => {
    return `${window.location.origin}/portal/${uniqueId}`;
  };

  const copyPortalLink = (uniqueId: string) => {
    const link = getPortalLink(uniqueId);
    navigator.clipboard.writeText(link);
    setCopiedId(uniqueId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openClientPortal = async (client: Client) => {
    const portalUrl = `${window.location.origin}/portal/${client.uniqueId}`;
    console.log('🚀 Ouverture du portail pour:', client.name);
    console.log('📋 URL:', portalUrl);
    console.log('📊 Données du projet:', client.project);

    // Upsert des données du portail côté serveur pour rendre le lien accessible sur tout appareil
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uniqueId: client.uniqueId,
          name: client.name,
          contact: client.contact,
          email: client.email,
          progression: client.progression,
          project: client.project,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Échec de l’upsert du portail client:', err);
      }
    } catch (e) {
      console.error('Erreur réseau lors de l’upsert du portail client:', e);
    }

    window.open(portalUrl, '_blank', 'noopener,noreferrer');
  };

  const openChatModal = async (client: Client) => {
    setSelectedChatClient(client);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId1: client.uniqueId, userId2: 'admin-user-id' }),
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error('API Error:', errorData);
        return;
      }
      
      const data = await res.json();
      setConversationId(data.id);
      setConversationClientMap(prev => ({ ...prev, [data.id]: client.uniqueId }));
      // Rejoindre la conversation et marquer comme lu côté socket
      socketRef.current?.emit('joinConversation', data.id);
      socketRef.current?.emit('markAsRead', { conversationId: data.id, userId: 'admin-user-id' });
      // Réinitialiser le compteur local pour ce client
      setUnreadByClient(prev => ({ ...prev, [client.uniqueId]: 0 }));
      setShowChatModal(true);
    } catch (error) {
      console.error('Error fetching conversation:', error);
    }
  };

  const openAdminMessaging = () => {
    setShowAdminMessaging(true);
  };

  const handleNewMessageCount = (count: number) => {
    setNewMessageCount(count);
  };

  const handleAddClient = () => {
    if (newClient.name && newClient.contact && newClient.email) {
      const uniqueId = generateUniqueId();
      const client: Client = {
        id: Date.now(),
        uniqueId: uniqueId,
        ...newClient,
        progression: 0,
        project: {
          name: '',
          description: '',
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: '',
          steps: [],
          files: []
        }
      };
      setClients([...clients, client]);
      setNewClient({ name: '', contact: '', email: '' });
      setShowNewClientModal(false);
      setSelectedClient(client);
      setEditingProject(client);
    }
  };

  const handleDeleteClient = (id: number) => {
    setClients(clients.filter(c => c.id !== id));
    if (selectedClient?.id === id) {
      setSelectedClient(null);
      setEditingProject(null);
    }
  };

  const handleSaveProject = () => {
    if (editingProject) {
      setClients(clients.map(c => c.id === editingProject.id ? editingProject : c));
      setSelectedClient(editingProject);
      setShowSuccessMessage(true);
      
      console.log('🔄 Données sauvegardées:', {
        clientId: editingProject.uniqueId,
        projectData: editingProject.project,
        progression: editingProject.progression
      });
      
      setTimeout(() => setShowSuccessMessage(false), 3000);
    }
  };

  // Corrige l’erreur: bouton Enregistrer appelle une fonction inexistante
  const handleUpdateProject = () => {
    handleSaveProject();
    // Fermer l’éditeur après enregistrement pour éviter des états incohérents
    setEditingProject(null);
  };

  const handleProgressionChange = (value: string) => {
    if (editingProject) {
      setEditingProject({ ...editingProject, progression: parseInt(value) });
    }
  };

  const handleAddStep = () => {
    if (newStep.name && newStep.date && editingProject) {
      const step: Step = { id: Date.now(), ...newStep };
      setEditingProject({
        ...editingProject,
        project: { ...editingProject.project, steps: [...editingProject.project.steps, step] }
      });
      setNewStep({ name: '', date: '', status: 'En cours' });
      setShowAddStepModal(false);
    }
  };

  const handleDeleteStep = (stepId: number) => {
    if (editingProject) {
      setEditingProject({
        ...editingProject,
        project: { ...editingProject.project, steps: editingProject.project.steps.filter(s => s.id !== stepId) }
      });
    }
  };

  const handleUpdateStep = (stepId: number, field: keyof Step, value: string) => {
    if (editingProject) {
      setEditingProject({
        ...editingProject,
        project: {
          ...editingProject.project,
          steps: editingProject.project.steps.map(s => s.id === stepId ? { ...s, [field]: value } : s)
        }
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Vérifier si c'est un fichier PNG
      if (!file.type.includes('png')) {
        alert('Seuls les fichiers PNG sont autorisés');
        return;
      }
      
      // Vérifier la taille (max 2MB)
      if (file.size > 2 * 1024 * 1024) {
        alert('La taille du fichier ne doit pas dépasser 2MB');
        return;
      }
      
      setUploadingFile(file);
      const sizeInKB = (file.size / 1024).toFixed(2);
      setNewFile({ ...newFile, name: file.name, size: `${sizeInKB} KB` });
    }
  };

  const handleAddFile = async () => {
    if (newFile.name && uploadingFile && editingProject) {
      try {
        // Convertir le fichier en base64 pour le stockage
        const base64Data = await fileToBase64(uploadingFile);
        
        const file: ProjectFile = {
          id: Date.now(),
          name: newFile.name,
          date: newFile.date,
          size: newFile.size || '-',
          status: newFile.status,
          fileData: base64Data,
          fileType: uploadingFile.type
        };
        
        setEditingProject({
          ...editingProject,
          project: { ...editingProject.project, files: [...(editingProject.project.files || []), file] }
        });
        
        setNewFile({ name: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
        setUploadingFile(null);
        setShowAddFileModal(false);
        
        console.log('📤 Fichier PNG ajouté et stocké:', file);
      } catch (error) {
        console.error('Erreur lors du traitement du fichier:', error);
        alert('Erreur lors du traitement du fichier');
      }
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleDeleteFile = (fileId: number) => {
    if (editingProject) {
      setEditingProject({
        ...editingProject,
        project: { ...editingProject.project, files: editingProject.project.files.filter(f => f.id !== fileId) }
      });
    }
  };

  const handleUpdateFile = (fileId: number, field: keyof ProjectFile, value: string) => {
    if (editingProject) {
      setEditingProject({
        ...editingProject,
        project: {
          ...editingProject.project,
          files: editingProject.project.files.map(f => f.id === fileId ? { ...f, [field]: value } : f)
        }
      });
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

          <div className="mt-6 text-center text-sm text-gray-500">
            Utilisez le mot de passe : <span className="font-mono bg-gray-100 px-2 py-1 rounded">admin</span>
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
                  {getPortalLink(editingProject.uniqueId)}
                </code>
              </div>
              <button
                onClick={() => copyPortalLink(editingProject.uniqueId)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                {copiedId === editingProject.uniqueId ? (
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
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-8 mb-6">
            <h2 className="text-xl font-bold mb-6">Détails du Projet</h2>
            
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Nom du projet</label>
              <input
                type="text"
                value={editingProject.project.name}
                onChange={(e) => setEditingProject({
                  ...editingProject,
                  project: { ...editingProject.project, name: e.target.value }
                })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Description du projet</label>
              <input
                type="text"
                value={editingProject.project.description}
                onChange={(e) => setEditingProject({
                  ...editingProject,
                  project: { ...editingProject.project, description: e.target.value }
                })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">Date de début</label>
                <input
                  type="date"
                  value={editingProject.project.startDate}
                  onChange={(e) => setEditingProject({
                    ...editingProject,
                    project: { ...editingProject.project, startDate: e.target.value }
                  })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Date de fin</label>
                <input
                  type="date"
                  value={editingProject.project.endDate}
                  onChange={(e) => setEditingProject({
                    ...editingProject,
                    project: { ...editingProject.project, endDate: e.target.value }
                  })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Statut du projet</label>
              <input
                type="text"
                value={editingProject.project.status}
                onChange={(e) => setEditingProject({
                  ...editingProject,
                  project: { ...editingProject.project, status: e.target.value }
                })}
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
              <h2 className="text-xl font-bold">Fichiers PNG du Projet</h2>
              <button
                onClick={() => setShowAddFileModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <Upload size={20} />
                Ajouter un PNG
              </button>
            </div>

            {(!editingProject.project.files || editingProject.project.files.length === 0) ? (
              <p className="text-gray-500 text-center py-8">Aucun fichier PNG ajouté</p>
            ) : (
              <div className="space-y-4">
                {editingProject.project.files.map(file => (
                  <div key={file.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                        <ImageIcon className="text-purple-600" size={24} />
                      </div>
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
                          <span>{file.size}</span>
                          <span>•</span>
                          <span className="text-purple-600 font-medium">PNG</span>
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
                      <button
                        onClick={() => downloadFile(file)}
                        className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                        title="Télécharger le fichier"
                      >
                        <Download size={18} />
                      </button>
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
        </div>

        {showAddFileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Ajouter un fichier PNG</h2>
                <button
                  onClick={() => {
                    setShowAddFileModal(false);
                    setNewFile({ name: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
                    setUploadingFile(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Sélectionner un fichier PNG <span className="text-red-500">*</span>
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-500 transition-colors cursor-pointer">
                    <input
                      type="file"
                      accept=".png,image/png"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <ImageIcon className="mx-auto mb-2 text-gray-400" size={32} />
                      <p className="text-sm text-gray-600">
                        {uploadingFile ? uploadingFile.name : 'Cliquez pour choisir un fichier PNG'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Max: 2MB • Format: PNG uniquement</p>
                      {uploadingFile && (
                        <p className="text-xs text-gray-500 mt-1">
                          Taille: {newFile.size}
                        </p>
                      )}
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Nom d'affichage
                  </label>
                  <input
                    type="text"
                    value={newFile.name}
                    onChange={(e) => setNewFile({ ...newFile, name: e.target.value })}
                    placeholder="Ex: maquette-finale.png"
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
                    setNewFile({ name: '', date: new Date().toISOString().split('T')[0], status: 'completed', size: '' });
                    setUploadingFile(null);
                  }}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleAddFile}
                  disabled={!uploadingFile}
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
            <div key={client.id} className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold">{client.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedClient(client);
                      setEditingProject(client);
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
                  <button
                    onClick={() => handleDeleteClient(client.id)}
                    className="text-red-500 hover:text-red-700"
                    title="Supprimer le client"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-gray-600 mb-2">
                <Building2 size={16} />
                <span className="text-sm">{client.contact}</span>
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

        {showChatModal && selectedChatClient && conversationId && (
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
                <Chat 
                  conversationId={conversationId} 
                  currentUser={{
                    id: 'admin-user-id',
                    email: 'admin@example.com',
                    name: 'Admin',
                    role: 'admin',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  }}
                />
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
                  <label className="block text-sm font-medium mb-2">Fichiers PNG du projet</label>
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
                          { id: Date.now(), name: '', date: new Date().toISOString().split('T')[0], size: '0 KB', status: 'pending' as const, fileType: 'image/png', fileData: '' }
                        ];
                        setEditingProject({ 
                          ...editingProject, 
                          project: { ...editingProject.project, files: newFiles }
                        });
                      }}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      + Ajouter un fichier PNG
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