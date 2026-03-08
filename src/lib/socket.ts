import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

// Global IO instance access for API routes to emit events
let ioInstance: SocketIOServer | null = null;
export const getIO = () => ioInstance;

interface SocketData {
  userId: string;
  role?: string;
}

interface UserSocket {
  socketId: string;
  userId: string;
  role?: string;
}

export class SocketManager {
  private io: SocketIOServer;
  private userSockets: Map<string, UserSocket[]> = new Map();
  private socketToUser: Map<string, UserSocket> = new Map();
  private lastPresenceWriteAt: Map<string, number> = new Map();

  constructor(server: HTTPServer) {
    const allowedOrigins = (() => {
      const fromEnv = process.env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean);
      if (fromEnv && fromEnv.length > 0) return fromEnv;
      if (process.env.NODE_ENV === "production") {
        // Fallback: must be set in production for security
        return ["https://your-domain.com"];
      }
      return ["http://localhost:3000", "http://localhost:3001"];
    })();

    this.io = new SocketIOServer(server, {
      path: "/socket.io",
      addTrailingSlash: false,
      pingInterval: 15000,
      pingTimeout: 5000,
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    // Expose instance globally
    ioInstance = this.io;

    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.on("connection", async (socket) => {
      let userId = socket.handshake.auth.userId as string | undefined;
      const token = socket.handshake.auth.token as string | undefined;
      const secret = process.env.REALTIME_JWT_SECRET;
      if (secret) {
        if (!token) {
          socket.disconnect();
          return;
        }
        try {
          const payload = jwt.verify(token, secret) as any;
          if (payload?.uid) userId = String(payload.uid);
        } catch {
          socket.disconnect();
          return;
        }
      }
      if (!userId) {
        socket.disconnect();
        return;
      }

      // Récupérer le rôle de l'utilisateur
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { role: true, id: true }
      });

      if (!user) {
        socket.disconnect();
        return;
      }

      const socketData: UserSocket = {
        socketId: socket.id,
        userId: userId,
        role: user.role
      };

      await this.touchLastSeen(userId, true);

      // Ajouter le socket à la liste des sockets de l'utilisateur
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, []);
      }
      this.userSockets.get(userId)!.push(socketData);
      this.socketToUser.set(socket.id, socketData);

      console.log(`User ${userId} (${user.role}) connected with socket ${socket.id}`);

      // Si c'est un admin, envoyer le nombre de messages non lus
      if (user.role === "admin") {
        // Joindre une room globale pour tous les administrateurs
        socket.join("admins");
        await this.notifyAdminOfUnreadMessages(userId);
      }

      // Gestion des conversations
      socket.on("joinConversation", (conversationId: string) => {
        socket.join(conversationId);
        console.log(`User ${userId} joined conversation ${conversationId}`);
      });

      socket.on("leaveConversation", (conversationId: string) => {
        socket.leave(conversationId);
        console.log(`User ${userId} left conversation ${conversationId}`);
      });

      // Heartbeat keepalive
      socket.on("heartbeat", (payload: any) => {
        void this.touchLastSeen(userId);
        socket.emit("heartbeat_ack", { t: payload?.t || Date.now() });
      });

