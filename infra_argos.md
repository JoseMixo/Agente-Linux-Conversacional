# Documentación Técnica y Base de Conocimiento SRE: Proyecto ARGOS
**Arquitectura Fog Computing para Monitoreo Ambiental Crítico en Cuarto de Servidores (Equipo 07)**

> **Propósito de este documento:** Servir como manual de arquitectura y *Runbook* de referencia rápida para el agente SRE (**"Root"**) y los operadores del sistema durante el diagnóstico de incidentes, mantenimiento y auditoría del nodo Fog y nodos Edge.

---

## 1. Introducción y Arquitectura General

El sistema **ARGOS** implementa una **Arquitectura Fog Computing (Computación en la Niebla)** bajo el paradigma **Offline-First**, diseñada para operar de manera local, resiliente y 100% autónoma frente a caídas del proveedor de Internet (ISP) o desconexiones de la nube.

La topología se divide en dos capas físicas acopladas mediante red local (LAN) y malla VPN (Tailscale para administración remota):

1. **Capa Edge (Borde — Adquisición y Actuación):**
   * **Hardware:** Arduino UNO R4 WiFi (basado en MCU Renesas RA4M1 + coprocesador de red ESP32-S3).
   * **Responsabilidades:** Lectura determinista de variables físicas ambientales, pre-procesamiento y etiquetado de calidad de datos en origen (*Edge Data Quality*), evaluación local de umbrales críticos para emisión inmediata de alertas y ejecución idempotente de comandos físicos (actuadores de refrigeración/extracción).

2. **Capa Fog (Niebla — Concentrador y Cerebro Local):**
   * **Hardware:** TV Box reacondicionada (SoC Allwinner H3) operando como servidor Linux *headless*.
   * **Responsabilidades:** Ingesta de mensajería pub/sub (Mosquitto), filtrado/normalización (Telegraf), persistencia de series temporales (InfluxDB) y visualización/alertamiento (Grafana), todo contenido dentro del dominio de broadcast local.

---

## 2. Acondicionamiento del Hardware del Servidor Fog (TV Box)

La transformación de una TV Box comercial de bajo costo en un servidor *headless* de misión crítica requirió ingeniería inversa de la placa base y ajustes de estabilización termoeléctrica a nivel de bootloader (U-Boot) y kernel Linux.

### 2.1 Especificaciones de Hardware y Sistema Base
| Componente | Especificación Técnica | Notas Operativas SRE |
| :--- | :--- | :--- |
| **Placa Base (PCB)** | `Q44_V4.0` | Sin PMIC dedicado (voltaje fijo en riel VDD_CPUX). |
| **SoC / Arquitectura** | Allwinner H3 (4x Cortex-A7) / `ARMv7l` (`armhf`, 32-bit) | **Crítico:** No soporta binarios `arm64`/`aarch64`. |
| **Memoria RAM** | ~1 GB DDR3 | Presupuesto estricto de memoria; evitar procesos JVM/pesados. |
| **Almacenamiento** | NAND Micron 8 GB (interna) + MicroSD | Cuidado con el desgaste por escritura (wear-leveling) y llenado de `/var/log`. |
| **Sistema Operativo** | Armbian Minimal — Debian 13 (Trixie) | Imagen DTB base: *Orange Pi One* (kernel 6.18+). |
| **Secuencia de Boot** | Cargador U-Boot en MicroSD | Limitación física del BootROM: no bootea nativamente desde puertos USB-A. |

### 2.2 Diagnóstico de Inestabilidad y Estabilización a Nivel Kernel (Post-Mortem)
* **Síntomas en Fase de Estrés:** Reinicios abruptos y *Kernel Panics* repetitivos bajo carga concurrente:
  * `Internal error: Oops: 5 SMP THUMB2`
  * Corrupción de temporizadores de alta resolución (`hrtimer` interrupt stalls).
  * Bloqueos duros (hard lockups) al despertar o escalar núcleos secundarios (`CPU2`, `CPU3`).
* **Causa Raíz (RCA):**
  Las placas genéricas `Q44_V4.0` carecen de un circuito integrado de gestión de energía (PMIC como el AXP209/AXP803) y cuentan con disipación pasiva mínima. El kernel moderno de Linux (rama 6.18+) activaba por defecto el gobernador `ondemand`, escalando simultáneamente los 4 núcleos físicos a **1.29 GHz**. Este pico de corriente provocaba caída de tensión transitoria (*brownout / undervoltage*) en el riel del SoC y desincronización del bus SMP entre núcleos.

