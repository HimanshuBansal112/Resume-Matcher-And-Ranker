import logging
import os
import shutil
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
import re
import json
from collections import Counter

from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from docling.document_converter import DocumentConverter
from docling.utils.model_downloader import download_models
import pymupdf
from docx import Document
from docling.datamodel.base_models import InputFormat
from gliner import GLiNER

from database import engine, Base, SessionLocal, get_db
from models import ResumeIndex, ResumeStatus, JobDescriptions
from sections import *
from semantic import *

logging.basicConfig(
    filename='app.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

in_queue_dir = Path("uploaded/in_queue")
buffer_dir = Path("uploaded/buffer")
allowed_extensions = {".pdf", ".docx"}
converter = None
model = None

class JobDescriptionClass(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    raw_text: str
    parsed: dict
    weights: dict

def add_resume_index(entries: list[ResumeIndex]):
    with SessionLocal() as session:
        for entry in entries:
            session.add(entry)
        session.commit()

def find_resume_index(filename: str):
    with SessionLocal() as session:
        entry = session.get(ResumeIndex, filename)
        return entry

def remove_resume_index(entries: list[ResumeIndex]):
    filenames = [entry.filename for entry in entries]
    with SessionLocal.begin() as session:
        for filename in filenames:
            entry = session.get(ResumeIndex, filename)
            if entry:
                session.delete(entry)

def clear_buffer():
    for item in buffer_dir.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()

def get_jd(sno:int):
    with SessionLocal() as session:
        jd = session.get(JobDescriptions, sno)
        return jd

def insert_jds(entries: list[JobDescriptions]):
    with SessionLocal() as session:
        for entry in entries:
            session.add(entry)
        session.commit()

def jd_exists(sno: int) -> bool:
    with SessionLocal() as session:
        return session.get(JobDescriptions, sno) is not None

def update_jd(sno: int, updated_data: JobDescriptions):
    if not jd_exists(sno):
        return False
    with SessionLocal() as session:
        jd = session.get(JobDescriptions, sno)

        if jd is None:
            return False

        excluded_columns = {"sno", "create_time"}

        for column in JobDescriptions.__table__.columns:
            if column.name not in excluded_columns:
                setattr(jd, column.name, getattr(updated_data, column.name))

        session.commit()
        session.refresh(jd)
        return True

@asynccontextmanager
async def lifespan(app: FastAPI):
    global converter, model
    os.makedirs("uploaded", exist_ok=True)
    os.makedirs("uploaded/processed", exist_ok=True)
    os.makedirs("uploaded/processed/rejected", exist_ok=True)
    os.makedirs("uploaded/processed/accepted", exist_ok=True)
    os.makedirs("uploaded/in_queue", exist_ok=True)
    os.makedirs("uploaded/buffer", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    
    if not os.path.isfile("skills_category.json"):
        with open("skills_category.json", "w", encoding="utf-8") as f:
            json.dump(dict(), f, indent=4)

    if not os.path.isfile("skills.json"):
        with open("skills.json", "w", encoding="utf-8") as f:
            json.dump([], f, indent=4)
    
    print("Downloading models")
    download_models()
    model = GLiNER.from_pretrained(
        "philterd/ph-eye-pii-en-xsmall"
    )
    load_embedder()
    print("Done downloading models")
    
    print("Initializing docling")
    converter = DocumentConverter()
    converter.initialize_pipeline(InputFormat.PDF)
    converter.initialize_pipeline(InputFormat.DOCX)
    print("Done initializing docling")
    
    yield
    

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/add_skill")
def add_skill(keyword: str, skill_name: str) -> str:
    skills = []
    skills_category = dict()
    with open("skills.json", "r", encoding="utf-8") as file:
        skills = json.load(file)
    with open("skills_category.json", "r", encoding="utf-8") as file:
        skills_category = json.load(file)
    
    skills_category, skills = remove_redundant_values(skills_category, skills)
    
    if keyword in skills:
        return "Skill keyword already exists. Move if you want it in other skill name."
    
    skills_category_values = [
        skill1
        for skills1 in skills_category.values()
        for skill1 in skills1
    ]
    
    skills, skills_category_values, skills_category = repair_skill(skills, skills_category_values, skills_category)

    if keyword in skills_category_values:
        with open("skills.json", "w", encoding="utf-8") as file:
            json.dump(skills, file, indent=4)
        return f"Keyword is already under skill name."

    if skill_name not in skills_category:
        skills_category[skill_name] = []
    skills_category[skill_name].append(keyword)
    skills.append(keyword)
    
    with open("skills_category.json", "w", encoding="utf-8") as file:
        json.dump(skills_category, file, indent=4)
    with open("skills.json", "w", encoding="utf-8") as file:
        json.dump(skills, file, indent=4)
    
    return "Success"

@app.post("/remove_skill")
def remove_skill(keyword: str, skill_name: str) -> str:
    skills = []
    skills_category = dict()
    found = True
    with open("skills.json", "r", encoding="utf-8") as file:
        skills = json.load(file)
    with open("skills_category.json", "r", encoding="utf-8") as file:
        skills_category = json.load(file)
    
    skills_category, skills = remove_redundant_values(skills_category, skills)
    
    skills_category_values = [
        skill1
        for skills1 in skills_category.values()
        for skill1 in skills1
    ]
    
    skills, skills_category_values, skills_category = repair_skill(skills, skills_category_values, skills_category)
    
    if keyword not in skills or skill_name not in skills_category or keyword not in skills_category[skill_name]:
        found = False
    else:
        skills.remove(keyword)
        skills_category[skill_name].remove(keyword)
        if not(skills_category[skill_name]):
            del skills_category[skill_name]
    
    with open("skills_category.json", "w", encoding="utf-8") as file:
        json.dump(skills_category, file, indent=4)
    with open("skills.json", "w", encoding="utf-8") as file:
        json.dump(skills, file, indent=4)
    
    if found:
        return "Success"
    else:
        return "Not found. Must match key and value pair."
    
@app.get("/get_skills")
def read_skill():
    skills = []
    skills_category = dict()
    with open("skills.json", "r", encoding="utf-8") as file:
        skills = json.load(file)
    with open("skills_category.json", "r", encoding="utf-8") as file:
        skills_category = json.load(file)
    
    skills_category, skills = remove_redundant_values(skills_category, skills)
    
    skills_category_values = [
        skill1
        for skills1 in skills_category.values()
        for skill1 in skills1
    ]
    
    skills, skills_category_values, skills_category = repair_skill(skills, skills_category_values, skills_category)
    
    return skills_category


def repair_skill(skills: list[str], skills_category_values: list[str], skills_category: dict):
    category_missing = False
    keyword_missing = False
    
    for skill in skills:
        if skill not in skills_category_values:
            if skill not in skills_category:
                skills_category[skill] = []
            skills_category[skill].append(skill)
            skills_category_values.append(skill)
            category_missing = True
    
    if category_missing:
        with open("skills_category.json", "w", encoding="utf-8") as file:
            json.dump(skills_category, file, indent=4)
    
    for skill in skills_category_values:
        if skill not in skills:
            skills.append(skill)
            keyword_missing = True
    
    if keyword_missing:
        with open("skills.json", "w", encoding="utf-8") as file:
            json.dump(skills, file, indent=4)
    
    return skills, skills_category_values, skills_category

def remove_redundant_values(dictionary: dict, list1: list):
    counts = Counter(
        item
        for v in dictionary.values()
        for item in (v if isinstance(v, list) else [v])
    )
    result = {
        k: [item for item in v if counts[item] == 1]
        for k, v in dictionary.items()
    }
    result = {k: v for k, v in result.items() if v}
    
    if result != dictionary:
        with open("skills_category.json", "w", encoding="utf-8") as file:
            json.dump(result, file, indent=4)
    
    duplicates = {val for val, count in counts.items() if count > 1}
    cleaned_list1 = [item for item in dict.fromkeys(list1) if item not in duplicates]
    
    if cleaned_list1 != list1:
        with open("skills.json", "w", encoding="utf-8") as file:
            json.dump(cleaned_list1, file, indent=4)
    
    return result, cleaned_list1

@app.post("/upload_resumes")
async def upload_files(files: list[UploadFile] = File(...)):
    clear_buffer()
    time = datetime.now(ZoneInfo("Asia/Kolkata"))
    time_str = time.strftime("%Y-%m-%d %H-%M-%S")
    resumes = []

    for i, file in enumerate(files):
        filename = file.filename
        extension = "." + filename.split(".")[-1] if "." in filename else ""
        extension = extension.lower()
        if extension not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file: {file.filename}"
            )
        saved_filename = f"{time_str}_{i}_{filename}"
        file_path = buffer_dir / saved_filename
        with open(file_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
        resumes.append(
            ResumeIndex(
                filename=saved_filename,
                status=ResumeStatus.IN_QUEUE,
                upload_time = time,
                file_type=extension
            )
        )
    
    add_resume_index(resumes)
    
    for item in buffer_dir.iterdir():
        if item.is_file():
            shutil.move(item, in_queue_dir / item.name)

    return {
        "message": "Files uploaded successfully",
    }

def fallback_for_pdf(location:str)->str:
    with pymupdf.open(location) as doc:
        return "\n".join(page.get_text("text", sort=True) for page in doc)

def fallback_for_docx(location:str)->str:
    doc = Document(location)
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            cells = []
            for c in row.cells:
                t = c.text.strip()
                if t and (not cells or cells[-1] != t):
                    cells.append(t)
            parts.append(" | ".join(cells))
    return "\n".join(parts)

@app.get("/get_jd")
def get_jd_api(sno: int):
    jd = get_jd(sno)
    jd= {
        column.name: getattr(jd, column.name)
        for column in jd.__table__.columns
    }
    return jd

@app.post("/create_jds")
def create_jds(in_jds:list[JobDescriptionClass]):
    out_jds = []
    required = ["must_have", "nice_to_have", "experience_years", "requirements"]
    
    for in_jd in in_jds:
        if in_jd:
            not_found_parsed = [key for key in required if key not in in_jd.parsed]
            if not_found_parsed:
                raise HTTPException(
                    status_code=404,
                    detail=f"{not_found_parsed} Key(s) missing in parsed"
                )
            
            not_found_weight = [key for key in required if key not in in_jd.weights]
            if not_found_weight:
                raise HTTPException(
                    status_code=404,
                    detail=f"{not_found_weight} Key(s) missing in weights"
                )

            for skill in in_jd.parsed["must_have"]:
                if skill in in_jd.parsed["nice_to_have"]:
                    raise HTTPException(
                        status_code=404,
                        detail="Error! Duplicate skill(s) found in both must_have and nice_to_have"
                    )

            in_jd.parsed["must_have"] = [skill.lower() for skill in in_jd.parsed["must_have"]]
            in_jd.parsed["nice_to_have"] = [skill.lower() for skill in in_jd.parsed["nice_to_have"]]
            
            out_jd = JobDescriptions(
                title = in_jd.title,
                raw_text = in_jd.raw_text,
                parsed = in_jd.parsed,
                weights = in_jd.weights
            )
            out_jds.append(out_jd)
        else:
            raise HTTPException(
                status_code=404,
                detail="Error! Empty Job Description(s)"
            )
    
    insert_jds(out_jds)
    return {"message": "Successfully added Job Descriptions"}

@app.post("/edit_jd")
def edit_jd(sno: int, new_jd:JobDescriptionClass):
    if not(jd_exists(sno)):
        raise HTTPException(
            status_code=404,
            detail=f"Job Description with Serial Number: {sno} does not exist"
        )
    parsed_jds = []
    required = ["must_have", "nice_to_have", "experience_years", "requirements"]
    
    if new_jd:
        not_found_parsed = [key for key in required if key not in new_jd.parsed]
        if not_found_parsed:
            raise HTTPException(
                status_code=404,
                detail=f"{not_found_parsed} Key(s) missing in parsed"
            )
        
        not_found_weight = [key for key in required if key not in new_jd.weights]
        if not_found_weight:
            raise HTTPException(
                status_code=404,
                detail=f"{not_found_weight} Key(s) missing in weights"
            )

        for skill in new_jd.parsed["must_have"]:
            if skill in new_jd.parsed["nice_to_have"]:
                raise HTTPException(
                    status_code=404,
                    detail="Error! Duplicate skill(s) found in both must_have and nice_to_have"
                )

        new_jd.parsed["must_have"] = [skill.lower() for skill in new_jd.parsed["must_have"]]
        new_jd.parsed["nice_to_have"] = [skill.lower() for skill in new_jd.parsed["nice_to_have"]]
        
        parsed_jd = JobDescriptions(
            title = new_jd.title,
            raw_text = new_jd.raw_text,
            parsed = new_jd.parsed,
            weights = new_jd.weights
        )
    else:
        raise HTTPException(
            status_code=404,
            detail="Error! Empty Job Description(s)"
        )
    
    update_jd(sno, parsed_jd)
    return {"message": "Successfully added Job Descriptions"}
    
def find_name(
    text: str,
    threshold: float = 0.50,
    chunk_size: int = 1200,
    overlap: int = 150
):
    current_offset = 0
    
    for line in text[:3000].splitlines(keepends=True):
        if not line.strip():
            current_offset += len(line)
            continue

        entities = model.predict_entities(
            line,
            ["name"],
            threshold=threshold
        )

        for entity in entities:
            start = current_offset + entity["start"]
            end = current_offset + entity["end"]

            name = text[start:end].strip()

            if not name or not any(c.isalpha() for c in name):
                continue

            return name

        current_offset += len(line)

    return None


def extract_experience(text: str):
    MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
    _MON = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|"
            r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
    _DATE = rf"(?:\b{_MON}\.?\s+(?:19|20)\d{{2}}\b|\b(?:19|20)\d{{2}}\b)"   # "Mar 2020" or "2020"
    _OPEN = r"(?:present|current|now|ongoing)"
    RANGE = re.compile(rf"({_DATE})\s*(?:-|–|—|\bto\b)\s*({_DATE}|{_OPEN})", re.I)
    
    def _to_month(s: str) -> int:
        today = datetime.now()
        s = s.lower()
        if not any(ch.isdigit() for ch in s):
            return today.year * 12 + today.month
        year = int(re.search(r"(?:19|20)\d{2}", s).group())
        month = MONTHS.index(s[:3]) + 1 if s[:3] in MONTHS else 6
        return year * 12 + month
    
    def total_years(text: str) -> float:
        today = datetime.now()
        now = today.year * 12 + today.month

        spans = []
        for a, b in RANGE.findall(text):
            start, end = _to_month(a), min(_to_month(b), now)
            if start <= end:
                spans.append((start, end))

        merged = []
        for s, e in sorted(spans):
            if merged and s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])

        return round(sum(e - s + 1 for s, e in merged) / 12, 1)
    
    exp_text = get_exp_section(text)
    
    if exp_text is None:
        return {"years": None, "confidence": "low"}
    years = total_years(exp_text)
    if years == 0:
        return {"years": None, "confidence": "low"}
    return {"years": years, "confidence": "high"}

def process_text(text: str):
    details = dict()
    skills = []
    original_text = text
    text = text.lower()
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    phone_pattern = r'(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,5}[\s.-]?\d{3,5}'
    
    emails = re.findall(email_pattern, text)
    phones = re.findall(phone_pattern, text)
    
    details["email"] = emails[0] if emails else None
    details["phone"] = phones[0].strip() if phones else None
    
    details["name"] = find_name(original_text)
    if details["name"]:
        details["name"] = details["name"].title()
    details["skills"] = []
    
    with open("skills.json", "r", encoding="utf-8") as file:
        skills = json.load(file)
    
    if not(skills):
        raise Exception("Add skills in skills.json")
    
    SKILL_RE = re.compile(
        r"(?<![\w+#])("
        + "|".join(
            map(re.escape, sorted(skills, key=len, reverse=True))
        )
        + r")(?![\w+#])",
        re.IGNORECASE
    )
    details["skills"] = list(set([skill.lower() for skill in SKILL_RE.findall(text)]))
    
    
    exp = extract_experience(text)
    
    details["experience_years"] = exp["years"]
    details["experience_confidence"] = exp["confidence"]
    
    text_sections = "\n".join(filter(None, [get_section(original_text, EXP_START), get_section(original_text, PROJ_START)]))
    chunks = to_chunks(text_sections or original_text)
    
    return details, chunks

def extract_details(location:str):
    extension = "." + location.split(".")[-1] if "." in location else ""
    extension = extension.lower()
    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file: {location}"
        )
    try:
        result = converter.convert(location)
        text = result.document.export_to_markdown()
        text = re.sub(r"^#+\s*", "", text, flags=re.M)
        text = text.replace("**", "")

        message = "Success"
    except Exception as e:
        text = None
        if extension==".pdf":
            text = fallback_for_pdf(location)
        elif extension==".docx":
            text = fallback_for_docx(location)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Either No fallback found or Unsupported file for: {location}"
            )
            
        message = f"Success with fallback for error: {e}. Multi-column may read out of order."
        
    details, chunks = process_text(text)
    return {"message" : message,
            "payload" : details,
            "chunks" : chunks}

