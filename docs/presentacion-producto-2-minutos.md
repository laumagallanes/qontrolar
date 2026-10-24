# Qontrol.ar — Presentación de producto (2 minutos)

Guion para decir en voz alta. Sólo el texto en bloques de cita (`>`) se pronuncia; los títulos, tiempos y notas son guía para quien presenta. Duración total: 2:00, con un texto hablado de entre 230 y 270 palabras (ritmo de unas 125 palabras por minuto).

## Guion

### Bloque 1 — El problema (0:00–0:26)

> Una farmacia, una carnicería, una cocina o una veterinaria dependen de variables críticas: la temperatura de una heladera, una puerta, un equipo. Casi siempre las controla alguien que mira y anota. El problema es lo que pasa entre una anotación y la siguiente: nadie ve nada, y cuando alguien se da cuenta, la pérdida ya ocurrió.

### Bloque 2 — La plataforma y su primer módulo (0:26–1:07)

> Qontrol.ar es una plataforma IoT que se adapta a cada comercio. Un nodo ESP32 puede integrarse con distintos sensores para medir lo que ese negocio necesita. El primer módulo operativo es Qontrol Frío: cada punto tiene un mínimo y un máximo que define el comercio. Guarda cada lectura, arma un historial exportable, alerta si la temperatura sale de rango durante un tiempo configurable y marca los sensores que dejan de reportar. Energía, puertas, agua, gas o consumo son posibilidades futuras: dependen del sensor, la instalación y el desarrollo.

### Bloque 3 — Demo visual (1:07–1:34)

> Lo que ven es una demo con datos simulados: cuatro comercios ficticios y ocho puntos, no lecturas reales. Acá, el estado de cada punto y el gráfico de las últimas veinticuatro horas. La alerta abierta en el tablero es por un sensor sin conexión. Y en alertas vemos el historial, con una excursión de temperatura fuera de rango.

### Bloque 4 — Modelo comercial y cierre (1:34–2:00)

> El modelo es simple: una instalación inicial y un abono mensual. La integración con WhatsApp ya está desarrollada, pero la activamos recién cuando validemos una versión segura del proveedor. Qontrol.ar no reemplaza los controles que ya hacen: suma registros ordenados y aviso temprano. Empezamos por el frío y crecemos con lo que su comercio necesite medir.

## Guía de diapositivas

1. **El problema** (Bloque 1)
   Cuatro rubros (farmacia, carnicería, gastronomía, veterinaria) con íconos de heladera, puerta y equipo. Frase única: "¿Qué pasa entre una anotación y la siguiente?".

2. **Una plataforma, módulos por necesidad** (Bloque 2)
   Esquema simple: *nodo ESP32 + sensores → Qontrol.ar → panel y alertas*. Debajo, **Qontrol Frío — operativo hoy**: *umbrales por punto · historial exportable · alertas de rango y desconexión*. Al costado, en gris y rotulado **"Posibles módulos futuros (sujetos a sensor, instalación y desarrollo)"**: energía, puerta, agua, gas, consumo.

3. **Demo** (Bloque 3)
   Panel en vivo o captura de la organización demo, con el rótulo **DEMO** visible. Señalar en orden: estado de los 8 puntos → gráfico de 24 h → alerta abierta en el tablero por **sensor sin conexión** → en /alertas, **alerta del historial por temperatura fuera de rango** (no presentarla como abierta: puede no estarlo al momento de mostrar). Leyenda en pantalla: "Datos simulados".

4. **Modelo y contacto** (Bloque 4)
   *Instalación + abono mensual* (sin cifras). Línea aparte: "WhatsApp: integración desarrollada, desactivada hasta validar una versión segura del proveedor". Datos de contacto.

### Notas para quien presenta

- Hoy el único módulo operativo es Qontrol Frío. Energía, puerta, agua, gas o consumo no son funciones actuales: presentarlas siempre como posibilidades que dependen del sensor, la instalación, la calibración y el desarrollo del módulo. Ver [`vision-plataforma-iot.md`](vision-plataforma-iot.md).
- No mencionar precios, ni alertas por WhatsApp funcionando hoy, ni clientes o equipos ya instalados: la demo usa comercios y sensores ficticios.
- No hablar de cumplimiento normativo, habilitaciones ni inspecciones: Qontrol.ar es una herramienta de registro operativo y prevención.