      // Envoi de message
      socket.on("sendMessage", async (
        data: { conversationId: string; content: string; clientTempId?: string },
        ack?: (payload: { ok: boolean; message?: any; error?: string }) => void
      ) => {
        try {
          const { conversationId, content, clientTempId } = data;

          await this.touchLastSeen(userId, true);

          // Créer le message
          const message = await db.message.create({
            data: {
              content,
              senderId: userId,
              conversationId,
              read: false,
            },
            include: {
              sender: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
          });

          // Mettre à jour la conversation
          await db.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          });

          // Émettre le message aux participants de la conversation
          const payload = {
            ...message,
            clientTempId,
          };

          await this.emitToConversationParticipants(conversationId, "newMessage", payload);

          // Notifier les administrateurs des nouveaux messages
          if (user.role !== "admin") {
            await this.notifyAdminsOfNewMessage(conversationId, message);
          }

          ack?.({ ok: true, message: payload });

        } catch (error) {
          console.error("Erreur lors de l'envoi du message:", error);
          socket.emit("error", { message: "Erreur lors de l'envoi du message" });
          ack?.({ ok: false, error: "Erreur lors de l'envoi du message" });
        }
      });

      // Marquer les messages comme lus
      socket.on("markAsRead", async (data: { conversationId: string; userId: string }) => {
        try {
          const { conversationId, userId: readerId } = data;

          await this.touchLastSeen(readerId, true);

          const updatedMessages = await db.message.updateMany({
            where: {
              conversationId,
              senderId: {
                not: readerId,
              },
              read: false,
            },
            data: { read: true },
          });

          this.io.to(conversationId).emit("messagesRead", {
            conversationId,
            userId: readerId,
            count: updatedMessages.count,
          });

          if (updatedMessages.count > 0) {
            const conversation = await db.conversation.findUnique({
              where: { id: conversationId },
              include: {
                users: { select: { id: true, role: true } },
              },
            });

            if (conversation) {
              const admins = conversation.users.filter(u => u.role === "admin");
              for (const admin of admins) {
                await this.notifyAdminOfUnreadMessages(admin.id);
              }
            }
          }

        } catch (error) {
          console.error("Erreur lors du marquage comme lu:", error);
          socket.emit("error", { message: "Erreur lors du marquage comme lu" });
        }
      });

      // Déconnexion
      socket.on("disconnect", () => {
        console.log(`User ${userId} disconnected`);
        this.removeSocket(socket.id);
      });
    });
  }

  private removeSocket(socketId: string) {
    const socketData = this.socketToUser.get(socketId);
    if (socketData) {
      const userSockets = this.userSockets.get(socketData.userId);
      if (userSockets) {
        const filtered = userSockets.filter(s => s.socketId !== socketId);
        if (filtered.length === 0) {
          this.userSockets.delete(socketData.userId);
        } else {
          this.userSockets.set(socketData.userId, filtered);
        }
      }
      this.socketToUser.delete(socketId);
    }
  }

  private async touchLastSeen(userId: string, force = false) {
    const now = Date.now();
    const previousWrite = this.lastPresenceWriteAt.get(userId) || 0;
    if (!force && now - previousWrite < 60000) {
      return;
    }

    this.lastPresenceWriteAt.set(userId, now);
    try {
      await db.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date(now) },
      });
    } catch (error) {
      console.warn(`Impossible de mettre à jour lastSeenAt pour ${userId}:`, error);
    }
  }

  private async emitToConversationParticipants(conversationId: string, event: string, payload: any) {
    this.io.to(conversationId).emit(event, payload);

    try {
      const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        select: {
          users: {
            select: { id: true },
          },
        },
      });

      if (!conversation) return;

      for (const user of conversation.users) {
        this.notifyUser(user.id, event, payload);
      }
    } catch (error) {
      console.error(`Erreur lors de la diffusion ${event} pour la conversation ${conversationId}:`, error);
    }
  }

  private async notifyAdminsOfNewMessage(conversationId: string, message: any) {
    try {
      // Récupérer la conversation pour obtenir les participants
      const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        include: {
          users: { select: { id: true, role: true, name: true } },
        },
      });

      if (!conversation) return;

      // Identifier l'administrateur
      const adminUser = conversation.users.find(u => u.role === "admin");
      const clientUser = conversation.users.find(u => u.role !== "admin");
      if (!adminUser || !clientUser) return;

      // Notifier tous les sockets de l'admin
      const adminSockets = this.userSockets.get(adminUser.id);
      if (adminSockets && adminSockets.length > 0) {
        // Récupérer le nombre de messages non lus pour l'admin
        const unreadCount = await db.message.count({
          where: {
            conversationId,
            senderId: clientUser.id,
            read: false,
          },
        });

        // Envoyer la notification à tous les sockets de l'admin
        adminSockets.forEach(socketData => {
          this.io.to(socketData.socketId).emit("adminNewMessage", {
            conversationId,
            message,
            unreadCount,
            clientName: clientUser.name || clientUser.id,
          });
        });
      }

    } catch (error) {
      console.error("Erreur lors de la notification des admins:", error);
    }
  }

  private async notifyAdminOfUnreadMessages(adminUserId: string) {
    try {
      // Récupérer toutes les conversations où l'admin est impliqué
      const conversations = await db.conversation.findMany({
        where: {
          users: { some: { id: adminUserId } }
        },
        include: {
          users: { select: { id: true, role: true } },
          messages: {
            where: { read: false },
            select: { id: true, senderId: true }
          }
        }
      });

      let totalUnreadCount = 0;
      const conversationsWithUnread: any[] = [];

      for (const conversation of conversations) {
        // Identifier le client (non-admin) de la conversation
        const clientUser = conversation.users.find(u => u.role !== "admin");

        // Compter uniquement les messages du client non lus
        const clientUnreadMessages = clientUser
          ? conversation.messages.filter(msg => msg.senderId === clientUser.id)
          : [];
        const unreadCount = clientUnreadMessages.length;

        if (unreadCount > 0) {
          totalUnreadCount += unreadCount;
          conversationsWithUnread.push({
            conversationId: conversation.id,
            unreadCount
          });
        }
      }

      // Envoyer la notification à tous les sockets de l'admin
      const adminSockets = this.userSockets.get(adminUserId);
      if (adminSockets && adminSockets.length > 0) {
        adminSockets.forEach(socketData => {
          this.io.to(socketData.socketId).emit("adminUnreadCount", {
            totalUnreadCount,
            conversations: conversationsWithUnread
          });
        });
      }

    } catch (error) {
      console.error("Erreur lors de la notification du compteur de messages non lus:", error);
    }
  }

  // Méthode utilitaire pour obtenir les sockets d'un utilisateur
  public getUserSockets(userId: string): UserSocket[] {
    return this.userSockets.get(userId) || [];
  }

  // Méthode pour envoyer une notification à un utilisateur spécifique
  public notifyUser(userId: string, event: string, data: any) {
    const userSockets = this.getUserSockets(userId);
    userSockets.forEach(socketData => {
      this.io.to(socketData.socketId).emit(event, data);
    });
  }

  // Méthode pour diffuser un message à tous les utilisateurs connectés
  public broadcastToAll(event: string, data: any) {
    this.io.emit(event, data);
  }

  // Méthode pour diffuser un message à tous les administrateurs
  public broadcastToAdmins(event: string, data: any) {
    this.socketToUser.forEach((socketData, socketId) => {
      if (socketData.role === "admin") {
        this.io.to(socketId).emit(event, data);
      }
    });
  }
}
