/**
 * Resume Matcher & Ranker - Frontend Application Logic
 * Vanilla JavaScript (No Node.js, No complex build tools, beginner-intermediate friendly)
 */

// Application State
const state = {
  apiBaseUrl: localStorage.getItem('apiBaseUrl') || 'http://127.0.0.1:8000',
  currentJd: null,
  skillsData: {},
  queuedFiles: [],
  sessionUploadedPaths: [],
  defaultDummyPaths: [
    'dummy/Alex_Morgan_AI_Engineer_Resume.pdf',
    'dummy/Jordan_Taylor_Entry_Level_AI_Resume.pdf',
    'dummy/Priya_Sharma_Senior_Web_Developer_Resume.docx',
    'dummy/Alexander_Vance_Two-table.pdf'
  ]
};

// DOM Content Loaded Initializer
document.addEventListener('DOMContentLoaded', () => {
  initApiSettings();
  initNavigationTabs();
  initMatchTab();
  initUploadTab();
  initJdTab();
  initSkillsTab();

  // Test API connectivity on startup
  testApiConnection();
});

/* ========================================================
   API Client Helpers
   ======================================================== */

function getApiUrl(endpoint) {
  const base = state.apiBaseUrl.replace(/\/+$/, '');
  return `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
}

async function apiRequest(endpoint, options = {}) {
  const url = getApiUrl(endpoint);
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errMsg = (data && data.detail) || (data && data.message) || response.statusText || 'API request failed';
      throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }

    return data;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    if (err.name === 'TypeError' && err.message.toLowerCase().includes('failed to fetch')) {
      throw new Error(`Failed to fetch from ${url}. Ensure FastAPI is running and CORS is enabled.`);
    }
    throw err;
  }
}

/* ========================================================
   API Configuration & Health Check
   ======================================================== */

function initApiSettings() {
  const urlInput = document.getElementById('api-base-url');
  const testBtn = document.getElementById('btn-test-connection');

  urlInput.value = state.apiBaseUrl;

  urlInput.addEventListener('change', () => {
    let cleanUrl = urlInput.value.trim().replace(/\/+$/, '');
    if (!cleanUrl) cleanUrl = 'http://127.0.0.1:8000';
    state.apiBaseUrl = cleanUrl;
    localStorage.setItem('apiBaseUrl', cleanUrl);
    testApiConnection();
  });

  testBtn.addEventListener('click', () => {
    testApiConnection(true);
  });
}

async function testApiConnection(showAlert = false) {
  const statusBadge = document.getElementById('api-status-badge');
  const statusLabel = statusBadge.querySelector('.status-label');

  statusBadge.className = 'api-status';
  statusLabel.textContent = 'Checking...';

  try {
    // Attempt to probe the API (GET /get_jd with sno=1 or docs)
    // FastAPI always responds or returns 404 for missing ID, proving server is alive
    const res = await fetch(getApiUrl('/docs'), { method: 'HEAD' }).catch(() => null);
    
    // Also try fetching a sample JD or check status
    const testJd = await fetch(getApiUrl('/get_jd?sno=1')).catch(() => null);

    if ((res && res.status < 500) || (testJd && testJd.status < 500)) {
      statusBadge.className = 'api-status connected';
      statusLabel.textContent = 'API Connected';
      if (showAlert) showToast('Connected to API server successfully', 'success');
      return true;
    } else {
      throw new Error('Server unreachable');
    }
  } catch (err) {
    statusBadge.className = 'api-status offline';
    statusLabel.textContent = 'API Offline';
    if (showAlert) {
      showToast('Could not reach API at ' + state.apiBaseUrl + '. Ensure FastAPI server is running.', 'error');
    }
    return false;
  }
}

/* ========================================================
   Navigation Tabs
   ======================================================== */

function initNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      targetPanel?.classList.add('active');

      // Auto-load skills when switching to skills tab
      if (targetId === 'tab-skills' && Object.keys(state.skillsData).length === 0) {
        loadSkills();
      }
    });
  });

  // Sub-tabs (in Job Descriptions Manager)
  const subTabs = document.querySelectorAll('.sub-tab');
  const subPanels = document.querySelectorAll('.subtab-panel');

  subTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.subtab;

      subTabs.forEach(t => t.classList.remove('active'));
      subPanels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      targetPanel?.classList.add('active');

      // Auto-load skills when switching to skills tab
      if (targetId === 'tab-skills' && Object.keys(state.skillsData).length === 0) {
        loadSkills();
      }
    });
  });
}

/* ========================================================
   Toast Notification System
   ======================================================== */

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button type="button" class="btn btn-link btn-xs" style="color: inherit; margin-left: 0.5rem;">&times;</button>
  `;

  toast.querySelector('button').addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }
  }, 4500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ========================================================
   Tab 1: Match & Rank Candidates Logic
   ======================================================== */

