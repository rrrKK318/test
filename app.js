const DEFAULT_ERROR_TYPES = [
  ['E1', 'Process Overclaiming'],
  ['E2', 'Evidence-State Drift'],
  ['E3', 'Known-Fact Erasure'],
  ['E4', 'Inference Disguised as Observation'],
  ['E5', 'Old Information Disguised as New Verification'],
  ['E6', 'Null-Result Misuse'],
  ['E7', 'Voluntary Process Disclosure (Positive Case)'],
];

const appState = {
  screen: 'import',
  project: null,
  sources: [],
  spans: [],
  errorGroups: [],
  activeGroupId: null,
  errorTypes: DEFAULT_ERROR_TYPES.map(([code, name]) => ({ code, name })),
};

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const now = () => new Date().toISOString();

function hashString(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return `h_${Math.abs(h)}`;
}

function escapeHtml(s){return s.replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));}

function setState(patch) { Object.assign(appState, patch); render(); }
function getSource() { return appState.sources[0]; }

function parseSections(raw) {
  const lines = raw.split('\n');
  let offset = 0;
  return lines.map((line, i) => { const start = offset; const end = offset + line.length; offset = end + 1; return { section: `line_${i+1}`, start, end, text: line }; });
}

function ensureProject(title='Untitled Project') {
  if (!appState.project) {
    appState.project = { project_id: uid('project'), title, created_at: now(), updated_at: now() };
  }
}

function importText(text, fileName='manual.txt', fileType='text/plain') {
  ensureProject(fileName.replace(/\..+$/, ''));
  const source = {
    source_id: uid('source'),
    project_id: appState.project.project_id,
    file_name: fileName,
    file_type: fileType,
    import_time: now(),
    source_hash: hashString(text),
    raw_text: text,
    parsed_sections: parseSections(text),
  };
  appState.sources = [source];
  appState.spans = [];
  appState.errorGroups = [];
  appState.activeGroupId = null;
  appState.screen = 'workspace';
}

function makeGroup(targetSpanId=null) {
  const n = appState.errorGroups.length + 1;
  const g = { error_group_id: n, project_id: appState.project.project_id, source_id: getSource().source_id, target_span_id: targetSpanId, related_span_ids: [], error_type_code:'', error_type_name:'', rationale:'', severity:'medium', confidence:'medium', correction:'', status:'draft', created_at:now(), updated_at:now() };
  appState.errorGroups.push(g); appState.activeGroupId = n; return g;
}

function selectedOffsets() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount===0) return null;
  const range = sel.getRangeAt(0);
  const root = document.getElementById('textView');
  if (!root || !root.contains(range.commonAncestorContainer)) return null;
  const pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const len = range.toString().length;
  return len ? { start, end:start+len, text:range.toString() } : null;
}

function addSpan(role) {
  const selected = selectedOffsets(); if (!selected) return alert('Select text first.');
  const source = getSource(); if (!source) return;
  let group = appState.errorGroups.find(g => g.error_group_id === appState.activeGroupId);
  if (!group || role==='target_error') group = makeGroup();
  const span = { span_id: uid('span'), error_group_id: group.error_group_id, source_id: source.source_id, span_role: role, section:'main', start_offset:selected.start, end_offset:selected.end, selected_text:selected.text, surrounding_context: source.raw_text.slice(Math.max(0, selected.start-40), Math.min(source.raw_text.length, selected.end+40)) };
  appState.spans.push(span);
  if (role === 'target_error') group.target_span_id = span.span_id;
  if (role === 'related_context') group.related_span_ids.push(span.span_id);
  group.updated_at = now();
  render();
}

function removeActiveGroup() {
  const gid = appState.activeGroupId; if (!gid) return;
  appState.errorGroups = appState.errorGroups.filter(g => g.error_group_id !== gid);
  appState.spans = appState.spans.filter(s => s.error_group_id !== gid);
  appState.activeGroupId = appState.errorGroups[0]?.error_group_id ?? null;
  render();
}

function renderAnnotatedText() {
  const source = getSource(); if (!source) return '';
  const marks = [...appState.spans].sort((a,b)=>a.start_offset-b.start_offset);
  let pos = 0, html='';
  marks.forEach((s)=>{ if (s.start_offset < pos) return; html += escapeHtml(source.raw_text.slice(pos, s.start_offset)); const cls = s.span_role==='target_error'?'target':s.span_role==='related_context'?'related':s.span_role==='evidence'?'evidence':'correction'; const label = s.span_role==='target_error'?`#${s.error_group_id}`:s.span_role==='related_context'?`*${s.error_group_id}`:s.span_role==='evidence'?`E${s.error_group_id}`:`C${s.error_group_id}`; html += `<span class="${cls}" title="${label}">${escapeHtml(source.raw_text.slice(s.start_offset,s.end_offset))}</span>`; pos = s.end_offset; });
  html += escapeHtml(source.raw_text.slice(pos));
  return html;
}