def score_candidate(keyword2skill: dict, jd: dict, person_detail: dict, check_exp:bool, total: float, sem: tuple = (None, dict())):
    base_score = 0
    skills = []
    keywords = set(person_detail["payload"]["skills"])
    
    for keyword in keywords:
        matched_skill = keyword2skill.get(keyword.lower())
        if matched_skill:
            skills.append(matched_skill.lower())
    skills = set(skills)
    
    match_detail = {
        "matched_must": sorted(jd["parsed"]["must_have"] & skills),
        "missing_must": sorted(jd["parsed"]["must_have"] - skills),
        "matched_nice": sorted(jd["parsed"]["nice_to_have"] & skills),
        "missing_nice": sorted(jd["parsed"]["nice_to_have"] - skills)
    }
    
    base_score += len(match_detail["matched_must"])*jd["weights"]["must_have"]
    base_score += len(match_detail["matched_nice"])*jd["weights"]["nice_to_have"]
    
    if check_exp and person_detail["payload"]["experience_years"]:
        base_score += min(person_detail["payload"]["experience_years"] * jd["weights"]["experience_years"] / jd["parsed"]["experience_years"], jd["weights"]["experience_years"])
    
    base_match_percentage = base_score * 100 / total
    match_detail["base_percentage"] = base_match_percentage
    
    if sem[0] is not None:
        total_score = base_score + sem[0] * jd["weights"]["requirements"]
        sem_match_percentage = sem[0] * 100
        
        total_match_percentage = total_score * 100 / (total + jd["weights"]["requirements"])
        
        match_detail["semantic_percentage"] = sem_match_percentage
        match_detail["semantic_evidence"] = sem[1]
        match_detail["total_percentage"] = total_match_percentage
    else:
        total_match_percentage = base_match_percentage
        match_detail["total_percentage"] = base_match_percentage
        match_detail["semantic_percentage"] = None
        match_detail["semantic_evidence"] = None
        
    return match_detail

