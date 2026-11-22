import re

EXP_START = {"experience", "work experience", "professional experience", "relevant experience",
             "employment", "employment history", "work history", "internship", "internships"}
PROJ_START = {"projects", "project", "academic projects", "personal projects", "key projects"}
STOP = {"education", "academic", "skills", "technical skills", "certifications", "achievements",
        "awards", "languages", "interests", "hobbies", "references", "summary", "objective", "profile"}

ALL_HEADINGS = EXP_START | PROJ_START | STOP

def _norm(line: str) -> str:
    return re.sub(r"[^a-z]+", " ", line.lower()).strip()
        
def get_section(text: str, starts: set[str]) -> str | None:
    out, inside = [], False
    for line in text.splitlines():
        h = _norm(line)
        if h in starts:
            inside = True
        elif h in ALL_HEADINGS:
            inside = False
        elif inside:
            out.append(line)
    return "\n".join(out).strip() or None


def get_exp_section(text: str):
    return get_section(text, EXP_START)