function initMatchTab() {
  const fetchJdBtn = document.getElementById('btn-fetch-match-jd');
  const snoInput = document.getElementById('match-jd-sno');
  const thresholdSlider = document.getElementById('match-threshold');
  const thresholdVal = document.getElementById('threshold-val');
  const locationsTextarea = document.getElementById('match-locations');
  const runMatchBtn = document.getElementById('btn-run-match');

  // Quick button helpers for locations
  document.getElementById('btn-add-dummy-paths').addEventListener('click', () => {
    const current = locationsTextarea.value.trim();
    const toAdd = state.defaultDummyPaths.join('\n');
    locationsTextarea.value = current ? `${current}\n${toAdd}` : toAdd;
    showToast('Added 4 sample resume paths', 'info');
  });

  document.getElementById('btn-add-uploaded-paths').addEventListener('click', () => {
    if (state.sessionUploadedPaths.length === 0) {
      showToast('No resumes uploaded in this session yet. Upload some in the "Upload Resumes" tab.', 'info');
      return;
    }
    const current = locationsTextarea.value.trim();
    const toAdd = state.sessionUploadedPaths.join('\n');
    locationsTextarea.value = current ? `${current}\n${toAdd}` : toAdd;
    showToast(`Added ${state.sessionUploadedPaths.length} uploaded resume paths`, 'info');
  });

  document.getElementById('btn-clear-paths').addEventListener('click', () => {
    locationsTextarea.value = '';
  });

  // Threshold slider live display
  thresholdSlider.addEventListener('input', (e) => {
    thresholdVal.textContent = `${e.target.value}%`;
  });

  // Fetch JD for Match preview
  fetchJdBtn.addEventListener('click', async () => {
    const sno = parseInt(snoInput.value, 10);
    if (!sno || sno < 1) {
      showToast('Please enter a valid Job Description SNo', 'error');
      return;
    }
    await loadJdForMatch(sno);
  });

  // Pre-load default JD if available
  loadJdForMatch(parseInt(snoInput.value, 10) || 2);

  // Start with empty paths box
  locationsTextarea.value = '';

  // Run Matching
  runMatchBtn.addEventListener('click', async () => {
    await executeMatch();
  });

  // Expand / Collapse All buttons
  document.getElementById('btn-expand-all').addEventListener('click', () => {
    document.querySelectorAll('.evidence-panel').forEach(p => p.style.display = 'block');
  });
  document.getElementById('btn-collapse-all').addEventListener('click', () => {
    document.querySelectorAll('.evidence-panel').forEach(p => p.style.display = 'none');
  });
}

async function loadJdForMatch(sno) {
  const previewBox = document.getElementById('jd-preview-box');
  try {
    previewBox.innerHTML = '<div class="preview-empty">Loading Job Description #' + sno + '...</div>';
    const jd = await apiRequest(`/get_jd?sno=${sno}`);
    state.currentJd = jd;
    renderJdPreview(jd);
  } catch (err) {
    state.currentJd = null;
    previewBox.innerHTML = `
      <div class="preview-empty text-danger">
        Job Description #${sno} could not be loaded: <strong>${escapeHtml(err.message)}</strong>
        <div class="small text-muted" style="margin-top: 0.5rem;">
          Make sure your FastAPI server is restarted with CORS enabled (or check that the port in the top bar matches).
        </div>
      </div>
    `;
  }
}

