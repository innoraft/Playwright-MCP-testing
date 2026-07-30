import { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../hooks/useAuth';

// ── Constants ─────────────────────────────────────────────
const FIELD_TYPES = [
  'text', 'textarea', 'email', 'password', 'number',
  'select', 'multiselect', 'checkbox', 'radio', 'datepicker', 'autocomplete',
];
const SELECT_STRATEGIES = ['visibleText', 'value', 'index'];
const META_COLUMNS = ['ExpectedResult', 'ExpectedMessage'];

// ── CSV parser ────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const parse = (line) => {
    const result = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  };
  const headers = parse(lines[0]);
  const rows = lines.slice(1).map(parse);
  return { headers, rows };
}

// ── XLSX parser (browser) ─────────────────────────────────
function parseXlsx(arrayBuffer) {
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = data[0].map(String);
  const rows = data.slice(1).map(r => headers.map((_, i) => r[i] !== undefined ? r[i] : ''));
  return { headers, rows };
}

// ── Infer field type from column name ─────────────────────
function inferFieldType(colName) {
  const lower = colName.toLowerCase();
  if (lower.includes('email')) return 'email';
  if (lower.includes('password') || lower.includes('pass')) return 'password';
  if (lower.includes('phone') || lower.includes('mobile') || lower.includes('number')) return 'number';
  if (lower.includes('date') || lower.includes('dob') || lower.includes('birth')) return 'datepicker';
  if (lower.includes('country') || lower.includes('state') || lower.includes('city') || lower.includes('gender') || lower.includes('select')) return 'select';
  if (lower.includes('agree') || lower.includes('terms') || lower.includes('check')) return 'checkbox';
  if (lower.includes('message') || lower.includes('comment') || lower.includes('description') || lower.includes('address')) return 'textarea';
  return 'text';
}

// ── YAML generator ────────────────────────────────────────
function generateYaml({ testName, url, formSelector, fieldMappings, columns, rows, successAssertions, failureAssertions, execution }) {
  const lines = [];
  lines.push(`form-validation: ${testName}`);
  lines.push(``);
  lines.push(`target:`);
  lines.push(`  url: ${url}`);
  if (formSelector.trim()) lines.push(`  formSelector: "${formSelector.trim()}"`);
  lines.push(``);
  lines.push(`fieldMappings:`);
  const dataCols = columns.filter(c => !META_COLUMNS.includes(c));
  for (const col of dataCols) {
    const cfg = fieldMappings[col] || {};
    lines.push(``);
    lines.push(`  ${col}:`);
    if (cfg.selector?.trim()) lines.push(`    selector: "${cfg.selector.trim()}"`);
    lines.push(`    type: ${cfg.type || 'text'}`);
    if (cfg.format?.trim()) lines.push(`    format: "${cfg.format.trim()}"`);
    if ((cfg.type === 'select' || cfg.type === 'multiselect') && cfg.selectBy) {
      lines.push(`    selectBy: ${cfg.selectBy}`);
    }
  }
  lines.push(``);
  lines.push(`dataset:`);
  lines.push(`  columns:`);
  for (const col of columns) lines.push(`    - ${col}`);
  lines.push(`  rows:`);
  for (const row of rows) lines.push(`    - ${JSON.stringify(row)}`);
  lines.push(``);
  lines.push(`assertions:`);
  lines.push(``);
  lines.push(`  success:`);
  for (const a of successAssertions) {
    if (!a.type) continue;
    lines.push(`    - type: ${a.type}`);
    if (a.value) lines.push(`      value: "${a.value}"`);
    if (a.field) lines.push(`      field: "${a.field}"`);
  }
  lines.push(``);
  lines.push(`  failure:`);
  for (const a of failureAssertions) {
    if (!a.type) continue;
    lines.push(`    - type: ${a.type}`);
    if (a.value) lines.push(`      value: "${a.value}"`);
    if (a.field) lines.push(`      field: "${a.field}"`);
  }
  lines.push(``);
  lines.push(`execution:`);
  lines.push(`  resetBetweenRows: ${execution.resetBetweenRows}`);
  lines.push(`  stopOnFailure: ${execution.stopOnFailure}`);
  lines.push(`  screenshotOnFailure: ${execution.screenshotOnFailure}`);
  lines.push(``);
  return lines.join('\n');
}

