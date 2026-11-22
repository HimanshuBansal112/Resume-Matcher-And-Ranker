# Resume Matcher & Ranker

An intelligent ATS-style resume parsing and semantic candidate ranking system. It evaluates resumes against job descriptions using a high-precision hybrid scoring model combining **rule-based skill and experience evaluation** with **deep semantic requirement matching**.

Includes an interactive recruiter web dashboard built with modern **HTML5, CSS3, and JavaScript** that runs directly in any standard web browser.

---

## Key Features

* **Hybrid Candidate Ranking**:
  * **Rule-Based Evaluation**: Assesses must-have skills, nice-to-have skills, and detected years of experience against custom criteria weights.
  * **Semantic Fit**: Employs `all-MiniLM-L6-v2` sentence embeddings to measure deep contextual similarity between candidate experience snippets and job responsibilities.
* **Document Parsing & Entity Extraction**:
  * Seamlessly processes `.pdf` and `.docx` resumes using Docling with PyMuPDF and python-docx parsing pipelines.
  * Accurately extracts candidate names using GLiNER named entity recognition models.
  * Identifies contact information (email, phone) and calculates experience duration from date ranges.
* **Skills Taxonomy & Keyword Mapping**:
  * Dynamically maps canonical skill categories to diverse keyword aliases (e.g., recognizing `es6` and `js` as `JavaScript`).
* **Interactive Web Dashboard**:
  * Organized into 5 dedicated workspaces: **Match & Rank**, **Match History**, **Upload Resumes**, **Job Descriptions**, and **Skills Database**.

---

## Prerequisites

* **Python 3.12+**
* **PostgreSQL** running locally on port `5432`

---

## Quick Setup

### 1. Database Configuration
Ensure PostgreSQL is running and create the application database:
```sql
CREATE DATABASE resume_matching;
```
Connection credentials are configured in [`database.py`](database.py):
```python
DATABASE_URL = "postgresql+psycopg://postgres:password@localhost:5432/resume_matching"
```

### 2. Install Dependencies
Using **[uv](https://docs.astral.sh/uv/)**:
```powershell
uv init .
uv venv
.\.venv\Scripts\activate
uv pip install -r requirements.txt
```

Or using standard **pip**:
```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

---

## Running the Application

### 1. Start the FastAPI Server
Using **uv**:
```powershell
uv run uvicorn server:app --reload
```
*(Or with your virtual environment activated: `uvicorn server:app --reload`)*
* On initial startup, the server automatically creates database tables and loads model checkpoints.
* Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

### 2. Launch the Front-End
Open the web interface in your browser through any preferred method:
* **Direct**: Double-click [`frontend/index.html`](frontend/index.html).
* **Live Server**: Right-click `index.html` in VS Code and select **"Open with Live Server"**.
* **Local HTTP Server**:
  ```powershell
  python -m http.server 3000
  ```
  and navigate to `http://127.0.0.1:3000/frontend/`.

---

## Front-End Workflow

1. **Match & Rank**:
   * Enter a Job Description ID (e.g. `1` or `2`) and click **Load JD** to inspect criteria.
   * Adjust the candidate score threshold slider (0%–100%).
   * Match results are automatically saved to database history.
   * Optionally check **Move Resumes to Processed Folders** (`finalize=True`) to also move evaluated resumes into `accepted/`, `rejected/`, or `error/` subdirectories.
   * Click **Run Match & Rank** to automatically evaluate all resumes in `uploaded/in_queue/`.
2. **Match History**:
   * Enter a Job Description SNo to query past evaluations (`GET /find_matches`).
   * Displays both the full JD requirements and all candidate match records.
   * Filter candidates by status: **Accepted**, **Rejected**, or **Errors**.
3. **Upload Resumes**:
   * Drag-and-drop `.pdf` and `.docx` candidate resumes into the processing queue.
   * Resumes are placed in `uploaded/in_queue/` for evaluation.
4. **Job Descriptions Manager**:
   * Author new job descriptions with custom scoring weights.
   * Retrieve and update existing job descriptions by serial number.
5. **Skills Database**:
   * Explore and search the recognized skills repository.
   * Add new skill categories and link alias keywords.
   * Manage existing keywords to keep the parsing taxonomy current.

---

## Project Structure

```
Resume-Matcher-And-Ranker/
├── server.py              # FastAPI application & endpoints
├── models.py              # SQLAlchemy database models
├── database.py            # PostgreSQL database connection
├── sections.py            # Text section boundary extraction
├── semantic.py            # Sentence embeddings & similarity scoring
├── skills.json            # Keyword match repository
├── skills_category.json   # Canonical skill to keyword alias mapping
├── requirements.txt       # Python package dependencies
├── pyproject.toml         # Project metadata & build settings
├── dummy/                 # Sample candidate resumes for evaluation
├── uploaded/              # Processing queues and file buffers
└── frontend/
    ├── index.html         # Application layout & UI structure
    ├── style.css          # Recruiter-style interface styling
    └── app.js             # Client-side state & API communication
```

---

## API Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/match?jd_sno={id}&threshold={%}&finalize={bool}` | Evaluates queue resumes & saves to history (moves files when finalize=true) |
| `GET`  | `/find_matches?jd_sno={id}` | Retrieves past match history records by JD SNo |
| `POST` | `/upload_resumes` | Uploads `.pdf` and `.docx` files to the processing queue |
| `GET`  | `/get_jd?sno={id}` | Fetches job description details by serial number |
| `POST` | `/create_jds` | Creates new job descriptions with criteria weights |
| `POST` | `/edit_jd?sno={id}` | Updates existing job description fields |
| `GET`  | `/get_skills` | Retrieves the full skills and keyword alias database |
| `POST` | `/add_skill?keyword={k}&skill_name={s}` | Associates a keyword alias with a skill |
| `POST` | `/remove_skill?keyword={k}&skill_name={s}` | Removes a keyword alias from a skill |
