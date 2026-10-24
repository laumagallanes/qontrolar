# QontrolAR

Monitoreo IoT de cadena de frío para comercios. Registra lecturas, muestra estado e historial por punto, detecta excursiones de temperatura y sensores sin conexión, y puede notificar por WhatsApp mediante Evolution API cuando se habilite una versión segura del proveedor.

> **Alcance:** QontrolAR es una herramienta operativa de prevención y registro interno. No certifica instalaciones, no garantiza cumplimiento normativo y no sustituye inspecciones, alarmas locales, termómetros requeridos ni planes de contingencia. Ver [`docs/referencias-regulatorias.md`](docs/referencias-regulatorias.md).

## Qué incluye

- Panel en español con ubicaciones, puntos de frío, estado actual, gráfico e historial exportable a CSV.
- Umbrales mínimo/máximo configurables por punto; no hay umbrales legales precargados.
- API de sensores con token Bearer individual, token almacenado hasheado, lotes de hasta 100 lecturas y protección de tasa.
- Alertas con demora configurable para evitar avisos por excursiones breves; cierre al normalizarse y detección de desconexión.
- Usuarios y organizaciones separados, cookies seguras, protección CSRF y roles.
- Integración Evolution API server-side, con estado de conexión y prueba de envío. La instancia, las bases de datos y los volúmenes de esta app son independientes de WarriorsMed.
- Un único `docker-compose.yml` para app, PostgreSQL de la app, PostgreSQL/volumen de Evolution y el conector Cloudflare Tunnel. Los perfiles opcionales controlan el túnel, Evolution y el simulador de la demo.

## Requisitos

- Docker Engine y Docker Compose v2.
- Node.js 22 o superior sólo para ejecutar pruebas y desarrollo fuera de Docker.

## Desarrollo local con Docker Compose

```bash
cp .env.example .env
```

Editá `.env`: cambiá las contraseñas de las bases de datos y configurá `PUBLIC_URL=http://localhost:3000`, `COOKIE_SECURE=false` y `TRUST_PROXY=false`. Los valores `CHANGE_ME_*` son ejemplos; no los uses en un despliegue.

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

La app aplica las migraciones al iniciar. Abrí <http://localhost:3000> y creá el primer usuario administrador desde el contenedor; el comando solicita la contraseña en forma interactiva:

```bash
docker compose exec app npm run create-admin
```

### Demo opcional (datos ficticios)

Para mostrar el panel antes de conectar sensores reales existe una demo aislada, apagada por defecto:

- Crea **una sola** organización marcada como demo (`is_demo`), con cuatro locales ficticios de rubros distintos —restaurante, farmacia, carnicería y veterinaria— y 8 puntos monitoreados con sensores simulados. Los rangos son ilustrativos, no normativos.
- Está separada de los datos de clientes: el simulador sólo escribe en los sensores simulados de esa organización y nunca toca organizaciones, usuarios ni dispositivos reales. Si `DEMO_EMAIL` ya pertenece a un usuario real, el seed falla sin modificarlo.
- El panel la rotula como **DEMO** en todas las páginas (banner, título, etiqueta "simulado" y CSV marcado). La organización demo nunca envía WhatsApp, aunque se le cargue un teléfono.
- Las credenciales del usuario demo se leen sólo del entorno: `DEMO_EMAIL` y `DEMO_PASSWORD` (al menos 12 caracteres, sin valores de ejemplo). No hay credenciales por defecto en el código y ningún script imprime la contraseña ni tokens de dispositivo.

Se activa con el perfil `demo` de Compose, que levanta el servicio `demo-worker`: siembra la demo una vez (idempotente, 24 h de historial) y luego sigue generando lecturas en forma continua cada `DEMO_INTERVAL_SECONDS` (60 por defecto), incluyendo una excursión periódica y un sensor que deja de reportar para ilustrar la alerta de desconexión.

