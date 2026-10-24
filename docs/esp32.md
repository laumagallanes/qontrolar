# API de sensores ESP32

La API de ingesta recibe lecturas HTTP por dispositivo. El token se genera en **Dispositivos → Nuevo dispositivo**, se muestra una sola vez y se almacena hasheado en la base de datos. No incluyas el token en Git, firmware público, logs, capturas ni reportes.

## Endpoint

```text
POST https://<host-qontrolar>/api/v1/readings
Authorization: Bearer <TOKEN_DEL_DISPOSITIVO>
Content-Type: application/json
X-Firmware-Version: 1.0.0   # opcional
```

Lectura individual:

```json
{
  "temperature": 3.8,
  "humidity": 62.1,
  "recorded_at": "2026-10-24T15:04:05Z"
}
```

`humidity` y `recorded_at` son opcionales. Si se omite la hora, el servidor usa la hora de recepción. Se aceptan timestamps ISO-8601 o epoch en segundos.

## Reenvío por cortes de conectividad

El dispositivo puede enviar un lote de hasta 100 lecturas. Conviene ordenarlo cronológicamente; el servidor lo normaliza antes de procesarlo.

```json
{
  "readings": [
    {"temperature": 3.8, "humidity": 62.1, "recorded_at": "2026-10-24T15:00:00Z"},
    {"temperature": 3.9, "humidity": 61.8, "recorded_at": "2026-10-24T15:05:00Z"}
  ]
}
```

Las lecturas antiguas pueden entrar al historial; una lectura fuera de orden no reemplaza el último estado actual. `recorded_at` no puede superar cinco minutos en el futuro ni tener más de siete días de antigüedad. Sincronizá el reloj del ESP32 por NTP.

## Ejemplo con curl

Exportá el token en tu terminal sin incluirlo en el repositorio:

```bash
export QONTROLAR_DEVICE_TOKEN='<token generado para este sensor>'
curl --fail-with-body -sS \
  -H "Authorization: Bearer ${QONTROLAR_DEVICE_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'X-Firmware-Version: 1.0.0' \
  --data '{"temperature":3.8,"humidity":62.1}' \
  'https://<host-qontrolar>/api/v1/readings'
```

Respuesta exitosa (forma resumida):

```json
{
  "ok": true,
  "accepted": 1,
  "point": {"name": "Cámara principal", "min_temp": 1, "max_temp": 6, "status": "ok"},
  "events": []
}
```

## Códigos de respuesta

- `201`: lecturas aceptadas.
- `400`: JSON o campo inválido.
- `401`: token faltante, incorrecto o revocado.
- `409`: dispositivo sin punto asignado.
- `413`: lote mayor a 100 o cuerpo demasiado grande.
- `422`: temperatura/timestamp inválidos.
- `429`: límite de solicitudes; respetar `Retry-After`.
- `GET /api/v1/health`: verificación de disponibilidad de app y base de datos.

La autenticación es por punto/dispositivo; no se aceptan identificadores de organización en el cuerpo para evitar que el cliente escriba en otra cuenta. Las alertas dependen de los límites explícitamente guardados para ese punto; los ejemplos o valores de fábrica no son recomendaciones regulatorias.
