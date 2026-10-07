# ToDoApp

Tablero de tareas estilo Scrum/Kanban, pensado para uso personal con colaboración puntual. Más liviano que Jira: lo justo para trabajar rápido.

- **Proyectos → Epics → Tareas → Subtareas**, con roles (dueño, editor, solo lectura) e invitaciones dentro de la app.
- **Tablero** con columnas configurables, arrastrar y soltar, filtros, búsqueda y cambios en **tiempo real**.
- **Sprints opcionales** con backlog, sprint activo y cierre de sprint.
- **GitHub**: ramas, commits y PRs vinculados por la clave de la tarea (`TDA-12`), crear ramas desde la tarea, estado del PR.
- **Automatizaciones** "cuando ocurre X, si se cumple Y, hacer Z", con registro de cada ejecución y su motivo.
- **IA** (DeepSeek) como sugerencia que siempre se revisa antes de aplicar.
- **Buzón** de notificaciones: invitaciones, asignaciones, comentarios y vencimientos.

## Stack

| Capa | Tecnología |
|---|---|
| App | Next.js 16 (App Router) + TypeScript |
| API | tRPC + TanStack Query (actualizaciones optimistas) |
| Datos | PostgreSQL + Drizzle ORM |
| Login | Better Auth con Google |
| UI | Tailwind CSS 4 + shadcn/ui + dnd-kit |
| Tiempo real | Server-Sent Events + `LISTEN/NOTIFY` de Postgres |
| Segundo plano | Worker propio sobre un outbox en Postgres |
| Tests | Vitest (unitarios + integración contra Postgres real) |

**Arquitectura en una línea:** toda escritura pasa por `src/server/services/`, que verifica permisos, guarda el cambio y su historial en una transacción y emite un evento. Ese evento alimenta el tiempo real (NOTIFY → SSE) y las automatizaciones (outbox → worker).

```
src/
├── app/                    # rutas de Next (páginas y endpoints: auth, trpc, realtime, webhooks, health)
├── components/             # UI: board, task, backlog, epics, automations, settings, ai…
├── lib/                    # código compartido cliente/servidor (dominio, ranking, esquema de reglas)
├── server/
│   ├── db/                 # esquema Drizzle, cliente y migraciones
│   ├── permissions/        # matriz de roles (función pura) y verificación de acceso
│   ├── services/           # única capa que escribe
│   ├── events/ realtime/   # eventos de dominio y hub SSE
│   ├── automations/        # motor (puro) y ejecutor
│   ├── repo-providers/     # interfaz genérica + implementación GitHub
│   ├── ai/                 # interfaz AiProvider + cliente compatible con OpenAI (DeepSeek)
│   ├── trpc/               # routers
│   └── worker/             # consumo del outbox y tareas programadas
└── worker.ts               # proceso worker
tests/                      # unit/ e integration/
drizzle/                    # migraciones SQL
deploy/                     # docker-compose y .env de producción
```

## Desarrollo local

Requisitos: Node 24 y Docker.

```bash
npm install
cp .env.example .env          # completá las variables (ver abajo)
npm run db:up                 # Postgres en Docker (crea también la base de tests)
npm run db:migrate
npm run dev                   # web + worker
```

La app queda en el puerto de `APP_URL` (por defecto `http://localhost:3000`).

Mientras no configures Google, en desarrollo hay un **login de prueba** (usuarios "Ana" y "Bruno", o cualquier email) para probar invitaciones y roles con dos navegadores. Se controla con `DEV_LOGIN_ENABLED` y **nunca** funciona con `NODE_ENV=production`.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Next en modo desarrollo + worker con recarga |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run worker` | Solo el worker |
| `npm test` | Todos los tests (necesita `npm run db:up`) |
| `npm run typecheck` / `npm run lint` | Chequeos estáticos |
| `npm run db:generate` | Genera una migración a partir de `schema.ts` |
| `npm run db:migrate` | Aplica migraciones |
| `npm run db:studio` | Drizzle Studio |

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `APP_URL` | sí | URL pública de la app, sin barra final. Define el puerto en desarrollo y los callbacks de OAuth. |
| `APP_TIMEZONE` | no | Zona horaria para fechas límite (ej. `America/Argentina/Buenos_Aires`). Vacío = la del servidor. |
| `DATABASE_URL` | sí | Conexión a Postgres. |
| `DATABASE_URL_TEST` | tests | Base que usan los tests de integración (se borra en cada corrida). |
| `BETTER_AUTH_SECRET` | sí | Secreto de sesiones: `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | sí | Credenciales OAuth de Google. |
| `DEV_LOGIN_ENABLED` | no | `true` habilita el login de prueba (solo fuera de producción). |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | para GitHub | Datos de la GitHub App. Sin ellos la integración aparece como "no configurada". |
| `AI_PROVIDER` | no | `deepseek` (por defecto) u `openai`. Cualquier API compatible con OpenAI sirve. |
| `AI_BASE_URL` | no | Por defecto `https://api.deepseek.com`. |
| `AI_API_KEY` | para IA | Sin ella las funciones de IA no aparecen. |
| `AI_MODEL` | no | Por defecto `deepseek-v4-flash`. |
| `AI_RATE_LIMIT` | no | Pedidos de IA por usuario cada 10 minutos (por defecto 30). |