function renderJdPreview(jd) {
  const previewBox = document.getElementById('jd-preview-box');
  const parsed = jd.parsed || {};
  const mustHave = parsed.must_have || [];
  const niceToHave = parsed.nice_to_have || [];
  const expYears = parsed.experience_years ?? 'N/A';
  const reqs = parsed.requirements || [];

  previewBox.innerHTML = `
    <div class="jd-preview-content">
      <div class="flex-between">
        <h4>${escapeHtml(jd.title || 'Untitled JD')} <span class="text-muted">(ID: #${jd.sno})</span></h4>
        <span class="jd-meta-tag">Exp: ${expYears} yr${expYears === 1 ? '' : 's'}</span>
      </div>

      <div class="skill-tag-group">
        <strong>Must-Have Skills (${mustHave.length})</strong>
        <div class="pill-list">
          ${mustHave.length > 0
            ? mustHave.map(s => `<span class="pill pill-must-matched">${escapeHtml(s)}</span>`).join('')
            : '<span class="text-muted small">None</span>'}
        </div>
      </div>

      <div class="skill-tag-group">
        <strong>Nice-to-Have Skills (${niceToHave.length})</strong>
        <div class="pill-list">
          ${niceToHave.length > 0
            ? niceToHave.map(s => `<span class="pill pill-nice-matched">${escapeHtml(s)}</span>`).join('')
            : '<span class="text-muted small">None</span>'}
        </div>
      </div>

      ${reqs.length > 0 ? `
        <div class="skill-tag-group">
          <strong>Key Requirements (${reqs.length})</strong>
          <ul class="text-muted small" style="margin-left: 1.25rem; margin-top: 0.25rem;">
            ${reqs.slice(0, 3).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            ${reqs.length > 3 ? `<li>+${reqs.length - 3} more</li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

async function executeMatch() {
  const snoInput = document.getElementById('match-jd-sno');
  const thresholdSlider = document.getElementById('match-threshold');
  const locationsTextarea = document.getElementById('match-locations');
  const runBtn = document.getElementById('btn-run-match');

  const sno = parseInt(snoInput.value, 10);
  const threshold = parseInt(thresholdSlider.value, 10) || 0;

  const rawLocations = locationsTextarea.value
    .split('\n')
    .map(l => l.trim().replace(/^["']|["'],?$/g, '').trim())
    .filter(l => l.length > 0);

  if (!sno || sno < 1) {
    showToast('Please specify a valid Job Description SNo', 'error');
    return;
  }

  if (rawLocations.length === 0) {
    showToast('Please provide at least one resume file path to evaluate', 'error');
    return;
  }

  // Set loading state
  runBtn.disabled = true;
  runBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
      <path d="M12 2a10 10 0 0 1 10 10"></path>
    </svg>
    Analyzing Resumes...
  `;

  try {
    const endpoint = `/match?jd_sno=${sno}&threshold=${threshold}`;
    const result = await apiRequest(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rawLocations)
    });

    renderMatchResults(result, threshold);
    showToast(`Matching complete: ${result.matched ? result.matched.length : 0} candidate(s) passed`, 'success');
  } catch (err) {
    showToast('Match evaluation failed: ' + err.message, 'error');
  } finally {
    runBtn.disabled = false;
    runBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      Run Match &amp; Rank
    `;
  }
}

function renderMatchResults(data, threshold) {
  const container = document.getElementById('results-section');
  const matchedList = document.getElementById('matched-candidates-list');
  const failedContainer = document.getElementById('failed-candidates-container');
  const failedList = document.getElementById('failed-list');
  const summaryText = document.getElementById('results-summary-text');

  container.style.display = 'block';
  matchedList.innerHTML = '';
  failedList.innerHTML = '';

  const matched = data.matched || [];
  const failed = data.failed || [];

  summaryText.textContent = `Found ${matched.length} ranked candidate(s) meeting the ${threshold}% threshold (${failed.length} failed).`;

  if (matched.length === 0) {
    matchedList.innerHTML = `
      <div class="card">
        <div class="card-body text-center text-muted py-4">
          No candidates met the minimum threshold of ${threshold}%. Try lowering the threshold or checking candidate skills.
        </div>
      </div>
    `;
  } else {
    matched.forEach((candidate, index) => {
      matchedList.appendChild(createCandidateCard(candidate, index + 1));
    });
  }

  if (failed.length > 0) {
    failedContainer.style.display = 'block';
    document.getElementById('failed-count').textContent = failed.length;
    failed.forEach(f => {
      const item = document.createElement('div');
      item.className = 'failed-item';
      item.innerHTML = `
        <strong>File:</strong> <code>${escapeHtml(f.resume_location)}</code><br>
        <span class="text-danger"><strong>Error:</strong> ${escapeHtml(f.error)}</span>
      `;
      failedList.appendChild(item);
    });
  } else {
    failedContainer.style.display = 'none';
  }

  // Smooth scroll down to results
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function createCandidateCard(c, rank) {
  const card = document.createElement('div');
  card.className = 'candidate-card';

  const details = c.candidate_details || {};
  const matchDetail = c.match_detail || {};
  const score = Math.round((c.percentage_match || 0) * 10) / 10;

  // Determine score badge style
  let scoreClass = 'score-low';
  if (score >= 75) scoreClass = 'score-high';
  else if (score >= 45) scoreClass = 'score-mid';

  // Skills
  const matchedMust = matchDetail.matched_must || [];
  const missingMust = matchDetail.missing_must || [];
  const matchedNice = matchDetail.matched_nice || [];
  const missingNice = matchDetail.missing_nice || [];

  // Scores
  const basePct = matchDetail.base_percentage != null ? Math.round(matchDetail.base_percentage) + '%' : 'N/A';
  const semPct = matchDetail.semantic_percentage != null ? Math.round(matchDetail.semantic_percentage) + '%' : 'N/A';

  // Experience
  const expYears = details.experience_years != null ? `${details.experience_years} years` : 'Undetected';
  const expConfidence = details.experience_confidence ? `(${details.experience_confidence} conf)` : '';

  // Evidence
  const evidence = matchDetail.semantic_evidence || null;
  const hasEvidence = evidence && Object.keys(evidence).length > 0;
  const evidenceId = `evidence-${rank}-${Date.now()}`;

  card.innerHTML = `
    <div class="candidate-card-header">
      <div class="candidate-title-area">
        <span class="rank-badge">#${rank}</span>
        <div>
          <h4 class="candidate-name">${escapeHtml(details.name || 'Unnamed Candidate')}</h4>
          <span class="text-muted small">${escapeHtml(c.resume_location)}</span>
        </div>
      </div>
      <div class="score-badge ${scoreClass}">
        ${score}% <span class="small font-normal">Match</span>
      </div>
    </div>

    <div class="candidate-card-body">
      <!-- Contact & Experience Row -->
      <div class="candidate-meta-grid">
        <div class="meta-item">
          <span class="meta-label">Email</span>
          <span class="meta-val">${escapeHtml(details.email || 'Not found')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Phone</span>
          <span class="meta-val">${escapeHtml(details.phone || 'Not found')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Detected Experience</span>
          <span class="meta-val">${expYears} <small class="text-muted">${expConfidence}</small></span>
        </div>
      </div>

      <!-- Score Split Row -->
      <div class="score-breakdown-row">
        <div class="score-stat">
          <div class="score-stat-label">Base Rule Score (Skills + Exp)</div>
          <div class="score-stat-val">${basePct}</div>
        </div>
        <div class="score-stat">
          <div class="score-stat-label">Semantic Match Score (Context Fit)</div>
          <div class="score-stat-val">${semPct}</div>
        </div>
      </div>

      <!-- Skills Evaluation Columns -->
      <div class="skills-evaluation-grid">
        <!-- Must-Have Skills -->
        <div class="skill-eval-col">
          <h5>Must-Have Skills (${matchedMust.length}/${matchedMust.length + missingMust.length})</h5>
          <div class="pill-list">
            ${matchedMust.map(s => `<span class="pill pill-must-matched">&check; ${escapeHtml(s)}</span>`).join('')}
            ${missingMust.map(s => `<span class="pill pill-must-missing">&times; ${escapeHtml(s)}</span>`).join('')}
            ${matchedMust.length === 0 && missingMust.length === 0 ? '<span class="text-muted small">None required</span>' : ''}
          </div>
        </div>

        <!-- Nice-to-Have Skills -->
        <div class="skill-eval-col">
          <h5>Nice-to-Have Skills (${matchedNice.length}/${matchedNice.length + missingNice.length})</h5>
          <div class="pill-list">
            ${matchedNice.map(s => `<span class="pill pill-nice-matched">&check; ${escapeHtml(s)}</span>`).join('')}
            ${missingNice.map(s => `<span class="pill pill-nice-missing">${escapeHtml(s)}</span>`).join('')}
            ${matchedNice.length === 0 && missingNice.length === 0 ? '<span class="text-muted small">None</span>' : ''}
          </div>
        </div>
      </div>

      <!-- Semantic Evidence Dropdown -->
      ${hasEvidence ? `
        <button type="button" class="evidence-toggle-btn" data-target="${evidenceId}">
          <span>Semantic Fit Breakdown (${Object.keys(evidence).length} Requirements Evaluated)</span>
          <span class="toggle-icon">&darr;</span>
        </button>
        <div id="${evidenceId}" class="evidence-panel">
          <table class="evidence-table">
            <thead>
              <tr>
                <th style="width: 35%;">Requirement</th>
                <th style="width: 50%;">Matched Resume Snippet</th>
                <th style="width: 15%;">Similarity</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(evidence).map(([req, ev]) => `
                <tr>
                  <td><strong>${escapeHtml(req)}</strong></td>
                  <td>${escapeHtml(ev.snippet || 'None')}</td>
                  <td><span class="evidence-similarity">${Math.round((ev.similarity || 0) * 100)}%</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

    </div>
  `;

  // Attach accordion listener
  if (hasEvidence) {
    const toggleBtn = card.querySelector(`.evidence-toggle-btn[data-target="${evidenceId}"]`);
    const panel = card.querySelector(`#${evidenceId}`);
    toggleBtn.addEventListener('click', () => {
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';
      toggleBtn.querySelector('.toggle-icon').innerHTML = isVisible ? '&darr;' : '&uarr;';
    });
  }

  return card;
}

/* ========================================================
   Tab 2: Upload Resumes Logic
   ======================================================== */

function initUploadTab() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('resume-file-input');
  const browseBtn = document.getElementById('btn-browse-files');
  const queueContainer = document.getElementById('selected-files-container');
  const queueList = document.getElementById('selected-files-list');
  const queueCount = document.getElementById('file-queue-count');
  const clearQueueBtn = document.getElementById('btn-clear-queue');
  const uploadBtn = document.getElementById('btn-upload-files');
  const transferToMatcherBtn = document.getElementById('btn-transfer-to-matcher');

  // Trigger file browser
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener('click', () => fileInput.click());

  // Drag and drop events
  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files);
    handleSelectedFiles(files);
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    handleSelectedFiles(files);
  });

  function handleSelectedFiles(files) {
    const validExtensions = ['.pdf', '.docx'];
    const validFiles = files.filter(f => {
      const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
      return validExtensions.includes(ext);
    });

    if (validFiles.length < files.length) {
      showToast('Some files were ignored: only .pdf and .docx are supported', 'info');
    }

    state.queuedFiles.push(...validFiles);
    renderQueue();
  }

  function renderQueue() {
    queueList.innerHTML = '';
    if (state.queuedFiles.length === 0) {
      queueContainer.style.display = 'none';
      return;
    }

    queueContainer.style.display = 'block';
    queueCount.textContent = state.queuedFiles.length;

    state.queuedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-queue-item';
      const ext = file.name.split('.').pop().toUpperCase();
      const sizeKb = Math.round(file.size / 1024);

      li.innerHTML = `
        <div class="file-info">
          <span class="file-badge">${ext}</span>
          <strong>${escapeHtml(file.name)}</strong>
          <span class="text-muted small">(${sizeKb} KB)</span>
        </div>
        <button type="button" class="btn btn-link btn-xs text-danger">&times; Remove</button>
      `;

      li.querySelector('button').addEventListener('click', () => {
        state.queuedFiles.splice(index, 1);
        renderQueue();
      });

      queueList.appendChild(li);
    });
  }

  clearQueueBtn.addEventListener('click', () => {
    state.queuedFiles = [];
    fileInput.value = '';
    renderQueue();
  });

  // Perform upload request
  uploadBtn.addEventListener('click', async () => {
    if (state.queuedFiles.length === 0) {
      showToast('No files to upload', 'error');
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    const formData = new FormData();
    state.queuedFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const result = await apiRequest('/upload_resumes', {
        method: 'POST',
        body: formData
      });

      showToast(result.message || 'Files uploaded successfully!', 'success');

      // Record names in session history
      state.queuedFiles.forEach(f => {
        // Files are saved into uploaded/in_queue by the server
        state.sessionUploadedPaths.push(f.name);
      });

      state.queuedFiles = [];
      fileInput.value = '';
      renderQueue();
      renderUploadHistory();
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload to Server';
    }
  });

  // Transfer uploaded file paths into Match tab
  transferToMatcherBtn.addEventListener('click', () => {
    if (state.sessionUploadedPaths.length === 0) {
      showToast('No files uploaded yet in this session', 'info');
      return;
    }
    // Switch to matcher tab
    document.querySelector('.nav-tab[data-tab="tab-matcher"]').click();
    document.getElementById('btn-add-uploaded-paths').click();
  });
}

