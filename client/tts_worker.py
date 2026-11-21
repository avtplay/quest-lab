#!/usr/bin/env python3
"""Synthétiseur vocal de Quest Lab : lit les textes envoyés par le casque et renvoie du WAV (Piper, 100 % local).
   python3 tts_worker.py <voix.onnx>      (la voix .onnx.json doit être à côté)
   Pip : pip install piper-tts ; voix : python3 -m piper.download_voices fr_FR-siwis-medium
   Config : ~/.quest-lab/config.json (url, token), ou QUEST_LAB_URL / QUEST_LAB_TOKEN. Il se connecte au bridge, rien n'écoute ici."""
import io, json, os, sys, time, wave, urllib.request
from piper import PiperVoice

if len(sys.argv) < 2: sys.exit(__doc__)
try: cfg = json.load(open(os.path.expanduser('~/.quest-lab/config.json')))
except Exception: cfg = {}
BASE = (os.environ.get('QUEST_LAB_URL') or cfg.get('url') or 'http://localhost:8080').rstrip('/')
H = {'x-quest-token': os.environ.get('QUEST_LAB_TOKEN') or cfg.get('token') or ''}
voice = PiperVoice.load(sys.argv[1])
print('synthétiseur prêt →', BASE, flush=True)

def call(path, data=None, timeout=40):
    req = urllib.request.Request(BASE + path, data=data, headers={**H, 'content-type': 'application/octet-stream'} if data is not None else H)
    return urllib.request.urlopen(req, timeout=timeout)

while True:
    try:
        r = call('/api/tts/next')
        if r.status != 200: continue
        job = json.load(r); t = time.time(); buf = io.BytesIO()
        with wave.open(buf, 'wb') as w: voice.synthesize_wav(job['text'], w)
        call('/api/tts/result?rid=' + job['rid'], buf.getvalue()); print(f"lu en {time.time() - t:.1f} s : {job['text'][:50]!r}", flush=True)
    except Exception as e:
        print('erreur :', e, flush=True); time.sleep(3)
