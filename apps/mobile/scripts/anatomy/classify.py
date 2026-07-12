import re

# App's 17 muscle groups (from lib/exercises.ts MUSCLE_GROUPS)
GROUPS = ["chest","lats","middle back","lower back","shoulders","traps","biceps",
          "triceps","forearms","quadriceps","hamstrings","glutes","calves",
          "abdominals","adductors","abductors","neck"]

# Global drop: connective tissue / non-muscle / deep-internal / hand+foot intrinsics.
DROP_TOKENS = ["fascia","bursa","sheath","retinacul","aponeuros","septum","septa",
               "tract","ligament","tendon","tendinous","synovial","tarsus","linea alba",
               "cutaneous","arch","common tendinous ring","intermuscular","trochlea",
               # hand/foot intrinsics (kept off the surface model)
               "interossei","lumbrical","quadratus plantae","abductor hallucis",
               "adductor hallucis","opponens","flexor pollicis brevis",
               "abductor pollicis brevis","adductor pollicis","flexor digiti minimi",
               "abductor digiti minimi"]

# Ordered (first match wins). Each rule: (group, [substrings]).
# Prefer SUPERFICIAL muscles; deep layers (multifidus, TVA, tib posterior, psoas as flexor) handled deliberately.
RULES = [
    # --- arms ---
    ("biceps",   ["biceps brachii","brachialis","coracobrachialis"]),
    ("triceps",  ["triceps brachii","anconeus"]),
    ("forearms", ["brachioradialis","flexor carpi","extensor carpi","pronator",
                  "supinator","palmaris longus","flexor digitorum superficialis",
                  "flexor digitorum profundus","flexor pollicis longus","extensor pollicis",
                  "abductor pollicis longus","extensor indicis","extensor digiti minimi",
                  "extensor digitorum"]),
    # --- shoulders / upper back ---
    ("shoulders",["deltoid","supraspinatus","infraspinatus","subscapularis","teres minor"]),
    ("lats",     ["latissimus","teres major"]),
    ("middle back",["rhomboid"]),
    ("traps",    ["trapezius","levator scapulae"]),
    # --- chest ---
    ("chest",    ["pectoralis major","pectoralis minor","serratus anterior"]),
    # --- abs (superficial only: rectus + external oblique + pyramidalis) ---
    ("abdominals",["rectus abdominis","external abdominal oblique","pyramidalis"]),
    # --- neck (do BEFORE lower back so capitis/colli spinal go to neck) ---
    ("neck",     ["sternocleidomastoid","scalenus","scalene","splenius",
                  "platysma",
                  "longus colli","longus capitis","semispinalis capitis","semispinalis colli",
                  "spinalis capitis","longissimus capitis","longissimus colli","iliocostalis colli",
                  "multifidus colli","obliquus superior capitis","obliquus inferior capitis",
                  "rectus posterior","rectus anterior capitis","rectus lateralis capitis",
                  "spinalis colli","suboccipital"]),
    # --- lower back / erector spinae (thoracic/lumbar) ---
    ("lower back",["erector spinae","iliocostalis lumborum","iliocostalis thoracis",
                   "longissimus thoracis","spinalis thoracis","quadratus lumborum",
                   "multifidus thoracis","multifidus lumborum","semispinalis thoracis"]),
    # --- hips ---
    ("glutes",   ["gluteus maximus",
                  "piriformis","obturator internus","obturator externus",
                  "superior gemellus","inferior gemellus","quadratus femoris"]),
    ("abductors",["gluteus medius","gluteus minimus","tensor fasciae latae"]),
    ("adductors",["adductor magnus","adductor longus","adductor brevis","adductor minimus",
                  "pectineus","gracilis"]),
    # --- legs ---
    ("quadriceps",["rectus femoris","vastus lateralis","vastus medialis","vastus intermedius",
                   "sartorius","articularis genus"]),
    ("hamstrings",["biceps femoris","semimembranosus","semitendinosus"]),
    ("calves",   ["gastrocnemius","soleus","plantaris","popliteus","tibialis anterior",
                  "fibularis longus","fibularis brevis","extensor digitorum longus",
                  "extensor hallucis longus"]),
]

def strip_suffix(name):
    n = name.strip()
    n = re.sub(r'\.(l|r|ol|or|el|er|g|j|b|f)$', '', n, flags=re.I)
    n = re.sub(r'^\(|\)$', '', n).strip()
    return n

def classify(name):
    base = strip_suffix(name).lower()
    if not base:
        return None
    # keep TFL (an anterior-hip muscle) despite the 'fascia' in its name
    if "tensor fasciae latae" in base:
        return "abductors"
    # disambiguate the digit muscles that share substrings across arm/leg/foot:
    #   extensor digitorum/hallucis LONGUS -> surface shin (calves)
    #   flexor digitorum/hallucis longus (deep leg) & all *brevis* (foot) -> drop
    if "digitorum longus" in base or "hallucis longus" in base \
       or "digitorum brevis" in base or "hallucis brevis" in base:
        if base.startswith("extensor") and "longus" in base:
            return "calves"
        return None
    for tok in DROP_TOKENS:
        if tok in base:
            return None
    for group, keys in RULES:
        for k in keys:
            if k in base:
                return group
    return None

if __name__ == "__main__":
    import json, sys
    from collections import defaultdict
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    per = defaultdict(lambda: [0, 0])
    dropped = []
    for it in d["items"]:
        g = classify(it["name"])
        if g is None:
            if it["tris"] > 0:
                dropped.append((it["tris"], strip_suffix(it["name"])))
        else:
            per[g][0] += 1
            per[g][1] += it["tris"]
    print("=== per-group (group | meshes | tris) ===")
    kept = 0
    for g in GROUPS:
        c, t = per[g]
        kept += t
        flag = "  <-- EMPTY" if c == 0 else ""
        print(f'  {g:14s} {c:4d}  {t:8d}{flag}')
    print(f'KEPT total tris: {kept:,}  ({sum(v[0] for v in per.values())} meshes)')
    dropped.sort(reverse=True)
    ddupe = {}
    for t, n in dropped:
        ddupe[n] = ddupe.get(n, 0) + t
    dl = sorted(ddupe.items(), key=lambda x: -x[1])
    print(f'DROPPED total tris: {sum(t for t,_ in dropped):,}  ({len(ddupe)} distinct)')
    print("--- top 40 dropped (verify none should be kept) ---")
    for n, t in dl[:40]:
        print(f'  {t:8d}  {n}')