## Configurar Google OAuth

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) creá un proyecto (o usá uno existente).
2. **Pantalla de consentimiento de OAuth**: tipo *Externo*, nombre de la app y tu email. Mientras esté en modo *Testing*, agregá como usuarios de prueba a quienes vayan a entrar.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**.
4. **Orígenes autorizados de JavaScript**: el valor de `APP_URL` (ej. `http://localhost:3000` o `https://todo.tudominio.com`).
5. **URI de redireccionamiento autorizados**: `APP_URL/api/auth/callback/google`.
6. Copiá el ID y el secreto a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, y reiniciá la app.

Google no acepta IPs privadas como redirección: fuera de `localhost` hace falta un dominio con HTTPS.

## Configurar la integración con GitHub

La integración usa una **GitHub App** (permisos acotados y webhooks incluidos). Cada instalación de ToDoApp usa su propia app.

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Datos básicos:
   - **Homepage URL**: `APP_URL`.
   - **Callback URL**: `APP_URL/api/integrations/github/callback`.
   - Marcá **Request user authorization (OAuth) during installation**. Con eso GitHub confirma qué instalaciones puede ver cada usuario y nadie puede vincular una ajena.
   - **Webhook**: activo. URL `APP_URL/api/webhooks/github` y un **Webhook secret** (por ejemplo `openssl rand -hex 32`).
3. **Permisos de repositorio**:
   - *Contents*: **Read and write** (crear ramas y comparar contra la base).
   - *Pull requests*: **Read-only**.
   - *Metadata*: Read-only (obligatorio).
4. **Eventos a los que suscribirse**: *Create*, *Delete*, *Push*, *Pull request*, *Pull request review*. Los de instalación llegan solos.
5. **Where can this GitHub App be installed?**: *Only on this account* (salvo que la vayas a instalar en una organización).
6. Creala y completá el `.env`:
   - `GITHUB_APP_ID`: el *App ID* de la página de la app.
   - `GITHUB_APP_SLUG`: el nombre en la URL (`github.com/apps/<slug>`).
   - `GITHUB_APP_CLIENT_ID` y `GITHUB_APP_CLIENT_SECRET`: generá un *client secret*.
   - `GITHUB_APP_PRIVATE_KEY`: generá una *private key* (.pem) y pegala en base64 en una línea (`base64 -i clave.pem | tr -d '\n'`). También acepta el PEM con `\n`.
   - `GITHUB_WEBHOOK_SECRET`: el mismo secreto del paso 2.
7. Reiniciá la app y en **Ajustes → GitHub** del proyecto usá **Instalar GitHub App**. Elegí los repositorios y conectalos al proyecto.

**Cómo se vincula:** las ramas, PRs (título, descripción o rama) y commits que mencionen la clave de una tarea (`TDA-12`, `tda-12-arreglar-login`) se vinculan solos. Desde la tarea, **Crear rama** genera `tda-12-titulo-de-la-tarea` desde la rama por defecto.