function renderUploadHistory() {
  const emptyHint = document.getElementById('upload-history-empty');
  const historyList = document.getElementById('upload-history-list');

  if (state.sessionUploadedPaths.length === 0) {
    emptyHint.style.display = 'block';
    historyList.style.display = 'none';
    return;
  }

  emptyHint.style.display = 'none';
  historyList.style.display = 'flex';
  historyList.innerHTML = '';

  state.sessionUploadedPaths.forEach((name) => {
    const li = document.createElement('li');
    li.className = 'file-history-item';
    li.innerHTML = `
      <span>Uploaded: <strong>${escapeHtml(name)}</strong> (queued in <code>uploaded/in_queue/</code>)</span>
    `;
    historyList.appendChild(li);
  });
}

/* ========================================================
   Tab 3: Job Descriptions Manager Logic
   ======================================================== */

function initJdTab() {
  const createForm = document.getElementById('create-jd-form');
  const editForm = document.getElementById('edit-jd-form');
  const prefillBtn = document.getElementById('btn-prefill-jd');
  const fetchEditBtn = document.getElementById('btn-fetch-edit-jd');

  // Prefill Example Data
  prefillBtn.addEventListener('click', () => {
    document.getElementById('create-jd-title').value = 'Senior Python & FastAPI Engineer';
    document.getElementById('create-jd-raw').value = 'We are seeking an experienced Backend Engineer to architect and scale our AI-driven microservices using Python, FastAPI, and PostgreSQL.';
    document.getElementById('create-jd-must-have').value = 'python, fastapi, postgresql, rest';
    document.getElementById('create-jd-nice-to-have').value = 'docker, redis, aws, git';
    document.getElementById('create-jd-exp').value = '3';
    document.getElementById('create-jd-reqs').value = 'Architected and deployed high-performance REST APIs\nExperience with relational schema design and query optimization\nFamiliarity with containerized deployments and CI/CD pipelines';
    document.getElementById('create-w-must').value = '0.5';
    document.getElementById('create-w-nice').value = '0.3';
    document.getElementById('create-w-exp').value = '0.2';
    document.getElementById('create-w-reqs').value = '0.2';
    showToast('Prefilled example Job Description', 'info');
  });

  // Handle Create JD
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('create-jd-title').value.trim();
    const rawText = document.getElementById('create-jd-raw').value.trim();
    const mustHave = parseCommaSeparated(document.getElementById('create-jd-must-have').value);
    const niceToHave = parseCommaSeparated(document.getElementById('create-jd-nice-to-have').value);
    const exp = parseFloat(document.getElementById('create-jd-exp').value);
    const reqs = parseLineSeparated(document.getElementById('create-jd-reqs').value);

    // Validation: no overlap between must and nice
    const overlap = mustHave.filter(skill => niceToHave.includes(skill));
    if (overlap.length > 0) {
      showToast(`Skill overlap detected: "${overlap.join(', ')}" cannot be in both Must-Have and Nice-To-Have.`, 'error');
      return;
    }

    const payload = [
      {
        title: title,
        raw_text: rawText || title,
        parsed: {
          must_have: mustHave,
          nice_to_have: niceToHave,
          experience_years: exp,
          requirements: reqs
        },
        weights: {
          must_have: parseFloat(document.getElementById('create-w-must').value) || 0.5,
          nice_to_have: parseFloat(document.getElementById('create-w-nice').value) || 0.3,
          experience_years: parseFloat(document.getElementById('create-w-exp').value) || 0.2,
          requirements: parseFloat(document.getElementById('create-w-reqs').value) || 0.2
        }
      }
    ];

    const submitBtn = document.getElementById('btn-submit-create-jd');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const res = await apiRequest('/create_jds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast(res.message || 'Job Description created successfully!', 'success');
      createForm.reset();
    } catch (err) {
      showToast('Failed to create JD: ' + err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Job Description';
    }
  });

  // Handle Fetch JD for Editing
  fetchEditBtn.addEventListener('click', async () => {
    const sno = parseInt(document.getElementById('edit-jd-search-sno').value, 10);
    if (!sno || sno < 1) {
      showToast('Please enter a valid JD SNo', 'error');
      return;
    }

    try {
      const jd = await apiRequest(`/get_jd?sno=${sno}`);
      populateEditForm(jd);
      showToast(`Loaded Job Description #${sno}`, 'info');
    } catch (err) {
      showToast(`Could not load JD #${sno}: ${err.message}`, 'error');
    }
  });

  // Handle Edit JD Submit
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sno = parseInt(document.getElementById('edit-jd-sno-hidden').value, 10);
    const title = document.getElementById('edit-jd-title').value.trim();
    const rawText = document.getElementById('edit-jd-raw').value.trim();
    const mustHave = parseCommaSeparated(document.getElementById('edit-jd-must-have').value);
    const niceToHave = parseCommaSeparated(document.getElementById('edit-jd-nice-to-have').value);
    const exp = parseFloat(document.getElementById('edit-jd-exp').value);
    const reqs = parseLineSeparated(document.getElementById('edit-jd-reqs').value);

    const overlap = mustHave.filter(skill => niceToHave.includes(skill));
    if (overlap.length > 0) {
      showToast(`Skill overlap detected: "${overlap.join(', ')}" cannot be in both Must-Have and Nice-To-Have.`, 'error');
      return;
    }

    const payload = {
      title: title,
      raw_text: rawText || title,
      parsed: {
        must_have: mustHave,
        nice_to_have: niceToHave,
        experience_years: exp,
        requirements: reqs
      },
      weights: {
        must_have: parseFloat(document.getElementById('edit-w-must').value) || 0.5,
        nice_to_have: parseFloat(document.getElementById('edit-w-nice').value) || 0.3,
        experience_years: parseFloat(document.getElementById('edit-w-exp').value) || 0.2,
        requirements: parseFloat(document.getElementById('edit-w-reqs').value) || 0.2
      }
    };

    const submitBtn = document.getElementById('btn-submit-edit-jd');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      const res = await apiRequest(`/edit_jd?sno=${sno}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast(res.message || 'Job Description updated successfully!', 'success');
    } catch (err) {
      showToast('Failed to update JD: ' + err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes to JD';
    }
  });
}

function populateEditForm(jd) {
  const form = document.getElementById('edit-jd-form');
  const emptyHint = document.getElementById('edit-jd-empty-hint');
  const parsed = jd.parsed || {};
  const weights = jd.weights || {};

  document.getElementById('edit-jd-sno-hidden').value = jd.sno;
  document.getElementById('edit-jd-title').value = jd.title || '';
  document.getElementById('edit-jd-raw').value = jd.raw_text || '';
  document.getElementById('edit-jd-must-have').value = (parsed.must_have || []).join(', ');
  document.getElementById('edit-jd-nice-to-have').value = (parsed.nice_to_have || []).join(', ');
  document.getElementById('edit-jd-exp').value = parsed.experience_years ?? 1;
  document.getElementById('edit-jd-reqs').value = (parsed.requirements || []).join('\n');

  document.getElementById('edit-w-must').value = weights.must_have ?? 0.5;
  document.getElementById('edit-w-nice').value = weights.nice_to_have ?? 0.3;
  document.getElementById('edit-w-exp').value = weights.experience_years ?? 0.2;
  document.getElementById('edit-w-reqs').value = weights.requirements ?? 0.2;

  emptyHint.style.display = 'none';
  form.style.display = 'block';
}

function parseCommaSeparated(str) {
  if (!str) return [];
  return str
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
}

function parseLineSeparated(str) {
  if (!str) return [];
  return str
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/* ========================================================
   Tab 4: Skills & Keywords Database Logic
   ======================================================== */

function initSkillsTab() {
  const addForm = document.getElementById('add-skill-form');
  const searchInput = document.getElementById('skills-search-input');
  const refreshBtn = document.getElementById('btn-refresh-skills');

  // Handle Add Skill / Keyword Form Submit
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('skill-input-name');
    const keywordInput = document.getElementById('skill-input-keyword');
    const submitBtn = document.getElementById('btn-submit-add-skill');

    const skillName = nameInput.value.trim();
    const keyword = keywordInput.value.trim();

    if (!skillName || !keyword) {
      showToast('Please provide both a Skill Name and a Keyword', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';

    try {
      const endpoint = `/add_skill?keyword=${encodeURIComponent(keyword)}&skill_name=${encodeURIComponent(skillName)}`;
      const result = await apiRequest(endpoint, { method: 'POST' });

      if (result === 'Success') {
        showToast(`Added keyword "${keyword}" under skill "${skillName}"`, 'success');
        keywordInput.value = '';
        await loadSkills();
      } else {
        // Backend returns helpful validation messages like:
        // "Skill keyword already exists. Move if you want it in other skill name."
        showToast(result || 'Could not add skill', 'warning');
      }
    } catch (err) {
      showToast('Error adding skill: ' + err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '+ Add Keyword to Skill';
    }
  });

  // Search input live filtering
  searchInput.addEventListener('input', (e) => {
    renderSkillsList(e.target.value);
  });

  // Refresh button
  refreshBtn.addEventListener('click', () => {
    loadSkills(true);
  });
}

async function loadSkills(showNotification = false) {
  const statsBadge = document.getElementById('skills-stats-badge');
  const listContainer = document.getElementById('skills-list-container');

  try {
    const data = await apiRequest('/get_skills');
    state.skillsData = data || {};

    // Calculate stats
    const categoryCount = Object.keys(state.skillsData).length;
    let keywordCount = 0;
    Object.values(state.skillsData).forEach(arr => {
      if (Array.isArray(arr)) keywordCount += arr.length;
    });

    statsBadge.innerHTML = `<strong>${categoryCount}</strong> Skills &bull; <strong>${keywordCount}</strong> Keywords`;

    // Populate Datalist for autocomplete in Add Skill Form
    const datalist = document.getElementById('existing-skills-datalist');
    if (datalist) {
      datalist.innerHTML = Object.keys(state.skillsData)
        .sort((a, b) => a.localeCompare(b))
        .map(name => `<option value="${escapeHtml(name)}"></option>`)
        .join('');
    }

    const currentSearch = document.getElementById('skills-search-input')?.value || '';
    renderSkillsList(currentSearch);

    if (showNotification) {
      showToast(`Loaded ${categoryCount} skills and ${keywordCount} keywords`, 'info');
    }
  } catch (err) {
    console.error('Failed to load skills:', err);
    statsBadge.textContent = 'Error loading skills';
    listContainer.innerHTML = `
      <div class="preview-empty text-danger">
        Could not load skills database: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function renderSkillsList(filterText = '') {
  const listContainer = document.getElementById('skills-list-container');
  const query = filterText.trim().toLowerCase();

  const entries = Object.entries(state.skillsData).sort(([a], [b]) => a.localeCompare(b));

  // Filter entries
  const filtered = entries.filter(([skillName, keywords]) => {
    if (!query) return true;
    if (skillName.toLowerCase().includes(query)) return true;
    return (keywords || []).some(k => k.toLowerCase().includes(query));
  });

  listContainer.innerHTML = '';

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div class="preview-empty text-muted" style="grid-column: 1 / -1;">
        ${query ? `No skills match "${escapeHtml(query)}"` : 'No skills found in database. Add one on the left.'}
      </div>
    `;
    return;
  }

  filtered.forEach(([skillName, keywords]) => {
    const card = document.createElement('div');
    card.className = 'skill-category-card';

    const kList = Array.isArray(keywords) ? keywords : [];

    card.innerHTML = `
      <div class="skill-card-top">
        <h4 class="skill-category-title">${escapeHtml(skillName)}</h4>
        <span class="skill-count-pill">${kList.length} alias${kList.length === 1 ? '' : 'es'}</span>
      </div>

      <div class="skill-keywords-wrap">
        ${kList.map(kw => `
          <span class="skill-keyword-tag">
            <code>${escapeHtml(kw)}</code>
            <button type="button" class="btn-remove-keyword" title="Delete keyword alias &quot;${escapeHtml(kw)}&quot;" data-skill="${escapeHtml(skillName)}" data-keyword="${escapeHtml(kw)}">&times;</button>
          </span>
        `).join('')}

        <button type="button" class="btn-quick-add-keyword" data-skill="${escapeHtml(skillName)}" title="Add alias keyword to ${escapeHtml(skillName)}">
          + alias
        </button>
      </div>
    `;

    // Attach listener to each remove button
    card.querySelectorAll('.btn-remove-keyword').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const skill = btn.dataset.skill;
        const kw = btn.dataset.keyword;
        if (confirm(`Remove alias keyword "${kw}" from skill "${skill}"?`)) {
          await removeSkillKeyword(skill, kw);
        }
      });
    });

    // Attach listener to "+ alias" quick helper
    card.querySelector('.btn-quick-add-keyword').addEventListener('click', () => {
      const nameInput = document.getElementById('skill-input-name');
      const keywordInput = document.getElementById('skill-input-keyword');
      nameInput.value = skillName;
      keywordInput.focus();
    });

    listContainer.appendChild(card);
  });
}

async function removeSkillKeyword(skillName, keyword) {
  try {
    const endpoint = `/remove_skill?keyword=${encodeURIComponent(keyword)}&skill_name=${encodeURIComponent(skillName)}`;
    const result = await apiRequest(endpoint, { method: 'POST' });

    if (result === 'Success') {
      showToast(`Removed "${keyword}" from ${skillName}`, 'info');
      await loadSkills();
    } else {
      showToast(result || 'Could not remove keyword', 'warning');
    }
  } catch (err) {
    showToast('Failed to remove keyword: ' + err.message, 'error');
  }
}
