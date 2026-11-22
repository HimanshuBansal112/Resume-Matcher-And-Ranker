import re
import numpy as np

LO, HI = 0.25, 0.60
BULLETS = ("•", "-", "*", "–", "▪", "●", "·")
embedder = None


def load_embedder(name: str = "all-MiniLM-L6-v2"):
    global embedder
    from sentence_transformers import SentenceTransformer
    embedder = SentenceTransformer(name)


def embed(texts: list[str]) -> np.ndarray:
    return embedder.encode(texts, normalize_embeddings=True)


def to_chunks(text: str, min_words: int = 4) -> list[str]:
    out = []
    for line in text.splitlines():
        line = line.strip(" \t" + "".join(BULLETS) + "|")
        if len(re.findall(r"[a-z]{2,}", line.lower())) >= min_words:
            out.append(line)
    return out


def bullet_requirements(raw_text: str) -> list[str]:
    lines = [l.strip() for l in raw_text.splitlines()]
    bullets = [l for l in lines if l.startswith(BULLETS)]
    return to_chunks("\n".join(bullets or lines))


def semantic_fit(requirements, req_vecs, chunks, embed_fn=embed, lo=LO, hi=HI):
    if not requirements or not chunks:
        return None, {}
    sims = req_vecs @ embed_fn(chunks).T
    best_i, best = sims.argmax(axis=1), sims.max(axis=1)
    fit = float(np.clip((best - lo) / (hi - lo), 0, 1).mean())
    evidence = {r: {"snippet": chunks[i], "similarity": round(float(s), 2)}
                for r, i, s in zip(requirements, best_i, best)}
    return fit, evidence