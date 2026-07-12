"""Map Z-Anatomy's outer body-region patches to app muscle highlight zones.

The visible model uses these clean skin-surface proxies. The detailed muscle
meshes remain in the GLB for raycast hit-testing, but are not rendered.
"""

REGION_RULES = {
    "chest": (
        "pectoral region", "mammary region", "inframammary region",
        "infraclavicular fossa", "presternal region", "deltopectoral triangle",
    ),
    "lats": ("lateral region of thorax", "infrascapular region"),
    "middle back": ("interscapular region", "scapular region", "triangle of auscultation"),
    "lower back": ("lumbar region", "sacral region"),
    "shoulders": ("deltoid region",),
    "traps": (
        "posterior region of neck", "greater supraclavicular fossa",
        "lesser supraclavicular fossa",
    ),
    "biceps": ("anterior region of arm", "bicipital groove"),
    "triceps": ("posterior region of arm",),
    "forearms": (
        "anterior region of forearm", "posterior region of forearm",
        "lateral border of forearm", "medial border of forearm",
    ),
    "quadriceps": ("anterior region of thigh", "anterior region of knee"),
    "hamstrings": ("posterior region of thigh", "posterior region of knee", "popliteal fossa"),
    "glutes": ("gluteal region", "gluteal fold"),
    "calves": ("anterior region of leg", "posterior region of leg"),
    "abdominals": (
        "epigastric region", "umbilical region", "hypochondriac region",
        "hypogastric region", "inguinal region", "lateral region of abdomen",
    ),
    "adductors": ("femoral triangle", "inguinal region"),
    "abductors": ("hip region", "gluteal region"),
    "neck": (
        "submandibular triangle", "submental triangle", "carotid triangle",
        "muscular triangle", "sternocleidomastoid region", "lateral region of neck",
    ),
}


def groups_for_region(name):
    """Return every app group whose clean surface proxy includes `name`."""
    normalized = name.lower()
    return [
        group
        for group, tokens in REGION_RULES.items()
        if any(token in normalized for token in tokens)
    ]
