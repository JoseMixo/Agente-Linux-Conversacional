# 🖥️ Root — Agente Conversacional SRE & SysAdmin (Proyecto ARGOS)

![Version](https://img.shields.io/badge/version-1.0.0-emerald)
![Frontend](https://img.shields.io/badge/Frontend-React_18_+_TypeScript_+_Vite-blue)
![Backend](https://img.shields.io/badge/Backend-FastAPI_+_SSE-009688)
![Architecture](https://img.shields.io/badge/Architecture-Offline--First_%7C_Fog_Computing-orange)

**Root** es un asistente conversacional de **Ingeniería de Confiabilidad del Sitio (SRE) y Administración de Sistemas Linux (Nivel 3)** con interfaz de consola terminal en tiempo real. Está diseñado específicamente para asistir a operadores en el diagnóstico, triaje, aislamiento y mitigación de incidentes en entornos Linux, redes Mesh VPN y arquitecturas IoT **Offline-First / Fog Computing** (Proyecto **ARGOS**).

---

## 🚀 ¿Qué hace el Agente?

A diferencia de un chatbot genérico, **Root** opera bajo presión operativa siguiendo reglas estrictas de ingeniería de sistemas:

1. **Método Científico (Evidencia antes que Solución):**
   * Nunca adivina la causa raíz. Si se reporta un síntoma sin telemetría, solicita primero comandos de diagnóstico de solo lectura (`systemctl status`, `journalctl`, `ss -tulpn`, `dmesg`, `tailscale status`).
2. **Motor de Conocimiento Determinista y 100% Offline-First (`ArgosKnowledgeEngine`):**
   * Indexa y consulta en tiempo real dos fuentes de verdad en Markdown sin depender de conexión a Internet ni APIs externas:
     * `agente.md`: Define la personalidad técnica, reglas de seguridad (principio de menor privilegio, backups obligatorios antes de editar configuraciones) y estructura de respuesta.
     * `infra_argos.md`: Runbook completo de la infraestructura **ARGOS** (Servidor Fog en TV Box `Q44_V4.0` Allwinner H3 con Armbian Debian 13 `armhf` limitado a 2 núcleos @ 816 MHz, pipeline **Mosquitto MQTT + Telegraf + InfluxDB 1.8 + Grafana**, y nodo Edge **Arduino UNO R4 WiFi**).
3. **Flujo de Respuesta Estandarizado en 4 Etapas:**
   * **Paso 1:** Análisis del síntoma o log pegado.
   * **Paso 2:** Comandos exactos de recolección de contexto / diagnóstico.
   * **Paso 3:** Hipótesis de fallo ordenadas por probabilidad.
   * **Paso 4:** Comandos de mitigación (con respaldo previo `.bak`) y verificación de estado saludable.
4. **Consola Terminal Web con Streaming SSE:**
   * Transmisión de respuestas token por token mediante **Server-Sent Events (`text/event-stream`)**.
   * Soporte para pegado masivo de volcados de logs (`journalctl`, trazas de Kernel Panic, errores de InfluxDB/Telegraf) con contador automático de líneas y bytes.
   * Resaltado de sintaxis con **PrismJS** y botón de copiado rápido para ejecutar bloques de código `bash` directamente en la terminal.

---

## 📂 Estructura del Proyecto

```text
agente_conversacional/
├── agente.md                  # System Prompt: Reglas operativas y flujo SRE del agente "Root"
├── infra_argos.md             # Base de Conocimiento y Runbook técnico de la infraestructura ARGOS
├── backend/
│   ├── main.py                # Servidor FastAPI con endpoints REST y streaming SSE
│   ├── knowledge_engine.py    # Motor indexador de Markdown y generador de respuestas SRE
│   └── requirements.txt       # Dependencias de Python (FastAPI, Uvicorn, Pydantic)
├── src/
│   ├── App.tsx                # Interfaz SPA tipo consola terminal SRE
│   ├── components/
│   │   └── MarkdownMessage.tsx# Renderizador Markdown con PrismJS y copiado de comandos
│   └── services/
│       └── sseClient.ts       # Cliente consumidor de Server-Sent Events (POST/GET)
├── package.json               # Dependencias de Node.js y scripts de Vite
└── vite.config.ts             # Configuración de Vite con proxy /api -> http://127.0.0.1:8000
```

---

## 🛠️ Requisitos Previos

* **Python:** `3.10` o superior.
* **Node.js:** `18.x` o superior (con `npm`).

---

## ⚡ Cómo Ejecutar el Proyecto

Para ejecutar el agente completo necesitas levantar dos terminales: una para el **Backend (FastAPI)** y otra para el **Frontend (React + Vite)**.

### 1️⃣ Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/agente_conversacional.git
cd agente_conversacional
```

### 2️⃣ Iniciar el Backend (FastAPI — Puerto 8000)

Abre una terminal en la raíz del proyecto y ejecuta:

**En Windows (PowerShell):**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

**En Linux / macOS:**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

> El servidor FastAPI quedará escuchando en `http://127.0.0.1:8000`.  
> Puedes verificar su estado y la carga de los archivos `.md` visitando `http://127.0.0.1:8000/api/health` o la documentación interactiva Swagger en `http://127.0.0.1:8000/docs`.

### 3️⃣ Iniciar el Frontend (Vite + React — Puerto 5173)

Abre una **segunda terminal** en la raíz del proyecto (`agente_conversacional/`) y ejecuta:

```bash
npm install
npm run dev
```

> Abre tu navegador en **`http://localhost:5173`**.  
> Vite redirigirá automáticamente todas las peticiones `/api/*` hacia el backend en `http://127.0.0.1:8000`.

---

## 🔌 Endpoints de la API Backend

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Verifica el estado del motor y el número de secciones indexadas de `agente.md` e `infra_argos.md`. |
| `GET` | `/api/context` | Devuelve los metadatos y el **System Prompt unificado** listo para auditoría o inyección en LLMs. |
| `POST` | `/api/chat/stream` | Recibe `{"prompt": "..."}` (ideal para logs extensos) y responde mediante un stream SSE (`text/event-stream`). |
| `GET` | `/api/chat/stream?prompt=...` | Endpoint SSE compatible con la API nativa `EventSource` del navegador. |

---

## 🔮 Futuras Actualizaciones (Roadmap)

El proyecto está en evolución continua. Las próximas funcionalidades planificadas incluyen:

- [ ] **🐧 Explicador Interactivo de Comandos Linux (*Command Analyzer / Explain-Shell*):**
  * Modo dedicado donde el usuario puede escribir cualquier comando de Linux (incluyendo tuberías `|`, redirecciones, permisos y flags complejos como `ss -tulpn | grep 1883`, `journalctl -u mosquitto -n 50 --no-pager` o `iptables -L -n -v`) y el agente desglosará pieza por pieza **qué hace exactamente el comando**, qué significa cada parámetro y qué salida esperar.
- [ ] **🛡️ Analizador de Riesgo y Modo "Dry-Run" de Comandos:**
  * Evaluación automática del nivel de peligro de un comando antes de ejecutarlo en producción (Bajo / Medio / Crítico). Detección preventiva de comandos destructivos (`rm -rf`, `dd`, `mkfs`, `chmod 777`, o modificaciones en `/boot/armbianEnv.txt`) sugiriendo alternativas seguras y el comando de backup previo.
- [ ] **🧠 Integración Híbrida con LLMs Locales (Ollama / Llama.cpp) y Cloud:**
  * Conectar el método `build_full_system_prompt()` del motor de conocimiento con modelos locales ligeros (sin perder la filosofía *Offline-First*) o APIs externas mediante RAG sobre `infra_argos.md`.
- [ ] **🔍 Buscador Inverso de Comandos ("¿Cómo hago X en Linux?"):**
  * Consultar en lenguaje natural tareas de administración (ej. *"¿Cómo veo qué proceso está ocupando el puerto 8086?"* o *"¿Cómo limito el tamaño de los logs de systemd?"*) para recibir el comando exacto junto con su explicación detallada.
- [ ] **📡 Ejecución Asistida de Diagnósticos vía SSH / Tailscale (Read-Only Triage):**
  * Conexión opcional con el nodo Fog para ejecutar comandos de solo lectura (`systemctl is-active`, `df -h`, `free -m`, `vcgencmd` / sensores térmicos) con un solo clic desde la interfaz web.
- [ ] **📝 Generador Automático de Post-Mortems y Runbooks:**
  * Exportar una sesión de diagnóstico resuelta en un documento Markdown estructurado (Síntoma, RCA, Comandos de Mitigación) para anexarlo directamente a `infra_argos.md`.

---

## 📄 Licencia

Este proyecto fue desarrollado como parte de la arquitectura de monitoreo y confiabilidad del **Proyecto ARGOS (Equipo 07)**.