@app.post("/match")
def match(locations:list[str], jd_sno: int, threshold: int = Query(0, ge=0, le=100)):
    skills_category = None
    
    with open("skills_category.json", "r", encoding="utf-8") as file:
        skills_category = json.load(file)
    
    keyword2skill = dict()
    for k, vals in skills_category.items():
        for v in vals:
            if v.lower() in keyword2skill:
                raise HTTPException(status_code=404, 
                detail = f"Duplicate keyword found: {v.lower()} under more than one skill name. Skills are case-insensitive")
            keyword2skill[v.lower()] = k

    
    jd = get_jd(jd_sno)
    check_exp = False
    matched = []
    
    if jd is None:
        raise HTTPException(
            status_code=404,
            detail="Job description not found"
        )
    
    jd= {
            column.name: getattr(jd, column.name)
            for column in jd.__table__.columns
        }
    
    jd["parsed"]["must_have"] = set(jd["parsed"]["must_have"])
    jd["parsed"]["nice_to_have"] = set(jd["parsed"]["nice_to_have"])
    
    total = len(jd["parsed"]["must_have"]) * jd["weights"]["must_have"] + len(jd["parsed"]["nice_to_have"]) * jd["weights"]["nice_to_have"]
    
    if jd["parsed"]["experience_years"] is not None and jd["parsed"]["experience_years"] > 0:
        total += jd["weights"]["experience_years"]
        check_exp = True
    
    if total == 0:
        raise HTTPException(status_code=400, detail="Job Description cannot be empty")
    
    requirements = jd["parsed"].get("requirements") or bullet_requirements(jd["raw_text"])
    req_vecs = embed(requirements) if requirements else None
    results, failed = [], []
    
    for location in locations:
        try:
            person = extract_details(location)
            if person["message"] != "Success":
                logging.error(f"For location {location}, got an error: " + person["message"])
        except Exception as e:
            failed.append({"resume_location": location, "error": str(e)})
            continue
        
        sem = semantic_fit(requirements, req_vecs, person["chunks"])
        match_detail = score_candidate(keyword2skill, jd, person, check_exp, total, sem)
        
        if match_detail["total_percentage"] >= threshold:
            matched.append({"candidate_details":person["payload"], "job_description_serial_number": jd["sno"], "job_description_title": jd["title"], "resume_location": location, "percentage_match": match_detail["total_percentage"], "match_detail": match_detail})
    matched.sort(key=lambda x: x["percentage_match"], reverse=True)
    return {"matched": matched, "failed": failed}