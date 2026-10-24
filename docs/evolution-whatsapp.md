# WhatsApp por Evolution API

## Estado de la integración

QontrolAR ya implementa un cliente server-side de Evolution API: consulta estado de instancia, envía texto de prueba y notifica eventos de temperatura/desconexión. El navegador nunca recibe la API key. La app usa una instancia, base de datos y volúmenes propios; no se reutilizan datos, credenciales ni almacenamiento de WarriorsMed.

La activación de la instancia de Evolution está **bloqueada por seguridad** en Compose. A la fecha de revisión, upstream marca `v2.3.7` como último release estable y el issue [#2686](https://github.com/evolution-foundation/evolution-api/issues/2686) reporta que incluye Baileys `7.0.0-rc.9`. El [advisory de Baileys GHSA-qvv5-jq5g-4cgg / CVE-2026-48063](https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg) cubre versiones anteriores a `7.0.0-rc.12` y describe spoofing de mensajes/sincronización de estado. La lista de Evolution muestra `v2.4.0-rc2` como prerelease; no se trata aquí como versión estable de producción. Referencias: [releases oficiales de Evolution](https://github.com/evolution-foundation/evolution-api/releases) y [ficha NVD](https://nvd.nist.gov/vuln/detail/CVE-2026-48063).

Por eso `docker-compose.yml` deja el perfil `whatsapp` desactivado y usa una imagen centinela que no existe. **No vincules un número real ni habilites ese perfil con `v2.3.7`.** Antes de activarlo, verificar una versión upstream estable que incluya Baileys corregido y revisar sus requisitos/licencia. El cliente de QontrolAR queda listo para conectarse a esa instancia cuando se confirme una versión segura.

## Configuración futura (sólo después de verificar versión corregida)

1. En Dokploy, seleccionar un tag inmutable/versionado oficial en `EVOLUTION_IMAGE`; no usar `latest`.
2. Generar una clave aleatoria única y guardarla sólo en el entorno de Dokploy. Asignar la misma clave a `EVOLUTION_API_KEY` (autenticación del servicio Evolution) y `QONTROLAR_EVOLUTION_API_KEY` (cliente de QontrolAR).
3. Configurar `EVOLUTION_INSTANCE=qontrolar` y activar `COMPOSE_PROFILES=tunnel,whatsapp`.
4. Mantener Evolution sin ruta pública. El servicio sólo está en las redes privadas Compose y, para administración puntual, publica su puerto en `127.0.0.1:18088` del host.
5. Para emparejar desde una estación autorizada, crear un túnel SSH temporal al puerto local del host, consultar la documentación de la versión fijada de Evolution y generar/escanea el QR directamente. No abrir el puerto de Evolution al público ni compartir o guardar el QR: es una credencial temporal de sesión.
6. Verificar que el estado sea `open` en **Configuración → WhatsApp (Evolution API)** y enviar la prueba a un teléfono autorizado. Agregar los destinatarios de alertas en formato internacional.

Si el proveedor no está configurado o la instancia no está vinculada, el panel muestra el estado y no puede entregar alertas de WhatsApp. Usá un canal alternativo/plan de contingencia independiente del sistema de monitoreo.

## Contrato usado por el adaptador

- Envío: `POST /message/sendText/{instance}` con `{ "number": "...", "text": "..." }` y header `apikey`.
- Estado de conexión: `GET /instance/connectionState/{instance}`.
- Timeout configurable con `EVOLUTION_TIMEOUT_MS`; los errores no devuelven la clave.
- La app guarda destinatarios por organización y registra resultado/destino/fecha del envío, no la API key.

## Aislamiento de datos

- DB QontrolAR: servicio/volumen `app-db` / `qontrolar-app-db`.
- DB Evolution: servicio/volumen `evolution-db` / `qontrolar-evolution-db`.
- Sesiones Evolution: volumen `qontrolar-evolution-instances`.
- No montar ni conectar volúmenes o bases de datos WarriorsMed.
