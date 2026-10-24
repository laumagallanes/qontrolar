# Despliegue con Docker Compose en Dokploy

## Recurso y fuente

- Crear un proyecto Dokploy independiente llamado **QontrolAR** en el entorno acordado.
- Crear un recurso **Compose** (no una Application por servicio).
- Fuente GitHub: repositorio `laumagallanes/qontrolar`, rama `main`, compose path `docker-compose.yml`.
- No apuntar Dokploy a `docker-compose.local.yml`; ese override publica la interfaz sólo en loopback para desarrollo local.
- Este stack usa nombres/volúmenes propios: `qontrolar-app-db`, `qontrolar-evolution-db` y `qontrolar-evolution-instances`.

## Variables que debe guardar Dokploy

Configurar el entorno como archivo para Compose (`createEnvFile=true`) y definir campos explícitamente:

| Variable | Valor recomendado / propósito |
|---|---|
| `PUBLIC_URL` | `https://QontrolAR.im-soluciones.com` |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true` |
| `APP_TIMEZONE` | `America/Argentina/Buenos_Aires` |
| `APP_POSTGRES_DB` / `APP_POSTGRES_USER` | `qontrolar` |
| `APP_POSTGRES_PASSWORD` | secreto aleatorio único |
| `EVOLUTION_POSTGRES_DB` / `EVOLUTION_POSTGRES_USER` | `evolution` |
| `EVOLUTION_POSTGRES_PASSWORD` | otro secreto aleatorio único, distinto al de app-db |
| `EVOLUTION_API_KEY` | clave aleatoria reservada para autenticación del servicio Evolution; requerida por la interpolación del Compose aunque el perfil esté apagado |
| `QONTROLAR_EVOLUTION_API_KEY` | vacío; no habilitar el cliente hasta aprobar una versión corregida de Evolution |
| `EVOLUTION_INSTANCE` | `qontrolar` |
| `EVOLUTION_IMAGE` | no fijar una imagen vulnerable; el valor centinela del Compose falla cerrado |
| `COMPOSE_PROFILES` | `tunnel`; `tunnel,demo` sólo mientras se muestre la demo (no incluir `whatsapp` mientras no haya versión estable corregida) |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | sólo con el perfil `demo`: email exclusivo del usuario demo y secreto de al menos 12 caracteres, guardados como secretos |
| `DEMO_INTERVAL_SECONDS` | opcional, intervalo del simulador demo (por defecto `60`, mínimo `15`) |
| `CLOUDFLARED_TOKEN` | token del conector del túnel dedicado a QontrolAR, guardado como secreto |
| `READING_RETENTION_DAYS` | `0` conserva lecturas sin purga automática; acordar política y respaldos según la operación/autoridad |

Completar también las demás variables requeridas por `.env.example`. Generar cada secreto en un gestor seguro, nunca en GitHub, mensajes o logs. La key Evolution se genera para aislar el servicio, pero `QONTROLAR_EVOLUTION_API_KEY` permanece vacía y el perfil del servicio apagado hasta que la versión pase revisión.

## Cloudflare Tunnel

1. Usar un túnel dedicado, sólo para esta aplicación; no modificar túneles de otros servicios.
2. Fuente de configuración: Cloudflare (remota). Ingress: `QontrolAR.im-soluciones.com` → `http://app:3000`.
3. Crear el CNAME proxied `QontrolAR.im-soluciones.com` → `<UUID-del-túnel>.cfargotunnel.com`.
4. La service `cloudflared` vive en el mismo Compose, comparte la red interna `app-edge` con `app` y usa la red externa dedicada `tunnel-egress` para comunicarse con Cloudflare. No se publica el puerto 3000 del host, ni se conecta `cloudflared` a la red privada `app-backend` de la base de datos. Evolution tampoco tiene ruta pública; sólo accede a WhatsApp por su red de salida separada cuando se habilite el perfil.
5. Guardar `CLOUDFLARED_TOKEN` sólo en el entorno del Compose y activar el perfil `tunnel` con `COMPOSE_PROFILES=tunnel`.

El hostname se proporcionó como `QontrolAR.im-soluciones.com`; el DNS es insensible a mayúsculas/minúsculas. Verificar el valor normalizado que devuelven DNS y Cloudflare sin cambiar la escritura del dominio raíz `im-soluciones.com`.

## Primer arranque

1. Guardar y releer el entorno del Compose en Dokploy, confirmando sólo presencia de claves (nunca valores).
2. Desplegar el commit de `main` deseado.
3. Esperar `Done`; confirmar que `app-db` y `app` están saludables y que el conector `cloudflared` está conectado.
4. Crear el administrador de la app desde una consola/SSH autorizada en el servicio con `npm run create-admin`; el comando solicita contraseña interactiva, que no debe registrarse en logs ni argumentos.
5. Verificar `https://QontrolAR.im-soluciones.com/api/v1/health`, pantalla de login, HTTPS y API de ingesta con un token de prueba.
6. No habilitar el perfil `whatsapp` ni vincular un teléfono hasta que exista una versión estable corregida; ver [`evolution-whatsapp.md`](evolution-whatsapp.md).

## Demo (opcional, datos ficticios)

Para presentaciones antes de conectar ESP32 reales:

1. Cargar `DEMO_EMAIL` y `DEMO_PASSWORD` como secretos del entorno del Compose (nunca en GitHub, tickets ni capturas). Usar un email exclusivo para la demo: si pertenece a un usuario real, el worker falla sin modificarlo.
2. Cambiar `COMPOSE_PROFILES=tunnel,demo` y redeployar. Se levanta `demo-worker`, sin puertos, sin variables ni red de Evolution, sólo en la red `app-backend`.
3. El worker aplica migraciones, crea **una** organización demo (`is_demo`) con cuatro locales ficticios —restaurante, farmacia, carnicería y veterinaria— y 8 puntos con sensores simulados, siembra 24 h de historial y luego genera lecturas en forma continua. Es idempotente: reinicios y redeploys no duplican estructura ni lecturas.
4. Sus logs sólo informan conteos (usuario creado/existente, filas y lecturas); nunca la contraseña ni tokens. Si faltan las variables, son cortas o contienen `CHANGE_ME`, el worker termina con error y Compose no lo reintenta indefinidamente (`on-failure:5`).
5. Verificar ingresando con el usuario demo: banner y etiqueta **DEMO** en el panel. Los datos de clientes reales no aparecen para ese usuario ni el simulador los toca, y la organización demo nunca envía WhatsApp.

**Antes de operar con clientes reales**, volver a `COMPOSE_PROFILES=tunnel` y redeployar para apagar el simulador. La organización demo permanece rotulada en la base, sin nuevas lecturas; para cambiar la contraseña demo basta con actualizar `DEMO_PASSWORD` y reiniciar el worker (cierra las sesiones demo abiertas).

## Recuperación

- Para un fallo de código, usar el historial de despliegues de **este Compose** en Dokploy y volver al commit anterior.
- No borrar ni recrear volúmenes durante un rollback. Antes de migraciones que cambien esquema, verificar respaldo y plan de recuperación de las bases de datos nuevas.
- Las lecturas son datos de operación del cliente; ajustar respaldo/retención antes de incorporar comercios reales.
