import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { db } from "@/lib/db";

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
      const userId = socket.handshake.auth.userId;
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

      // Envoi de message
      socket.on("sendMessage", async (data: { conversationId: string; content: string }) => {
        try {
          const { conversationId, content } = data;

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
          this.io.to(conversationId).emit("newMessage", message);

          // Notifier les administrateurs des nouveaux messages
          if (user.role !== "admin") {
            await this.notifyAdminsOfNewMessage(conversationId, message);
          }

        } catch (error) {
          console.error("Erreur lors de l'envoi du message:", error);
          socket.emit("error", { message: "Erreur lors de l'envoi du message" });
        }
      });

      // Marquer les messages comme lus
      socket.on("markAsRead", async (data: { conversationId: string; userId: string }) => {
        try {
          const { conversationId, userId: readerId } = data;

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
