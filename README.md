# Portail Client

Application Next.js pour gerer des portails clients partages avec suivi de projet, videos YouTube, fichiers par liens externes et messagerie admin <-> client.

## Fonctionnalites

- Back-office administrateur pour creer et modifier les clients
- Portail client partage via un lien unique avec token
- Sections client:
  - Introduction
  - Mon projet
  - Formulaire
  - Chat
  - Mes fichiers
  - Rapport de votre site
- Videos YouTube legeres:
  - video d'introduction
  - plusieurs videos de rapport de site
- Fichiers projet via liens externes, sans upload serveur
- Chat admin/client avec suppression de ses propres messages
- Notifications de nouveaux messages et compteur de non lus
- `Last seen` cote admin
- Persistance Postgres via Prisma
- Socket.IO pour le temps reel avec resynchronisation HTTP rapide en secours

## Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Prisma + PostgreSQL
- Socket.IO
- serveur Node personnalise via `server.ts`

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run build:deploy
npm run db:generate
npm run db:push
npm run migrate:deploy
```

## Variables d'environnement

Copiez `.env.example` puis completez:

```bash
NEXT_PUBLIC_ADMIN_USER_ID=
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
REALTIME_JWT_SECRET=
DATABASE_URL=
ALLOWED_ORIGINS=
PORT=3000
```

Variables optionnelles pour ajuster le comportement Socket.IO:

```bash
NEXT_PUBLIC_SOCKET_RECONNECT_ATTEMPTS=10
NEXT_PUBLIC_SOCKET_RECONNECT_DELAY=500
NEXT_PUBLIC_SOCKET_RECONNECT_DELAY_MAX=10000
NEXT_PUBLIC_SOCKET_TIMEOUT=8000
NEXT_PUBLIC_PERF_DELAY=0
```

## Demarrage local

1. Installez les dependances:

```bash
npm install
```

2. Generez Prisma:

```bash
npm run db:generate
```

3. Appliquez la base:

```bash
npm run db:push
```

4. Lancez le projet:

```bash
npm run dev
```

L'application utilise un serveur personnalise, donc le dev et la prod passent par `server.ts`.

## Deploiement Railway

Commande de build recommandee:

```bash
npm install --production=false && npm run build:deploy
```

Commande de demarrage:

```bash
npm run start
```

Points importants:

- `DATABASE_URL` doit pointer vers PostgreSQL
- `ALLOWED_ORIGINS` doit contenir l'URL publique Railway
- `REALTIME_JWT_SECRET` doit etre defini en production
- `NEXT_PUBLIC_ADMIN_USER_ID` doit etre stable entre tous les deploys

## Architecture rapide

- [server.ts](/Users/dinobenoit-loubere/Downloads/portail-client/server.ts): serveur Node + Next + Socket.IO
- [src/app/page.tsx](/Users/dinobenoit-loubere/Downloads/portail-client/src/app/page.tsx): back-office administrateur
- [src/app/portal/[id]/page.tsx](/Users/dinobenoit-loubere/Downloads/portail-client/src/app/portal/[id]/page.tsx): portail client
- [src/components/chat.tsx](/Users/dinobenoit-loubere/Downloads/portail-client/src/components/chat.tsx): chat partage admin/client
- [src/components/admin-messaging.tsx](/Users/dinobenoit-loubere/Downloads/portail-client/src/components/admin-messaging.tsx): messagerie admin complete
- [src/lib/socket.ts](/Users/dinobenoit-loubere/Downloads/portail-client/src/lib/socket.ts): couche temps reel
- [prisma/schema.prisma](/Users/dinobenoit-loubere/Downloads/portail-client/prisma/schema.prisma): schema base de donnees

## Etat actuel

Les mises a jour portail, videos, rapports, fichiers externes, progression, suppression de message et `last seen` sont bien integrees dans le code actuel.

Le point le plus sensible reste la messagerie en production selon l'hebergement:

- le temps reel Socket.IO est actif
- une resynchronisation HTTP rapide est gardee en secours
- si le temps reel est instable sur Railway, le chat doit quand meme se recaler rapidement sans perdre les messages

## Notes

- Les fichiers projet passent par des liens externes, pas par un stockage binaire dans l'application
- Les videos YouTube utilisent des liens/embeds legerement charges pour eviter d'alourdir le portail
- L'admin seed est assure au demarrage via `server.ts`