function groupDetails() {
  return appState.errorGroups.find(g => g.error_group_id === appState.activeGroupId);
}

function exportData() {
  const p = appState.project, source = getSource();
  const groups = appState.errorGroups.map(g => {
    const spans = appState.spans.filter(s => s.error_group_id===g.error_group_id);
    return { ...g, spans };
  });

  const md = [`# Annotation Report`,`Project: ${p.title} (${p.project_id})`,`Source: ${source.file_name} (${source.source_id})`,``,`## Error Groups`];
  groups.forEach(g=>{ const target=appState.spans.find(s=>s.span_id===g.target_span_id); const related=appState.spans.filter(s=>g.related_span_ids.includes(s.span_id)); md.push(`### Error Group #${g.error_group_id}`); md.push(`Error Type: ${g.error_type_code} — ${g.error_type_name}`); md.push(`Target Error Span #${g.error_group_id}:\n"${target?.selected_text||''}"`); related.forEach((r,i)=>md.push(`Related Context Span *${g.error_group_id}.${i+1}:\n"${r.selected_text}"`)); md.push(`Rationale:\n${g.rationale||''}`); md.push(`Correction Suggestion:\n${g.correction||''}`); md.push(''); });

  const jsonl = groups.map(g => JSON.stringify({ project_id:p.project_id, source_id:g.source_id, error_group_id:g.error_group_id, error_type:{ code:g.error_type_code, name:g.error_type_name }, spans:g.spans, rationale:g.rationale, severity:g.severity, confidence:g.confidence, suggested_correction:g.correction, status:g.status })).join('\n');

  const csvGroupsHeader = 'project_id,source_id,error_group_id,target_span_id,target_text,related_span_ids,related_text_summary,error_type_code,error_type_name,rationale,severity,confidence,correction,status,annotator,created_at';
  const csvGroupsRows = groups.map(g=>{const target=appState.spans.find(s=>s.span_id===g.target_span_id); const related=appState.spans.filter(s=>g.related_span_ids.includes(s.span_id)).map(s=>s.selected_text).join(' | '); return [p.project_id,g.source_id,g.error_group_id,g.target_span_id,JSON.stringify(target?.selected_text||''),JSON.stringify(g.related_span_ids.join('|')),JSON.stringify(related),g.error_type_code,g.error_type_name,JSON.stringify(g.rationale),g.severity,g.confidence,JSON.stringify(g.correction),g.status,'local_annotator',g.created_at].join(',');}).join('\n');
  const csvSpansHeader = 'span_id,error_group_id,span_role,source_id,section,start_offset,end_offset,selected_text,surrounding_context';
  const csvSpansRows = appState.spans.map(s=>[s.span_id,s.error_group_id,s.span_role,s.source_id,s.section,s.start_offset,s.end_offset,JSON.stringify(s.selected_text),JSON.stringify(s.surrounding_context)].join(',')).join('\n');

  document.getElementById('exports').value = `--- markdown_report.md ---\n${md.join('\n')}\n\n--- error_groups.csv ---\n${csvGroupsHeader}\n${csvGroupsRows}\n\n--- spans.csv ---\n${csvSpansHeader}\n${csvSpansRows}\n\n--- export.jsonl ---\n${jsonl}`;
}