**Webhooks en desarrollo:** GitHub necesita una URL pública. Con [smee.io](https://smee.io) creá un canal, ponelo como Webhook URL de la app y corré:

```bash
npx smee-client --url https://smee.io/<canal> --target http://localhost:3000/api/webhooks/github
```

**Sumar otro proveedor (GitLab, etc.):** implementar la interfaz `RepoProvider` (`src/server/repo-providers/types.ts`) y registrarla en `src/server/repo-providers/index.ts`. El resto del sistema solo ve eventos genéricos (`branch.created`, `pull_request.merged`, …).

## Automatizaciones

Se configuran por proyecto en **Automatizaciones** (dueños y editores):

- **Disparadores:** tarea creada, tarea movida (con columna de origen o destino opcional), rama creada, PR abierto, PR mergeado, fecha límite próxima (con anticipación en horas).
- **Condiciones** (todas deben cumplirse): prioridad, tag, epic, responsable, columna actual, si es subtarea.
- **Acciones:** mover a columna, asignar o quitar responsable, agregar o quitar tag, comentar. Los comentarios aceptan variables como `{{task.key}}`, `{{pr.url}}` o `{{due_date}}`.
- **Plantillas:** "Flujo de pull requests" (PR abierto → En revisión; mergeado → Hecho), "Rama creada → En curso" y "Aviso de vencimiento".

Cada evento que coincide con una regla queda en el **Registro**: si se ejecutó, se omitió (con la condición que falló y su valor) o falló (con el error de cada acción). Las reglas pueden encadenarse hasta 3 niveles, y una regla nunca actúa dos veces en la misma cadena, así que no puede haber bucles.

## IA

Detrás de `src/server/ai/` hay una interfaz `AiProvider`. Para cambiar de modelo o de proveedor alcanza con las variables `AI_*`. Todo vuelve como sugerencia editable:

- **Dividir** una tarea en subtareas o un epic en tareas.
- **Redactar o mejorar** la descripción.
- **Sugerir** prioridad, estimación en horas y tags.
- **Resumir** el sprint o el proyecto.
- **Crear tareas desde texto** ("mañana tengo que revisar el deploy y avisarle a Juan").

Los de solo lectura pueden pedir resúmenes, pero no generar contenido. El consumo queda registrado en la tabla `ai_usage`.

## Tests

```bash
npm run db:up
npm test
```

Los tests de integración corren contra una base Postgres real (`todoapp_test`), que se recrea en cada corrida. Cubren sobre todo lo más costoso de romper:

- **Permisos**: matriz completa por rol, acceso de no miembros, invitaciones, aislamiento entre proyectos.
- **Automatizaciones**: motor puro (disparadores, condiciones, bucles, plantillas) y flujos completos, incluido el ejemplo PR abierto → En revisión → mergeado → Hecho con webhooks simulados.
- **GitHub**: firma de webhooks, idempotencia, vinculación por clave y estados del PR.
- **IA**: validación de respuestas, permisos y límite de uso (con un proveedor falso).

## Producción con Docker

Una sola imagen sirve para los tres procesos: `web` (Next standalone), `worker` y `migrate` (se ejecuta al desplegar y termina). En el servidor **no hay código**: solo `docker-compose.yml` y `.env`.

```bash
# En el servidor, una sola vez:
mkdir ~/todoapp                                     # y copiar deploy/.env.example como ~/todoapp/.env
docker network create web                           # si todavía no existe (red compartida con el proxy)

# Desde tu máquina, cada despliegue:
DEPLOY_HOST=usuario@servidor DEPLOY_SSH_KEY=~/.ssh/clave.pem scripts/deploy.sh
```

`scripts/deploy.sh` construye la imagen para `linux/amd64`, la carga en el servidor por SSH (`docker save | docker load`), copia el compose y levanta el stack. Las migraciones se aplican solas antes de que arranquen `web` y `worker`.

El contenedor `todoapp-web` se une a la red `web` para que un proxy (Caddy, Traefik, Nginx) lo publique por dominio con `reverse_proxy todoapp-web:3000`. También queda expuesto en `WEB_PORT` (3100) para acceso directo por la LAN. El login con Google, de todos modos, necesita el dominio público.

## Funcionalidades opcionales propuestas (no implementadas)

- Atajos de teclado y paleta de comandos (⌘K).
- Filtros guardados.
- Límite WIP por columna.
- Modo oscuro.
- Tareas recurrentes y plantillas de tarea.
- Importar desde Jira (CSV).
- IA: armar reglas de automatización desde una frase, resumir hilos de comentarios, detectar duplicados, planificar sprints, redactar descripciones de PR.
