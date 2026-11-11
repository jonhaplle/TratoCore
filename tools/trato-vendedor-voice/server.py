from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import io
import json
import os
import threading

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

HOST = "127.0.0.1"
PORT = int(os.getenv("TRATO_VENDEDOR_TTS_PORT", "8765"))
BASE = Path(__file__).resolve().parent
REF_AUDIO = Path(os.getenv(
    "TRATO_VENDEDOR_VOICE_REF",
    str(Path.home() / "Downloads" / "marcos_voz_referencia_nova.wav")
)).expanduser()
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"

# Transcrição revisada: corrigido o reconhecimento de "Joinville".
REF_TEXT = (
    "Olá, tudo bem? Seja muito bem-vindo à Trato Feito, Joinville. "
    "Aqui você encontra produtos novos, usados e antiguidades. "
    "Sempre com atenção à qualidade, procedência e preço justo. "
    "Nosso objetivo é oferecer boas oportunidades para quem gosta de comprar bem. "
    "Temos eletrônicos, videogames, discos de vinil, peças antigas, objetos de coleção e muitas outras novidades. "
    "Está procurando algum produto específico? Pode perguntar. Vou ter prazer em ajudar. "
    "Se quiser saber o preço, as condições de funcionamento ou mais detalhes sobre algum item, é só falar. "
    "Por exemplo, este produto custa 150 reais. Está em bom estado, foi testado e está pronto para uso. "
    "Mas atenção, cada produto pode ter características diferentes. "
    "Por isso, gosto de explicar tudo com transparência para que você compre com segurança. "
    "E se tiver alguma dúvida, não tenha vergonha de perguntar. "
    "Prefiro esclarecer todos os detalhes antes da compra. "
    "Obrigado pela visita e boas compras. Trato Feito, Joinville. "
    "Aqui, boas histórias também viram bons negócios."
)

if not REF_AUDIO.is_file():
    raise FileNotFoundError(
        f"Áudio de referência não encontrado: {REF_AUDIO}\n"
        "Defina TRATO_VENDEDOR_VOICE_REF com o caminho do WAV."
    )

print("[Trato Vendedor Voz] Carregando Qwen3-TTS na CPU...", flush=True)
model = Qwen3TTSModel.from_pretrained(
    MODEL_ID,
    device_map="cpu",
    dtype=torch.float32,
)
generation_lock = threading.Lock()
print(f"[Trato Vendedor Voz] Pronto em http://{HOST}:{PORT}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self._json(404, {"success": False, "error": "Rota não encontrada."})
        return self._json(200, {
            "success": True,
            "engine": "Qwen3-TTS",
            "voice": "Marcos",
            "reference_loaded": REF_AUDIO.is_file(),
        })

    def do_POST(self):
        if self.path != "/synthesize":
            return self._json(404, {"success": False, "error": "Rota não encontrada."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 12000:
                return self._json(413, {"success": False, "error": "Texto inválido ou muito longo."})
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload.get("text", "")).strip()
            if not text:
                return self._json(400, {"success": False, "error": "Informe o texto para falar."})
            if len(text) > 1200:
                return self._json(400, {"success": False, "error": "O texto deve ter no máximo 1.200 caracteres."})

            with generation_lock:
                wavs, sample_rate = model.generate_voice_clone(
                    text=text,
                    language="Portuguese",
                    ref_audio=str(REF_AUDIO),
                    ref_text=REF_TEXT,
                    x_vector_only_mode=False,
                )

            buffer = io.BytesIO()
            sf.write(buffer, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
            audio = buffer.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, {"success": False, "error": str(error)})
        except Exception as error:
            print(f"[Trato Vendedor Voz] Erro: {error}", flush=True)
            self._json(500, {"success": False, "error": "Falha ao gerar o áudio."})

    def log_message(self, format, *args):
        print("[Trato Vendedor Voz]", format % args, flush=True)


HTTPServer((HOST, PORT), Handler).serve_forever()