// ── Parse existing YAML back into UI state ────────────────
function parseExistingYaml(content) {
  const lines = content.split('\n');
  const get = (key) => {
    const line = lines.find(l => l.trimStart().startsWith(`${key}:`));
    return line ? line.replace(/.*?:\s*/, '').trim().replace(/^["']|["']$/g, '') : '';
  };

  const testName = get('form-validation');

  // target block
  let url = '', formSelector = '';
  const tIdx = lines.findIndex(l => l.trimStart() === 'target:');
  if (tIdx !== -1) {
    for (let i = tIdx + 1; i < lines.length && lines[i].match(/^\s{2}/); i++) {
      const t = lines[i].trim();
      if (t.startsWith('url:')) url = t.replace('url:', '').trim().replace(/^["']|["']$/g, '');
      if (t.startsWith('formSelector:')) formSelector = t.replace('formSelector:', '').trim().replace(/^["']|["']$/g, '');
    }
  }

  // dataset columns
  const columns = [];
  const colIdx = lines.findIndex(l => l.trim() === 'columns:');
  if (colIdx !== -1) {
    for (let i = colIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t.startsWith('-')) break;
      columns.push(t.replace(/^-\s*/, '').trim());
    }
  }

  // dataset rows
  const rows = [];
  const rowIdx = lines.findIndex(l => l.trim() === 'rows:');
  if (rowIdx !== -1) {
    for (let i = rowIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t.startsWith('-')) break;
      const arrStr = t.replace(/^-\s*/, '').trim();
      try { rows.push(JSON.parse(arrStr)); } catch { /* skip invalid */ }
    }
  }

  // fieldMappings
  const fieldMappings = {};
  const fmIdx = lines.findIndex(l => l.trim() === 'fieldMappings:');
  if (fmIdx !== -1) {
    let i = fmIdx + 1;
    while (i < lines.length) {
      const raw = lines[i];
      if (!raw || raw.trim() === '') { i++; continue; }
      const indent = raw.match(/^(\s*)/)[1].length;
      if (indent === 0) break;
      if (indent === 2 && raw.trim().endsWith(':')) {
        const colName = raw.trim().slice(0, -1);
        fieldMappings[colName] = {};
        i++;
        while (i < lines.length && lines[i].match(/^\s{4}/)) {
          const fp = lines[i].trim();
          if (fp.startsWith('selector:')) fieldMappings[colName].selector = fp.replace('selector:', '').trim().replace(/^["']|["']$/g, '');
          else if (fp.startsWith('type:')) fieldMappings[colName].type = fp.replace('type:', '').trim();
          else if (fp.startsWith('format:')) fieldMappings[colName].format = fp.replace('format:', '').trim().replace(/^["']|["']$/g, '');
          else if (fp.startsWith('selectBy:')) fieldMappings[colName].selectBy = fp.replace('selectBy:', '').trim();
          i++;
        }
      } else { i++; }
    }
  }

  // assertions
  const successAssertions = [], failureAssertions = [];
  const parseAssertionBlock = (sectionLabel) => {
    const idx = lines.findIndex(l => l.trim() === `${sectionLabel}:`);
    if (idx === -1) return [];
    const result = [];
    let cur = null;
    for (let i = idx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || (!t.startsWith('-') && !t.startsWith('type:') && !t.startsWith('value:') && !t.startsWith('field:') && lines[i].match(/^\s{2}[a-z]/))) break;
      if (t.startsWith('- type:')) { if (cur) result.push(cur); cur = { type: t.replace('- type:', '').trim() }; }
      else if (t.startsWith('type:') && cur) { cur.type = t.replace('type:', '').trim(); }
      else if (t.startsWith('value:') && cur) { cur.value = t.replace('value:', '').trim().replace(/^["']|["']$/g, ''); }
      else if (t.startsWith('field:') && cur) { cur.field = t.replace('field:', '').trim().replace(/^["']|["']$/g, ''); }
    }
    if (cur) result.push(cur);
    return result;
  };
  successAssertions.push(...parseAssertionBlock('success'));
  failureAssertions.push(...parseAssertionBlock('failure'));

  // execution
  const execution = {
    resetBetweenRows: get('resetBetweenRows') !== 'false',
    stopOnFailure: get('stopOnFailure') === 'true',
    screenshotOnFailure: get('screenshotOnFailure') !== 'false',
  };

  return { testName, url, formSelector, columns, rows, fieldMappings, successAssertions, failureAssertions, execution };
}

// ── Assertion editor sub-component ───────────────────────
function AssertionEditor({ label, assertions, onChange }) {
  const ASSERTION_TYPES = ['text-visible', 'field-error', 'element-visible', 'url-change'];

  const add = () => onChange([...assertions, { type: 'text-visible', value: '', field: '' }]);
  const remove = (i) => onChange(assertions.filter((_, idx) => idx !== i));
  const update = (i, key, val) => {
    const updated = [...assertions];
    updated[i] = { ...updated[i], [key]: val };
    onChange(updated);
  };

  return (
    <div className="form-group">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label className="form-label" style={{ margin: 0 }}>{label}</label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={add}>+ Add</button>
      </div>
      {assertions.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No assertions configured</div>
      )}
      {assertions.map((a, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <select className="form-input" value={a.type} onChange={e => update(i, 'type', e.target.value)}>
            {ASSERTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="form-input" placeholder="value" value={a.value || ''} onChange={e => update(i, 'value', e.target.value)} />
          <input className="form-input" placeholder="field (for field-error)" value={a.field || ''} onChange={e => update(i, 'field', e.target.value)} />
          <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────
export default function FormValidationSheetUpload({ initialData, onSave, saving }) {
  const { authFetch } = useAuth();

  // Metadata
  const [testName, setTestName] = useState(initialData?.testName || '');
  const [url, setUrl] = useState(initialData?.url || '');
  const [formSelector, setFormSelector] = useState(initialData?.formSelector || '');

  // Sheet
  const [columns, setColumns] = useState(initialData?.columns || []);
  const [rows, setRows] = useState(initialData?.rows || []);
  const [sheetFileName, setSheetFileName] = useState('');

  // Field mappings: { [colName]: { selector, type, format, selectBy } }
  const [fieldMappings, setFieldMappings] = useState(initialData?.fieldMappings || {});

  // Assertions
  const [successAssertions, setSuccessAssertions] = useState(initialData?.successAssertions || [{ type: 'text-visible', value: '', field: '' }]);
  const [failureAssertions, setFailureAssertions] = useState(initialData?.failureAssertions || [{ type: 'field-error', value: '', field: '' }]);

  // Execution config
  const [execution, setExecution] = useState(initialData?.execution || {
    resetBetweenRows: true,
    stopOnFailure: false,
    screenshotOnFailure: true,
  });

  // UI state
  const [errors, setErrors] = useState({});
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [showYamlPreview, setShowYamlPreview] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [smartMatch, setSmartMatch] = useState(true);

  const fileInputRef = useRef(null);

  // Sheet upload
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    const allowedTypes = [
      'text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    const ext = file.name.split('.').pop().toLowerCase();

    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setUploadError('Only .csv and .xlsx/.xls files are supported');
      return;
    }

    setSheetFileName(file.name);

    try {
      let parsed;
      if (ext === 'csv') {
        const text = await file.text();
        parsed = parseCsv(text);
      } else {
        const buffer = await file.arrayBuffer();
        parsed = parseXlsx(buffer);
      }

      if (parsed.headers.length === 0) {
        setUploadError('The uploaded file has no column headers');
        return;
      }

      // Sanitize: filter injection-prone cell values
      const sanitizeValue = (v) => {
        if (typeof v === 'string') {
          // Strip formula injection characters at start of cell
          return v.replace(/^[=+\-@|]/, '');
        }
        return v;
      };

      const safeHeaders = parsed.headers.map(h => sanitizeValue(String(h)));
      const safeRows = parsed.rows.map(r => r.map(sanitizeValue));

      setColumns(safeHeaders);
      setRows(safeRows);

      // Auto-populate field mappings for non-meta columns
      const newMappings = { ...fieldMappings };
      for (const col of safeHeaders) {
        if (META_COLUMNS.includes(col)) continue;
        if (!newMappings[col]) {
          newMappings[col] = { selector: '', type: inferFieldType(col), selectBy: 'visibleText', format: '' };
        }
      }
      setFieldMappings(newMappings);
    } catch (err) {
      setUploadError(`Failed to parse file: ${err.message}`);
    }

    // Reset the input so the same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [fieldMappings]);

  // ── Auto-detect form fields ─────────────────────────────
  const handleAutoDetect = useCallback(async () => {
    if (!url || !/^https?:\/\/.+/.test(url)) {
      setDetectError('Enter a valid URL before detecting fields');
      return;
    }
    setDetecting(true);
    setDetectError('');
    try {
      const res = await authFetch('/api/forms/detect', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      // Guard against HTML error pages (e.g. server not yet restarted)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}). Restart the server and try again.`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Detection failed');

      const { forms } = data;
      if (!forms || forms.length === 0) {
        setDetectError('No forms detected on the page');
        return;
      }

      // Pick the form matching formSelector, or first
      const chosenForm = formSelector
        ? forms.find(f => f.formSelector === formSelector) || forms[0]
        : forms[0];

      if (chosenForm.formSelector && !formSelector) {
        setFormSelector(chosenForm.formSelector);
      }

      // Populate mappings from detected fields
      const newMappings = { ...fieldMappings };
      for (const field of chosenForm.fields) {
        const col = field.name;
        if (!newMappings[col]) {
          newMappings[col] = {
            selector: field.selector || '',
            type: field.type || 'text',
            selectBy: 'visibleText',
            format: '',
          };
        } else if (field.selector && !newMappings[col].selector) {
          newMappings[col].selector = field.selector;
        }
      }
      setFieldMappings(newMappings);
    } catch (err) {
      setDetectError(err.message);
    } finally {
      setDetecting(false);
    }
  }, [url, formSelector, fieldMappings, authFetch]);

  // ── Update a mapping field ──────────────────────────────
  const updateMapping = useCallback((col, key, val) => {
    setFieldMappings(prev => ({
      ...prev,
      [col]: { ...prev[col], [key]: val },
    }));
  }, []);

  // ── Validation ──────────────────────────────────────────
  const validate = useCallback(() => {
    const errs = {};
    if (!testName.trim()) errs.testName = 'Test name is required';
    if (!url.trim() || !/^https?:\/\/.+/.test(url)) errs.url = 'A valid URL is required';
    if (columns.length === 0) errs.sheet = 'Upload a spreadsheet to define the dataset';
    if (rows.length === 0) errs.sheet = 'The spreadsheet must have at least one data row';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [testName, url, columns, rows]);

  // ── YAML preview ────────────────────────────────────────
  const buildYaml = useCallback(() => generateYaml({
    testName, url, formSelector, fieldMappings, columns, rows,
    successAssertions, failureAssertions, execution,
  }), [testName, url, formSelector, fieldMappings, columns, rows, successAssertions, failureAssertions, execution]);

  // ── Save ────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!validate()) return;
    const yaml = buildYaml();
    const fileName = testName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    onSave(fileName, yaml);
  }, [validate, buildYaml, testName, onSave]);

  // ── Render: data columns only (non-meta) ─────────────────
  const dataColumns = columns.filter(c => !META_COLUMNS.includes(c));

  return (
    <div className="test-form">
      {/* ── Section 1: Test Metadata ───────────────────── */}
      <div className="form-section">
        <h3 className="form-section-title">Test Metadata</h3>

        <div className="form-group">
          <label className="form-label" htmlFor="fv-test-name">
            Test Name <span className="form-required">*</span>
          </label>
          <input
            id="fv-test-name"
            className={`form-input ${errors.testName ? 'form-input-error' : ''}`}
            placeholder="Contact Form Validation"
            value={testName}
            onChange={e => { setTestName(e.target.value); setErrors(p => ({ ...p, testName: undefined })); }}
          />
          {errors.testName && <span className="form-error">{errors.testName}</span>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="fv-url">
            Target URL <span className="form-required">*</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="fv-url"
              className={`form-input ${errors.url ? 'form-input-error' : ''}`}
              placeholder="https://example.com/contact"
              value={url}
              onChange={e => { setUrl(e.target.value); setErrors(p => ({ ...p, url: undefined })); }}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleAutoDetect}
              disabled={detecting}
              style={{ whiteSpace: 'nowrap' }}
            >
              {detecting ? '⏳ Detecting…' : '🔍 Auto-Detect Fields'}
            </button>
          </div>
          {errors.url && <span className="form-error">{errors.url}</span>}
          {detectError && <span className="form-error">{detectError}</span>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="fv-selector">
            Form Selector <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="fv-selector"
            className="form-input"
            placeholder="#contact-form"
            value={formSelector}
            onChange={e => setFormSelector(e.target.value)}
          />
          <span className="form-label-hint">CSS selector for the form element. Leave blank for auto-detection.</span>
        </div>
      </div>

      {/* ── Section 2: Sheet Upload ────────────────────── */}
      <div className="form-section">
        <h3 className="form-section-title">Dataset (Spreadsheet Upload)</h3>

        <div className="form-group">
          <label className="form-label">Upload CSV / XLSX <span className="form-required">*</span></label>
          <div
            className={`upload-drop-zone ${errors.sheet ? 'upload-drop-zone-error' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <span style={{ fontSize: 28 }}>📊</span>
            <span style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>
              {sheetFileName
                ? `${sheetFileName} — ${rows.length} rows, ${columns.length} columns`
                : 'Click to upload .csv or .xlsx'}
            </span>
            {columns.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Column headings will be used as field identifiers
              </span>
            )}
          </div>
          {uploadError && <span className="form-error">{uploadError}</span>}
          {errors.sheet && <span className="form-error">{errors.sheet}</span>}
        </div>

        {/* Data preview */}
        {columns.length > 0 && (
          <div className="form-group">
            <label className="form-label">Preview (first 5 rows)</label>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {columns.map(c => (
                      <th key={c} style={{ padding: '6px 10px', background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '5px 10px', border: '1px solid var(--border)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {cell === null || cell === undefined ? '' : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
                  … and {rows.length - 5} more rows
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 3: Field Mapping ───────────────────── */}
      {dataColumns.length > 0 && (
        <div className="form-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 className="form-section-title" style={{ margin: 0 }}>Field Mapping</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSmartMatch(p => !p)}
            >
              {smartMatch ? '⚙️ Configure manually' : '✨ Use smart match'}
            </button>
          </div>

          {smartMatch ? (
            <>
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                ✨ <strong style={{ color: 'var(--text-primary)' }}>Smart match on</strong> — field selectors are discovered automatically at runtime using the column name. Only adjust the field type if needed.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {dataColumns.map(col => {
                  const cfg = fieldMappings[col] || {};
                  return (
                    <div key={col} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--surface-raised)' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col}>
                        {col}
                      </div>
                      <select
                        className="form-input"
                        style={{ fontSize: 12, padding: '4px 8px' }}
                        value={cfg.type || 'text'}
                        onChange={e => updateMapping(col, 'type', e.target.value)}
                      >
                        {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                Provide a CSS selector for each field. Leave blank to fall back to smart matching.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                {dataColumns.map(col => {
                  const cfg = fieldMappings[col] || {};
                  return (
                    <div key={col} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, background: 'var(--surface-raised)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
                        {col}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label className="form-label" style={{ fontSize: 12 }}>Selector (optional)</label>
                          <input
                            className="form-input"
                            placeholder={`#${col.toLowerCase().replace(/\s+/g, '-')}`}
                            value={cfg.selector || ''}
                            onChange={e => updateMapping(col, 'selector', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: 12 }}>Field Type</label>
                          <select
                            className="form-input"
                            value={cfg.type || 'text'}
                            onChange={e => updateMapping(col, 'type', e.target.value)}
                          >
                            {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        {(cfg.type === 'datepicker') && (
                          <div>
                            <label className="form-label" style={{ fontSize: 12 }}>Date Format</label>
                            <input
                              className="form-input"
                              placeholder="DD/MM/YYYY"
                              value={cfg.format || ''}
                              onChange={e => updateMapping(col, 'format', e.target.value)}
                            />
                          </div>
                        )}
                        {(cfg.type === 'select' || cfg.type === 'multiselect') && (
                          <div>
                            <label className="form-label" style={{ fontSize: 12 }}>Select Strategy</label>
                            <select
                              className="form-input"
                              value={cfg.selectBy || 'visibleText'}
                              onChange={e => updateMapping(col, 'selectBy', e.target.value)}
                            >
                              {SELECT_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Section 4: Assertions ─────────────────────── */}
      <div className="form-section">
        <h3 className="form-section-title">Validation Criteria</h3>

        <AssertionEditor
          label="Success Assertions (when ExpectedResult = PASS)"
          assertions={successAssertions}
          onChange={setSuccessAssertions}
        />

        <div style={{ marginTop: 20 }}>
          <AssertionEditor
            label="Failure Assertions (when ExpectedResult = FAIL)"
            assertions={failureAssertions}
            onChange={setFailureAssertions}
          />
        </div>
      </div>

      {/* ── Section 5: Execution Config ───────────────── */}
      <div className="form-section">
        <h3 className="form-section-title">Execution Settings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { key: 'resetBetweenRows', label: 'Reset between rows', hint: 'Reload page before each row' },
            { key: 'stopOnFailure', label: 'Stop on first failure' },
            { key: 'screenshotOnFailure', label: 'Screenshot on failure' },
          ].map(({ key, label, hint }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!execution[key]}
                onChange={e => setExecution(p => ({ ...p, [key]: e.target.checked }))}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{label}</span>
                {hint && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{hint}</div>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ── YAML Preview ──────────────────────────────── */}
      <div className="form-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowYamlPreview(p => !p)}
          >
            {showYamlPreview ? '▲ Hide YAML' : '▼ Preview YAML'}
          </button>
        </div>
        {showYamlPreview && columns.length > 0 && (
          <pre style={{
            marginTop: 12,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 16,
            fontSize: 12,
            overflowX: 'auto',
            color: 'var(--text-secondary)',
            maxHeight: 400,
            overflowY: 'auto',
          }}>
            {buildYaml()}
          </pre>
        )}
      </div>

      {/* ── Save Button ───────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '⏳ Saving…' : '💾 Save Test'}
        </button>
      </div>
    </div>
  );
}

// Export the YAML parser so TestSuites.jsx can use it for edit mode
export { parseExistingYaml };