### 2.3 Solución de Estabilización Aplicada (Configuración Intocable)
Para garantizar operación continua **24/7**, se aplicaron dos candados de hardware/software que **NUNCA deben revertirse**:

1. **Recorte SMP en Bootloader (`/boot/armbianEnv.txt`):**
   Se inyectó el argumento de kernel `maxcpus=2` (vía `extraargs=maxcpus=2`). Esto apaga físicamente los núcleos 2 y 3 desde el arranque, reduciendo a la mitad la demanda máxima de corriente del SoC.
   ```ini
   # Fragmento crítico en /boot/armbianEnv.txt
   extraargs=maxcpus=2
   ```

2. **Clamping de Frecuencia vía Systemd (`cpu-limit.service`):**
   Dado que Debian 13 (Trixie) deprecó el paquete clásico `cpufrequtils`, se implementó una unidad nativa en `/etc/systemd/system/cpu-limit.service` que escribe directamente en `/sys/devices/system/cpu/cpu*/cpufreq/`:
   * **Gobernador forzado:** `conservative` (escalado gradual suave en lugar de saltos bruscos).
   * **Frecuencia máxima (`scaling_max_freq`):** Limitada estrictamente a **816 MHz** (`816000` kHz).
   * **Resultado:** Cero *Kernel Panics*, estabilidad térmica < 65°C y operación ininterrumpida 24/7.

   **Comandos de auditoría rápida para "Root":**
   ```bash
   # Verificar núcleos activos (debe mostrar solo CPU 0 y 1)
   lscpu | grep -E "CPU\(s\)|On-line"
   # Verificar frecuencia máxima y gobernador actual
   cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
   cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq
   # Estado del servicio de protección
   systemctl status cpu-limit.service --no-pager
   ```

---

## 3. Stack Tecnológico del Servidor Fog (Instancias y Puertos)

Debido a la restricción de **1 GB de RAM** y arquitectura **ARMv7 de 32 bits (`armhf`)**, cada servicio fue seleccionado por su bajo consumo de memoria (*footprint*):

| Servicio | Unidad Systemd | Puerto / Bind | RAM Est. | Rol y Justificación Técnica |
| :--- | :--- | :--- | :--- | :--- |
| **Eclipse Mosquitto (v2.x)** | `mosquitto.service` | `1883/tcp` | `< 15 MB` | Broker MQTT escrito en C. Enruta telemetría, estados LWT, alertas y comandos. |
| **Telegraf** | `telegraf.service` | *Cliente interno* | `~45 MB` | Middleware ETL. Suscribe a Mosquitto (`inputs.mqtt_consumer`), valida/parsea JSON y escribe en InfluxDB (`outputs.influxdb`). Descarta tramas JSON corruptas en origen. |
| **InfluxDB (v1.8.10 OSS)** | `influxdb.service` | `8086/tcp` | `< 120 MB` | Base de datos TSDB. **Decisión crítica:** Se fijó la versión **1.8.10** (y se bloqueó actualización a v2.x con `apt-mark hold`) porque InfluxDB 2.x exige arquitectura de 64 bits para el motor Flux y consume > 1 GB de RAM. |
| **Grafana OSS** | `grafana-server.service` | `3000/tcp` | `~90 MB` | Visualización web y motor de umbrales visuales mediante consultas `InfluxQL`. |

---

## 4. Comunicación, Seguridad y Contratos MQTT

Toda la comunicación entre la Capa Edge y la Capa Fog se realiza sobre **MQTT v3.1.1 / v5.0 sobre TCP/IP en el puerto `1883`**.

### 4.1 Identidades Criptográficas y Matriz ACL (`/etc/mosquitto/acl`)
El broker tiene deshabilitado el acceso anónimo (`allow_anonymous false` en `/etc/mosquitto/mosquitto.conf`). Se aplica el **Principio de Menor Privilegio** mediante tres cuentas en `/etc/mosquitto/passwd`:

| Usuario MQTT | Rol en la Arquitectura | Permisos de Lectura (`read`) | Permisos de Escritura (`write`) |
| :--- | :--- | :--- | :--- |
| `u_arduino_nodo01` | Nodo sensor/actuador en campo | `iot/equipo07/cuarto_servidores/comando` | `iot/equipo07/cuarto_servidores/telemetria`<br>`iot/equipo07/cuarto_servidores/estado`<br>`iot/equipo07/cuarto_servidores/alerta`<br>`iot/equipo07/cuarto_servidores/confirmacion` |
| `u_telegraf_collector` | Ingesta hacia InfluxDB | `iot/equipo07/cuarto_servidores/#` | *Ninguno (Solo lectura estricta)* |
| `u_control_operator` | Administración / App / Dashboard | `iot/equipo07/cuarto_servidores/#` | `iot/equipo07/cuarto_servidores/comando` |

### 4.2 Convención de Tópicos y Contratos JSON (Bus de Datos)
Espacio de nombres base: `iot/equipo07/cuarto_servidores/`

1. **`.../telemetria`** *(QoS 0 / QoS 1 — Periódico, ej. cada 10s)*
   Datos nominales del cuarto de servidores con etiqueta de calidad evaluada en el borde.
   ```json
   {
     "schema_version": "1.0",
     "node_id": "arduino_nodo01",
     "temperature_c": 22.4,
     "humidity_pct": 45.1,
     "quality": "valid"
   }
   ```
2. **`.../estado`** *(QoS 1, Retain: `true` — Ciclo de Vida y LWT)*
   Estado de conectividad del nodo. Almacena el último estado conocido (`online` u `offline`) con bandera `retained` para que cualquier cliente nuevo conozca el estado de inmediato.
   ```json
   {
     "node_id": "arduino_nodo01",
     "status": "online"
   }
   ```
3. **`.../alerta`** *(QoS 1 — Asíncrono por evento)*
   Se dispara inmediatamente desde el Arduino cuando una lectura supera el umbral de advertencia/crítico sin esperar al ciclo normal de telemetría.
4. **`.../comando`** *(QoS 1 — Servidor $\rightarrow$ Arduino)*
   Órdenes de actuación con control de caducidad e idempotencia:
   ```json
   {
     "command_id": "cmd-20261116-0042",
     "action": "enfriamiento_on",
     "expires_at": 1794888600
   }
   ```
5. **`.../confirmacion`** *(QoS 1 — Arduino $\rightarrow$ Servidor)*
   Acuse de recibo tras procesar un comando (`executed`, `rejected_duplicate`, `rejected_expired`, `error`).

---

## 5. Inteligencia en el Borde (Nodo Arduino UNO R4 WiFi)

El nodo de campo emplea el módulo `ESP32-S3` interno mediante las librerías `WiFiS3.h` y `PubSubClient.h`, implementando tres patrones de confiabilidad industrial:

### 5.1 Clasificación de Calidad en Origen (*Edge Data Quality*)
Antes de publicar al broker, el firmware evalúa la plausibilidad física de la lectura del sensor (DHT/AHT):
* **`quality: "valid"`** ($10^\circ\text{C} \le T \le 30^\circ\text{C}$): Rango operativo nominal del cuarto de servidores.
* **`quality: "suspect"`** ($T > 30^\circ\text{C}$, ej. $33^\circ\text{C}$): Anomalía térmica real. Se etiqueta como sospechosa/alerta y **detona en paralelo un mensaje inmediato al tópico `.../alerta`**.
* **`quality: "invalid"`** (ej. $-99^\circ\text{C}$, `NaN`, desconexión del bus I2C/OneWire): Fallo físico del transductor. Se envía con este tag para que **Telegraf/InfluxDB filtre la lectura** en las consultas analíticas (`WHERE "quality" != 'invalid'`) evitando contaminar promedios históricos, pero permitiendo auditar que el sensor físico se averió.

### 5.2 Detección Inmediata de Caídas con MQTT LWT (*Last Will and Testament*)
Al abrir el socket TCP contra Mosquitto (`1883`), el Arduino registra un **Testamento (LWT)**:
* **Tópico LWT:** `iot/equipo07/cuarto_servidores/estado`
* **Payload LWT:** `{"node_id": "arduino_nodo01", "status": "offline"}` (Retained: `true`, QoS: `1`).
* **Comportamiento:** Si el Arduino sufre un corte eléctrico o pierde enlace WiFi, el *keep-alive* de Mosquitto expira y **el propio broker publica automáticamente el payload `offline`**, haciendo que Grafana conmute el panel de estado a **ROJO** en segundos sin intervención del nodo caído.

