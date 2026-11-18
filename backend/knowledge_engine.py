from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

BASE_DIR = Path(__file__).resolve().parent.parent
AGENTE_MD_PATH = BASE_DIR / "agente.md"
INFRA_ARGOS_MD_PATH = BASE_DIR / "infra_argos.md"


@dataclass
class KnowledgeSection:
    source: str
    title: str
    content: str
    keywords: List[str]


class ArgosKnowledgeEngine:
    """
    Motor determinista de conocimiento SRE que lee directamente `agente.md` e `infra_argos.md`
    desde el disco sin requerir conexión a ningún modelo LLM externo.
    Deja preparado `build_full_system_prompt()` para cuando se desee conectar una IA en el futuro.
    """

    def __init__(self, agente_path: Path = AGENTE_MD_PATH, infra_path: Path = INFRA_ARGOS_MD_PATH) -> None:
        self.agente_path = agente_path
        self.infra_path = infra_path
        self.agente_raw: str = ""
        self.infra_raw: str = ""
        self.sections: List[KnowledgeSection] = []
        self.reload()

    def reload(self) -> None:
        """Lee y re-indexa `agente.md` e `infra_argos.md` en memoria."""
        self.agente_raw = self._read_safe(self.agente_path)
        self.infra_raw = self._read_safe(self.infra_path)
        self.sections = (
            self._parse_markdown_sections("agente.md", self.agente_raw)
            + self._parse_markdown_sections("infra_argos.md", self.infra_raw)
        )

    @staticmethod
    def _read_safe(path: Path) -> str:
        if not path.exists():
            return f"[ERROR: Archivo no encontrado en {path}]"
        return path.read_text(encoding="utf-8")

    @staticmethod
    def _parse_markdown_sections(source_name: str, markdown_text: str) -> List[KnowledgeSection]:
        sections: List[KnowledgeSection] = []
        pattern = re.compile(r"^(#{2,3})\s+(.+)$", re.MULTILINE)
        matches = list(pattern.finditer(markdown_text))

        for idx, match in enumerate(matches):
            title = match.group(2).strip()
            start = match.end()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(markdown_text)
            body = markdown_text[start:end].strip()

            words = re.findall(r"[a-zA-Záéíóúñ0-9_-]{3,}", (title + " " + body).lower())
            unique_keywords = list(dict.fromkeys(words))
            sections.append(
                KnowledgeSection(
                    source=source_name,
                    title=title,
                    content=body,
                    keywords=unique_keywords,
                )
            )
        return sections

    def build_full_system_prompt(self) -> str:
        """
        Construye el System Prompt unificado combinando `agente.md` + `infra_argos.md`.
        Listo para inyectarse como `system_instruction` en cualquier LLM futuro.
        """
        self.reload()
        return (
            f"{self.agente_raw.strip()}\n\n"
            "====================================================================\n"
            "BASE DE CONOCIMIENTO DE INFRAESTRUCTURA ACTIVA (infra_argos.md)\n"
            "====================================================================\n\n"
            f"{self.infra_raw.strip()}\n"
        )

    def get_metadata(self) -> Dict[str, object]:
        self.reload()
        return {
            "status": "online",
            "mode": "local_deterministic_sre_engine (sin modelo IA externo)",
            "files": {
                "agente_md": {
                    "path": str(self.agente_path),
                    "exists": self.agente_path.exists(),
                    "bytes": len(self.agente_raw.encode("utf-8")),
                    "lines": len(self.agente_raw.splitlines()),
                },
                "infra_argos_md": {
                    "path": str(self.infra_path),
                    "exists": self.infra_path.exists(),
                    "bytes": len(self.infra_raw.encode("utf-8")),
                    "lines": len(self.infra_raw.splitlines()),
                },
            },
            "indexed_sections_count": len(self.sections),
            "indexed_sections": [
                {"source": s.source, "title": s.title} for s in self.sections
            ],
        }

    def search_relevant_sections(self, query: str, top_k: int = 2) -> List[Tuple[int, KnowledgeSection]]:
        query_tokens = set(re.findall(r"[a-zA-Záéíóúñ0-9_-]{3,}", query.lower()))
        scored: List[Tuple[int, KnowledgeSection]] = []

        for section in self.sections:
            score = 0
            title_lower = section.title.lower()
            for token in query_tokens:
                if token in title_lower:
                    score += 5
                elif token in section.keywords:
                    score += 1
            if score > 0:
                scored.append((score, section))

        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[:top_k]

    def generate_sre_response(self, user_prompt: str) -> str:
        """
        Genera la respuesta técnica siguiendo estrictamente el flujo de 4 pasos de `agente.md`
        y citando las secciones correspondientes de `infra_argos.md`.
        """
        self.reload()
        text_lower = user_prompt.lower()
        lines_count = len(user_prompt.splitlines())
        bytes_count = len(user_prompt.encode("utf-8"))

        matched_sections = self.search_relevant_sections(user_prompt, top_k=2)
        context_citations = ""
        if matched_sections:
            citations_md = "\n".join(
                f"* **Fuente `{sec.source}` → _{sec.title}_** (relevancia: `{score}`)"
                for score, sec in matched_sections
            )
            context_citations = (
                f"\n\n---\n**Contexto documental consultado en disco (`agente.md` / `infra_argos.md`):**\n"
                f"{citations_md}"
            )

        # Caso 1: Fallos de Kernel Panic / CPU / Temperatura / TV Box Q44_V4.0
        if any(
            k in text_lower
            for k in ("kernel", "panic", "oops", "smp", "thumb2", "hrtimer", "816", "maxcpus", "cpu", "temp", "q44")
        ):
            return (
                "**Paso 1: Análisis del Síntoma**\n"
                "Se detecta anomalía termoeléctrica o posible regresión de escalado SMP en el servidor Fog "
                "**TV Box Q44_V4.0 (SoC Allwinner H3 ARMv7 `armhf`)** documentado en `infra_argos.md` (Sección 2.2).\n\n"
                "**Paso 2: Recolección de Contexto / Diagnóstico**\n"
                "De acuerdo con las reglas estrictas de `agente.md` (Método Científico), antes de tocar el bootloader "
                "necesito verificar cuántos núcleos están activos y si `cpu-limit.service` sigue aplicando el candado:\n"
                "```bash\n"
                "# Verificar que solo CPU0 y CPU1 estén en línea (maxcpus=2)\n"
                "lscpu | grep -E \"CPU\\(s\\)|On-line\"\n\n"
                "# Auditar gobernador (debe ser 'conservative') y techo de reloj (debe ser 816000)\n"
                "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor\n"
                "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq\n"
                "cat /sys/class/thermal/thermal_zone0/temp\n\n"
                "# Estado del servicio en Debian 13 (Trixie)\n"
                "systemctl status cpu-limit.service --no-pager\n"
                "grep \"maxcpus\" /boot/armbianEnv.txt\n"
                "```\n\n"
                "**Paso 3: Hipótesis de Fallo (según `infra_argos.md`)**\n"
                "1. **Undervoltage por ausencia de PMIC:** Si el kernel 6.18+ volvió al gobernador `ondemand` a `1.29 GHz` "
                "en los 4 núcleos simultáneos, cae la tensión del riel del SoC provocando `Internal error: Oops: 5 SMP THUMB2`.\n"
                "2. **Unidad `cpu-limit.service` inactiva:** Fallo en el arranque tras actualización de paquetes en Armbian.\n\n"
                "**Paso 4: Mitigación y Verificación**\n"
                "> **[ADVERTENCIA CRÍTICA]:** Modificar `/boot/armbianEnv.txt` incorrectamente puede impedir el arranque desde la MicroSD (U-Boot). Realiza backup obligatorio antes de editar.\n"
                "```bash\n"
                "# 1. Respaldo preventivo obligatorio\n"
                "sudo cp /boot/armbianEnv.txt /boot/armbianEnv.txt.bak.$(date +%F)\n\n"
                "# 2. Reactivar el servicio de limitación a 816 MHz\n"
                "sudo systemctl daemon-reload\n"
                "sudo systemctl enable --now cpu-limit.service\n\n"
                "# 3. Confirmar mitigación\n"
                "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq\n"
                "```"
                f"{context_citations}"
            )

        # Caso 2: Mosquitto / MQTT / ACLs / LWT / Arduino desconectado
        if any(
            k in text_lower
            for k in ("mosquitto", "mqtt", "1883", "lwt", "will", "acl", "arduino", "u_arduino", "comando", "topico", "tópico")
        ):
            return (
                "**Paso 1: Análisis del Síntoma**\n"
                "Incidente en la capa de mensajería **Eclipse Mosquitto (`:1883/tcp`)** o en el enlace con el nodo Edge "
                "**Arduino UNO R4 WiFi (`ESP32-S3`)** bajo el espacio de nombres `iot/equipo07/cuarto_servidores/`.\n\n"
                "**Paso 2: Recolección de Contexto / Diagnóstico**\n"
                "Ejecuta y comparte la salida de estos comandos de solo lectura para aislar si es fallo del servicio, "
                "rechazo de ACL o disparo de testamento LWT:\n"
                "```bash\n"
                "systemctl status mosquitto.service --no-pager\n"
                "journalctl -u mosquitto.service -n 50 --no-pager\n"
                "ss -tulpn | grep 1883\n"
                "```\n\n"
                "**Paso 3: Hipótesis de Fallo (según `infra_argos.md` Sección 4 y 5)**\n"
                "1. **Activación de Last Will and Testament (LWT):** El Arduino perdió energía o enlace WiFi; el socket "
                "expiró y Mosquitto inyectó automáticamente `{\"status\": \"offline\"}` en `.../estado`.\n"
                "2. **Bloqueo por Matriz ACL (`allow_anonymous false`):**\n"
                "   * `u_arduino_nodo01`: Solo escribe en `telemetria`, `estado`, `alerta`, `confirmacion` y lee `comando`.\n"
                "   * `u_telegraf_collector`: Solo lectura en `iot/equipo07/cuarto_servidores/#`.\n"
                "   * `u_control_operator`: Lectura global y escritura en `comando`.\n"
                "3. **Rechazo por Idempotencia / Anti-Replay en Comando:** El payload enviado a `.../comando` tiene un "
                "`command_id` duplicado en EEPROM o un `expires_at` vencido.\n\n"
                "**Paso 4: Comandos para Auditar y Mitigar**\n"
                "```bash\n"
                "# Escuchar todo el bus MQTT en vivo usando la cuenta de operador\n"
                "mosquitto_sub -h 127.0.0.1 -p 1883 \\\n"
                "  -u u_control_operator -P '<PASSWORD>' \\\n"
                "  -t 'iot/equipo07/cuarto_servidores/#' -v\n"
                "```"
                f"{context_citations}"
            )

        # Caso 3: Telegraf / InfluxDB 1.8.10 / Grafana / Calidad de Datos
        if any(
            k in text_lower
            for k in ("telegraf", "influx", "influxdb", "8086", "grafana", "3000", "quality", "invalid", "suspect", "nand", "disco")
        ):
            return (
                "**Paso 1: Análisis del Síntoma**\n"
                "Anomalía en el pipeline de ingesta y visualización (**Telegraf $\\rightarrow$ InfluxDB v1.8.10 OSS `:8086` "
                "$\\rightarrow$ Grafana `:3000`**) o filtrado por etiqueta de calidad en origen (*Edge Data Quality*).\n\n"
                "**Paso 2: Recolección de Contexto / Diagnóstico**\n"
                "Dado que el servidor cuenta con **1 GB RAM DDR3** y **8 GB NAND Micron**, verifiquemos primero salud de "
                "procesos, logs de parseo JSON y espacio libre:\n"
                "```bash\n"
                "systemctl is-active mosquitto telegraf influxdb grafana-server\n"
                "journalctl -u telegraf -n 40 --no-pager\n"
                "journalctl -u influxdb -n 40 --no-pager\n"
                "df -h / /var/log\n"
                "free -m\n"
                "```\n\n"
                "**Paso 3: Hipótesis de Fallo (según `infra_argos.md` Sección 3 y 5.1)**\n"
                "1. **Descarte intencional en Telegraf:** El Arduino etiquetó la trama con `quality: \"invalid\"` "
                "(ej. `-99°C` por desconexión física del sensor DHT/AHT) o envió un JSON truncado.\n"
                "2. **Saturación del almacenamiento NAND (8 GB):** Llenado de `/var/log` o `/var/lib/influxdb`.\n"
                "3. **Incompatibilidad de arquitectura si se actualizó InfluxDB:** El nodo es `ARMv7l` (32 bits); debe "
                "mantenerse estrictamente en **InfluxDB v1.8.10** (v2.x exige 64 bits y >1 GB RAM).\n\n"
                "**Paso 4: Mitigación y Bloqueo Preventivo de Versión**\n"
                "```bash\n"
                "# Confirmar que InfluxDB 1.8.10 responde en localhost:8086\n"
                "curl -i http://127.0.0.1:8086/ping\n\n"
                "# Asegurar bloqueo de versión 1.8.x en Debian 13 para evitar upgrade accidental\n"
                "sudo apt-mark hold influxdb\n"
                "```"
                f"{context_citations}"
            )

        # Caso General: Muestra sección relevante encontrada en `agente.md` / `infra_argos.md` + protocolo SRE
        excerpt_block = ""
        if matched_sections:
            top_section = matched_sections[0][1]
            snippet = "\n".join(top_section.content.splitlines()[:18])
            excerpt_block = (
                f"\n\n**Extracto directo de `{top_section.source}` ({top_section.title}):**\n"
                f"```yaml\n{snippet}\n```"
            )

        return (
            f"**Paso 1: Análisis del Síntoma**\n"
            f"Entrada recibida en consola ({lines_count} línea(s), {bytes_count} bytes). "
            f"Operando como **Root (SRE & SysAdmin Nivel 3)** conectado a `agente.md` e `infra_argos.md`.\n\n"
            f"**Paso 2: Recolección de Contexto Faltante (Regla: Evidencia antes que Solución)**\n"
            f"Para aislar la causa raíz sin asumir, ejecuta y pega la salida de:\n"
            f"```bash\n"
            f"systemctl is-active cpu-limit mosquitto telegraf influxdb grafana-server\n"
            f"journalctl -p err -n 30 --no-pager\n"
            f"ip -br a && tailscale status\n"
            f"free -m && df -h / /var/log\n"
            f"```\n\n"
            f"**Paso 3: Hipótesis Preliminar**\n"
            f"* Pendiente de confirmar con la telemetría del Paso 2 (puede tratarse de red/Tailscale, "
            f"bus MQTT `:1883`, o recursos de la TV Box Allwinner H3).\n\n"
            f"**Paso 4: Verificación Rápida del Bus ARGOS**\n"
            f"```bash\n"
            f"ss -tulpn | grep -E '1883|3000|8086|22'\n"
            f"```"
            f"{excerpt_block}"
            f"{context_citations}"
        )