```bash
# en .env (local) o en el entorno de Dokploy, nunca en el repositorio:
#   COMPOSE_PROFILES=tunnel,demo   (en local alcanza con COMPOSE_PROFILES=demo)
#   DEMO_EMAIL=...  DEMO_PASSWORD=...
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Para sembrar una sola vez sin el simulador continuo: `docker compose exec -e DEMO_EMAIL -e DEMO_PASSWORD app npm run seed:demo` (con las variables definidas en tu shell).

**Apagá la demo antes de operar con clientes reales**: quitá `demo` de `COMPOSE_PROFILES` y redeployá. La organización demo queda en la base, rotulada, pero sin nuevas lecturas; sus sensores simulados terminarán marcados sin conexión.

Para apagar el stack local sin borrar sus volúmenes:

```bash
docker compose down
```

No ejecutes `docker compose down -v` salvo que quieras borrar deliberadamente las bases de datos locales.

## Pruebas y verificación

```bash
npm ci
npm run check
```

La suite usa PGlite para las pruebas y no requiere una instancia externa de PostgreSQL. `docker-compose.yml` puede validarse con:

```bash
docker compose --env-file .env.example config --quiet
```

## Configuración inicial del comercio

1. Iniciá sesión con el administrador.
2. Creá la ubicación (por ejemplo, cocina, salón o depósito).
3. Creá cada punto de monitoreo e ingresá los límites acordados para ese producto, equipo y autoridad competente. QontrolAR exige valores explícitos y no los presenta como valores legales.
4. Creá un dispositivo, asignalo a un punto y copiá el token mostrado una sola vez. Guardalo de forma segura en el firmware del ESP32.
5. Configurá los teléfonos de alertas en formato internacional (ejemplo de Argentina: `5493411234567`).
6. Probá la recepción de lecturas con `docs/esp32.md`. La primera alerta real de WhatsApp sólo puede probarse cuando se habilite y vincule un proveedor Evolution API seguro.

## API para el ESP32

- Salud: `GET /api/v1/health`
- Ingesta: `POST /api/v1/readings`
- Autenticación: `Authorization: Bearer <token-del-dispositivo>`
- Ejemplo completo, cuerpo JSON, lotes y manejo de errores: [`docs/esp32.md`](docs/esp32.md).

## WhatsApp / Evolution API

La lógica de envío está implementada en `src/services/whatsapp.js`; la app conserva las credenciales en el servidor. La integración no copia datos ni usa volúmenes/DB/credenciales de WarriorsMed. Ver [`docs/evolution-whatsapp.md`](docs/evolution-whatsapp.md) para el estado de seguridad y el procedimiento de activación.

Por seguridad, el perfil Compose `whatsapp` está desactivado por defecto y usa una imagen deliberadamente inexistente hasta que se configure una versión oficial corregida y verificada. El adaptador de QontrolAR puede conectarse a una instancia Evolution API segura mediante variables de entorno; no publiques el puerto/API de Evolution en Internet.

## Despliegue en Dokploy

1. Usá este repositorio y su `docker-compose.yml` como fuente del recurso **Compose** de Dokploy; no crees un recurso Application separado para cada servicio.
2. Definí en el entorno del Compose valores fuertes y únicos para `APP_POSTGRES_PASSWORD`, `EVOLUTION_POSTGRES_PASSWORD`, `EVOLUTION_API_KEY` y las demás variables requeridas. No subas `.env` ni secretos a GitHub.
3. Para el hostname público configurá `PUBLIC_URL=https://QontrolAR.im-soluciones.com`, `COOKIE_SECURE=true` y `TRUST_PROXY=true`.
4. El acceso público usa un túnel Cloudflare dedicado a QontrolAR. Configurá `COMPOSE_PROFILES=tunnel` y cargá `CLOUDFLARED_TOKEN` como secreto del recurso Dokploy. El túnel debe enrutar `QontrolAR.im-soluciones.com` a `http://app:3000` en la red Compose y la DNS debe apuntar al UUID del túnel.
5. El perfil `whatsapp` permanece desactivado hasta contar con una versión de Evolution API corregida. No actives el perfil con el valor de imagen predeterminado.
6. Desplegá y verificá el estado `Done`, contenedor saludable, DNS, HTTPS y `GET /api/v1/health`.

Configuración operacional ampliada: [`docs/deployment-dokploy.md`](docs/deployment-dokploy.md).

## Variables y secretos

`.env.example` documenta variables requeridas y ejemplos no secretos. En producción, Dokploy debe almacenar todas las credenciales. No guardes `.env`, tokens de sensores, API keys, QR de WhatsApp ni claves de túnel en el repositorio, capturas o tickets.