### 5.3 Idempotencia y Anti-Replay en Ejecución de Comandos
Cuando un operador o regla automatizada publica una orden en `.../comando`:
1. **Validación estructural:** El Arduino verifica la integridad del JSON entrante.
2. **Ventana de expiración (`expires_at`):** Compara la marca de tiempo contra su reloj sincronizado (NTP/RTC). Si el mensaje estuvo encolado demasiado tiempo y ya expiró, lo descarta para evitar accionar hardware fuera de contexto (mitigación de *replay attack* o mensajes retenidos obsoletos).
3. **Filtro de Idempotencia:** Consulta su buffer circular en RAM/EEPROM de `command_id` ejecutados recientemente. Si `command_id` ya fue procesado (ej. por retransmisión QoS 1), ignora la actuación física para no conmutar el relé innecesariamente y responde confirmando el duplicado.
4. **Actuación y ACK:** Conmuta el pin de salida (extractor/refrigeración secundaria) y publica el resultado en `.../confirmacion` con `status: "executed"`.

---

## 6. Diagrama Lógico del Sistema y Topología de Datos

```text
[ ARDUINO UNO R4 WiFi ] (Zona Edge - Cuarto de Servidores)
   │
   ├─> 1. Lee Sensores Ambientales (DHT / AHT)
   ├─> 2. Evalúa Calidad en Borde (valid | suspect | invalid) + Esquema JSON v1.0
   │
   │      (Enlace Local WiFi - TCP/IP Puerto 1883 - Auth: u_arduino_nodo01)
   ├──────────────────[ Tópicos: telemetria / estado (LWT) / alerta ]─────┐
   │                                                                      │
   │                                                       [ SERVIDOR FOG (TV Box Q44_V4.0) ]
   │                                                       (Armbian Debian 13 | 2 Cores @ 816MHz)
   │                                                                      │
   │                                                         1. Broker MQTT (Mosquitto :1883)
   │                                                            └─> Valida ACLs y gestiona LWT
   │                                                                      │
   │                                                         2. Colector (Telegraf)
   │                                                            └─> Auth: u_telegraf_collector
   │                                                            └─> Parsea y descarta JSON corrupto
   │                                                                      │
   │                                                         3. Base de Datos (InfluxDB v1.8.10 :8086)
   │                                                            └─> Persistencia TSDB (32-bit ARMv7)
   │                                                                      │
   │                                                         4. Visualización (Grafana OSS :3000)
   │                                                            └─> Consultas InfluxQL y Alertas
   │
   └──────[ Tópico: confirmacion ]─────<─────[ Tópico: comando ]──────────┘
        (ACK: executed / duplicate)       (Orden con command_id + expires_at)
                                           (Auth: u_control_operator)
```

---

## 7. Guía Rápida de Diagnóstico SRE (Runbook para "Root")

Cuando el usuario reporte un fallo en la infraestructura **ARGOS**, utiliza estos comandos de verificación según el síntoma:

### A. Servidor Lento, Inestable o Sospecha de Throttling Térmico
```bash
# Verificar temperatura del SoC Allwinner H3, carga y memoria disponible
cat /sys/class/thermal/thermal_zone0/temp
uptime && free -m
# Confirmar que la protección de 2 núcleos y 816 MHz sigue activa
grep "maxcpus" /boot/armbianEnv.txt
systemctl status cpu-limit.service --no-pager
```

### B. Grafana no muestra datos nuevos ("No Data")
```bash
# 1. Verificar estado de la cadena completa (Mosquitto -> Telegraf -> InfluxDB -> Grafana)
systemctl is-active mosquitto telegraf influxdb grafana-server
# 2. Revisar si Telegraf está rechazando JSON corrupto o fallando al escribir en InfluxDB
journalctl -u telegraf -n 50 --no-pager
# 3. Verificar errores de autenticación o desconexiones LWT en Mosquitto
journalctl -u mosquitto -n 50 --no-pager
```

### C. Auditoría en Vivo del Bus MQTT (Requiere credenciales de operador)
```bash
# Escuchar todo el bus del Equipo 07 en tiempo real (reemplazar <PASSWORD>)
mosquitto_sub -h 127.0.0.1 -p 1883 -u u_control_operator -P '<PASSWORD>' -t 'iot/equipo07/cuarto_servidores/#' -v
```

### D. Verificación de Almacenamiento en NAND / MicroSD
```bash
# Prevenir caída de InfluxDB o Mosquitto por disco lleno (8 GB NAND limitada)
df -h / /var/log
```
