import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { SocketManager } from "./src/lib/socket";
import { db } from "./src/lib/db";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Create the Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Prepare the app and then create the server
app.prepare().then(async () => {
  // Seed admin user if missing (required for auth handshake and notifications)
  try {
    const adminId = process.env.NEXT_PUBLIC_ADMIN_USER_ID || "admin-user-id";
    const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
    await db.user.upsert({
      where: { id: adminId },
      update: {
        email: adminEmail,
        role: "admin",
        name: "Admin",
      },
      create: {
        id: adminId,
        email: adminEmail,
        role: "admin",
        name: "Admin",
      },
    });
    console.log(`> Admin user ensured: ${adminId} (${adminEmail})`);
  } catch (e) {
    console.error("Failed ensuring admin user:", e);
  }

  const server = createServer(async (req, res) => {
    try {
      // Be sure to pass `true` as the second argument to `url.parse`.
      // This tells it to parse the query section of the URL.
      const parsedUrl = parse(req.url!, true);
      const { pathname, query } = parsedUrl;

      // Let Socket.IO handle its own endpoint
      if (pathname === "/socket.io") {
        // Socket.IO will handle this
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // Initialize Socket.IO manager
  const socketManager = new SocketManager(server);

  server
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
}).catch((err) => {
  console.error("Error starting server:", err);
  process.exit(1);
});