function render() {
  const root = document.getElementById('app');
  if (appState.screen === 'import') {
    root.innerHTML = `<div class="screen"><h1>AI Conversation Error Annotation Tool v0.1</h1><div class="card"><h3>Project / Import</h3><input id="projectTitle" placeholder="Project title" /><textarea id="importText" rows="14" placeholder="Paste plain text or markdown conversation..."></textarea><div><input id="fileInput" type="file" /></div><button id="importBtn">Import and Start Annotation</button><p class="small">v0.1 supports plain text and markdown directly. JSON/JSONL text can be pasted as raw content.</p></div></div>`;
    document.getElementById('importBtn').onclick = () => {
      const txt = document.getElementById('importText').value.trim();
      const title = document.getElementById('projectTitle').value.trim() || 'Untitled Project';
      if (!txt) return alert('Please paste text first.');
      appState.project = { project_id: uid('project'), title, created_at: now(), updated_at: now() };
      importText(txt, `${title}.txt`, 'text/plain');
    };
    document.getElementById('fileInput').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const text = await f.text();
      const title = document.getElementById('projectTitle').value.trim() || f.name;
      appState.project = { project_id: uid('project'), title, created_at: now(), updated_at: now() };
      importText(text, f.name, f.type || 'text/plain');
    };
    return;
  }

  const active = groupDetails();
  root.innerHTML = `<div class="screen"><h2>${appState.project.title}</h2><div class="toolbar card"><button id="goImport">Import Screen</button><button id="newGroup">Create New Error Group</button><button id="removeGroup">Remove Annotation Group</button><button id="goTypes">Error Type Manager</button><button id="goExport">Export Screen</button></div><div class="workspace"><div class="card"><h3>Conversation Source</h3><div class="small">${getSource().file_name} | ${getSource().source_id}</div><div id="textView" class="text-view">${renderAnnotatedText()}</div><div><button id="markTarget">Mark as Target Error Span (#n)</button><button id="markRelated">Mark as Related Context Span (*n)</button><button id="markEvidence">Mark as Evidence Span</button><button id="markCorrection">Mark as Correction Span</button></div></div><div class="card"><h3>Annotation Workspace</h3><div class="small">Active Error Group: <span class="badge">${active?.error_group_id ?? 'none'}</span></div><div class="list">${appState.errorGroups.map(g=>`<div><button class="switch" data-gid="${g.error_group_id}">Group #${g.error_group_id}</button> ${g.error_type_code||'No type'} (${g.status})</div>`).join('') || 'No groups yet.'}</div><label>Error Type</label><select id="etype"><option value="">Select type</option>${appState.errorTypes.map(et=>`<option value="${et.code}">${et.code} — ${et.name}</option>`).join('')}</select><label>Rationale</label><textarea id="rationale" rows="3">${active?.rationale||''}</textarea><div class="row"><div><label>Severity</label><select id="severity"><option>low</option><option selected>medium</option><option>high</option></select></div><div><label>Confidence</label><select id="confidence"><option>low</option><option selected>medium</option><option>high</option></select></div></div><label>Correction Suggestion</label><textarea id="correction" rows="3">${active?.correction||''}</textarea><label>Status</label><select id="status"><option>draft</option><option>complete</option><option>pending_review</option></select><button id="saveMeta">Save Group Fields</button></div></div><div id="exportPanel" class="card" style="margin-top:10px;display:none"><h3>Export</h3><button id="buildExport">Generate Exports</button><textarea id="exports" rows="18"></textarea></div><div id="typesPanel" class="card" style="margin-top:10px;display:none"><h3>Error Type Manager</h3><input id="newCode" placeholder="Code e.g. E8"/><input id="newName" placeholder="Name"/><button id="addType">Add Type</button></div></div>`;

  root.querySelectorAll('.switch').forEach(b=>b.onclick=()=>{appState.activeGroupId=Number(b.dataset.gid);render();});
  document.getElementById('markTarget').onclick=()=>addSpan('target_error');
  document.getElementById('markRelated').onclick=()=>addSpan('related_context');
  document.getElementById('markEvidence').onclick=()=>addSpan('evidence');
  document.getElementById('markCorrection').onclick=()=>addSpan('correction');
  document.getElementById('newGroup').onclick=()=>{makeGroup();render();};
  document.getElementById('removeGroup').onclick=removeActiveGroup;
  document.getElementById('goImport').onclick=()=>setState({screen:'import'});
  document.getElementById('goExport').onclick=()=>{document.getElementById('exportPanel').style.display='block';};
  document.getElementById('goTypes').onclick=()=>{document.getElementById('typesPanel').style.display='block';};
  document.getElementById('buildExport').onclick=exportData;
  document.getElementById('addType').onclick=()=>{const c=document.getElementById('newCode').value.trim(); const n=document.getElementById('newName').value.trim(); if(c&&n){appState.errorTypes.push({code:c,name:n}); render();}};

  if (active) {
    document.getElementById('etype').value = active.error_type_code || '';
    document.getElementById('severity').value = active.severity || 'medium';
    document.getElementById('confidence').value = active.confidence || 'medium';
    document.getElementById('status').value = active.status || 'draft';
  }
  document.getElementById('saveMeta').onclick=()=>{ const g=groupDetails(); if(!g) return; const code=document.getElementById('etype').value; const et=appState.errorTypes.find(x=>x.code===code); g.error_type_code=code; g.error_type_name=et?.name||''; g.rationale=document.getElementById('rationale').value; g.severity=document.getElementById('severity').value; g.confidence=document.getElementById('confidence').value; g.correction=document.getElementById('correction').value; g.status=document.getElementById('status').value; g.updated_at=now(); alert('Saved'); render(); };
}

render();
