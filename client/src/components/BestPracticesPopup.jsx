import { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe,
  Keyboard,
  Lightbulb,
  MessageSquare,
  MousePointer2,
  Package,
  PenSquare,
  X,
  Zap,
} from 'lucide-react';

const STORAGE_KEY = 'pmcp_best_practices_seen';

const sections = [
  {
    id: 'nav',
    label: 'Navigation',
    icon: Globe,
    practices: [
      {
        title: 'Always use full URLs',
        desc: 'Provide the complete absolute URL. Never use relative paths or assume a base URL.',
        bad: ['Navigate to the homepage', 'Go to the login page'],
        good: ['Navigate to https://example.com', 'Navigate to https://example.com/login'],
      },
      {
        title: 'Waits must specify condition or duration',
        desc: 'Without this the runner cannot tell a time-based wait from a condition-based wait.',
        tip: 'Prefer conditions over time delays: "wait until the spinner disappears".',
        bad: ['Wait for the page to load', 'Wait a bit'],
        good: [
          'Wait for 2000 milliseconds',
          "Wait until the element with text 'Dashboard' is visible",
        ],
      },
    ],
  },
  {
    id: 'click',
    label: 'Clicking',
    icon: MousePointer2,
    practices: [
      {
        title: 'Always specify the element type',
        desc: '"Click something" is meaningless. State the element type alongside an identifier.',
        note: 'Valid types: button, link, checkbox, radio, tab, icon button, menu item, dropdown trigger',
        bad: ['Click the button', 'Click submit'],
        good: ["Click the button with text 'Add to Cart'", "Click the button with text 'Submit' in the checkout form"],
      },
      {
        title: 'Identify elements unambiguously',
        desc: 'Priority: (1) visible text → (2) aria-label → (3) placeholder → (4) data-testid → (5) position hint.',
        bad: ['Click the X', 'Click the first item'],
        good: [
          "Click the icon button with aria-label 'Close dialog'",
          "Click the first 'Delete' button in the orders table",
        ],
      },
    ],
  },
  {
    id: 'forms',
    label: 'Forms',
    icon: PenSquare,
    practices: [
      {
        title: 'Declare the label attribute type for every field',
        desc: '"First Name" could be a label, placeholder, aria-label, or name — four different things that produce different tool parameters.',
        table: {
          headers: ['Identifier', 'HTML', 'Step'],
          rows: [
            ['Visible label', '<label>First Name</label>', "Type 'John' into the input with label 'First Name'"],
            ['Placeholder', 'placeholder="Enter first name"', "Type 'John' into the input with placeholder 'Enter first name'"],
            ['aria-label', 'aria-label="first-name-input"', "Type 'John' into the input with aria-label 'first-name-input'"],
          ],
        },
      },
      {
        title: 'One field per step',
        desc: 'Never group multiple inputs into a single step. Each field must be its own step.',
        bad: ["Fill the form with name John Doe, email john@test.com, password Pass123"],
        good: [
          "Type 'John' into the input with placeholder 'First name'",
          "Type 'john@test.com' into the input with label 'Email Address'",
        ],
      },
      {
        title: 'Dropdowns — native vs custom',
        desc: 'These use entirely different tools. Always specify which kind.',
        bad: ['Select a country'],
        good: [
          "Select 'India' from the native dropdown with label 'Country'",
          "Select 'Premium' from the custom dropdown triggered by the button 'Select Plan'",
        ],
      },
      {
        title: 'File uploads — path + input identifier',
        desc: 'Always provide the full file path and clearly identify the upload input.',
        bad: ['Upload a file'],
        good: ["Upload '/files/uploads/invoice.pdf' to the file input with label 'Attach Invoice'"],
      },
    ],
  },
  {
    id: 'assert',
    label: 'Assertions',
    icon: CheckCircle2,
    practices: [
      {
        title: 'Use clear assertion verbs',
        desc: 'The verb directly maps to a tool class. Wrong verb = wrong tool = silent failure.',
        columns: {
          good: { label: 'Use these', items: ['verify', 'check', 'ensure', 'validate', 'confirm', 'assert', 'should see', 'should contain'] },
          bad: { label: 'Avoid', items: ['wait for (implies wait)', 'see (vague)', 'find (DOM query)', 'check the box (checkbox click!)'] },
        },
      },
      {
        title: 'Element + property + expected value',
        desc: 'Missing any of these three forces the LLM to guess.',
        bad: ['Verify the success message', 'Check the price is correct'],
        good: [
          "Verify that the text 'Order placed successfully!' is visible on the page",
          "Verify that the element with text '$49.99' is visible inside the 'Order Summary' section",
        ],
      },
      {
        title: 'Negative assertions must be explicit',
        desc: 'Explicitly state NOT visible, does not exist, or is no longer present.',
        bad: ['The error is gone', 'The modal is closed'],
        good: [
          "Verify that the element with text 'Invalid credentials' is NOT visible",
          "Verify that the dialog with aria-label 'Login dialog' does not exist",
        ],
      },
    ],
  },
  {
    id: 'interact',
    label: 'Scroll / Hover / Keys',
    icon: Keyboard,
    practices: [
      {
        title: 'Scrolling — target + amount',
        desc: 'Specify what to scroll and by how much or until what is visible.',
        bad: ['Scroll down'],
        good: ['Scroll the page down by 500 pixels', "Scroll until the element with text 'Pricing Plans' is visible"],
      },
      {
        title: 'Hovering — include the reason',
        desc: 'Why you hover determines the follow-up tool the LLM needs.',
        bad: ['Hover over the menu'],
        good: ["Hover over the link with text 'Products' to reveal its dropdown menu"],
      },
      {
        title: 'Keyboard — key + focused element',
        desc: '"Press enter" without context is ambiguous.',
        bad: ['Press enter'],
        good: ['Press the Enter key while the search input is focused', 'Press Escape to close the modal dialog'],
      },
    ],
  },
  {
    id: 'dialogs',
    label: 'Dialogs',
    icon: MessageSquare,
    practices: [
      {
        title: 'Native browser dialogs need special phrasing',
        desc: 'alert/confirm/prompt require browser_handle_dialog. Regular clicks do not work.',
        warn: 'Custom HTML modals are different — use regular click steps for those.',
        bad: ['Click OK on the popup', 'Accept the confirmation'],
        good: [
          'Handle the browser alert dialog by clicking Accept',
          "Handle the browser prompt dialog by typing 'John' and clicking Accept",
        ],
      },
      {
        title: 'Custom HTML modals — regular click steps',
        desc: 'Custom modals are regular DOM elements. Interact with their buttons.',
        bad: ['Close the modal'],
        good: ["Click the button with text 'Yes, Delete' inside the modal dialog"],
      },
    ],
  },
  {
    id: 'scope',
    label: 'Scoping',
    icon: Package,
    practices: [
      {
        title: 'Scope clicks when multiple elements match',
        desc: 'If 5 rows each have a "Delete" button, scope to the row.',
        bad: ['Click the Delete button'],
        good: ["Click the button with text 'Delete' in the row containing 'Order #1042'"],
      },
      {
        title: 'Ordinal refs need type + container',
        desc: '"First", "second", "last" must be combined with element type and container.',
        bad: ['Click the first item'],
        good: ['Click the first product card in the search results list'],
      },
    ],
  },
];

const quickRef = [
  { action: 'Navigate', pattern: "Navigate to <full-url>" },
  { action: 'Click button', pattern: "Click the button with text '<label>'" },
  { action: 'Click link', pattern: "Click the link with text '<label>'" },
  { action: 'Type (label)', pattern: "Type '<value>' into the input with label '<label>'" },
  { action: 'Type (placeholder)', pattern: "Type '<value>' into the input with placeholder '<text>'" },
  { action: 'Native dropdown', pattern: "Select '<option>' from the native dropdown with label '<label>'" },
  { action: 'Custom dropdown', pattern: "Select '<option>' from the custom dropdown triggered by '<label>'" },
  { action: 'Checkbox', pattern: "Check / Uncheck the checkbox with label '<label>'" },
  { action: 'Wait (time)', pattern: "Wait for <N> milliseconds" },
  { action: 'Wait (condition)', pattern: "Wait until the element with text '<text>' is visible" },
  { action: 'Assert visible', pattern: "Verify that the text '<text>' is visible on the page" },
  { action: 'Assert not visible', pattern: "Verify that the element with text '<text>' is NOT visible" },
  { action: 'Scroll', pattern: "Scroll the page down by <N> pixels" },
  { action: 'Dialog', pattern: "Handle the browser <alert|confirm> dialog by clicking <Accept|Dismiss>" },
  { action: 'Screenshot', pattern: "Take a screenshot and save as './screenshots/<name>.png'" },
  { action: 'Hover', pattern: "Hover over the <type> with text '<label>' to <reason>" },
  { action: 'Keyboard', pattern: "Press the <Key> key while <element> is focused" },
];



export default function BestPracticesPopup({ manualOpen = false, onClose }) {
  const isFirstVisit = !localStorage.getItem(STORAGE_KEY);
  const [dismissedFirstVisit, setDismissedFirstVisit] = useState(false);
  const [activeTab, setActiveTab] = useState('guide');
  const [activeSection, setActiveSection] = useState(sections[0].id);
  const [expandedCards, setExpandedCards] = useState(new Set());

  const visible = manualOpen || (isFirstVisit && !dismissedFirstVisit);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissedFirstVisit(true);
    if (onClose) onClose();
  };

  const toggleCard = (key) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  if (!visible) return null;

  const currentSection = sections.find(s => s.id === activeSection);

  return (
    <div className="bp-overlay" onClick={handleClose}>
      <div className="bp-popup" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="bp-header">
          <div className="bp-header-left">
            <div className="bp-logo">
              <span className="bp-logo-icon"><BookOpen size={18} aria-hidden="true" /></span>
              <div>
                <h2 className="bp-title">Writing Test Steps</h2>
                <p className="bp-subtitle">Guidelines for clear, executable browser automation steps</p>
              </div>
            </div>
          </div>
          <div className="bp-header-right">
            <div className="bp-tabs">
              {[
                { id: 'guide', label: 'Guide', icon: BookOpen },
                { id: 'patterns', label: 'Patterns', icon: Zap },
              ].map(t => (
                <button
                  key={t.id}
                  className={`bp-tab ${activeTab === t.id ? 'bp-tab--active' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <span className="bp-tab-icon"><t.icon size={14} aria-hidden="true" /></span>
                  {t.label}
                </button>
              ))}
            </div>
            <button className="bp-close" onClick={handleClose} title="Close">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ── Core principle banner ── */}
        <div className="bp-banner">
          <span className="bp-banner-icon"><Lightbulb size={16} aria-hidden="true" /></span>
          <span>
            You don't need to follow the examples word-for-word — just make sure each step has <strong>enough detail</strong> for the LLM to identify the right element and action <strong>without guessing</strong>.
          </span>
        </div>

        {/* ════ Tab: Guide ════ */}
        {activeTab === 'guide' && (
          <div className="bp-layout">
            {/* Sidebar nav */}
            <nav className="bp-nav">
              {sections.map(s => (
                <button
                  key={s.id}
                  className={`bp-nav-item ${activeSection === s.id ? 'bp-nav-item--active' : ''}`}
                  onClick={() => setActiveSection(s.id)}
                >
                  <span className="bp-nav-icon"><s.icon size={15} aria-hidden="true" /></span>
                  <span className="bp-nav-label">{s.label}</span>
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="bp-content">
              {currentSection && (
                <div className="bp-section" key={currentSection.id}>
                  <div className="bp-section-header">
                    <span className="bp-section-icon"><currentSection.icon size={18} aria-hidden="true" /></span>
                    <h3 className="bp-section-title">{currentSection.label}</h3>
                  </div>

                  <div className="bp-cards">
                    {currentSection.practices.map((p, pi) => {
                      const cardKey = `${currentSection.id}-${pi}`;
                      const isOpen = expandedCards.has(cardKey);

                      return (
                        <div key={pi} className={`bp-card ${isOpen ? 'bp-card--open' : ''}`}>
                          <div className="bp-card-head" onClick={() => toggleCard(cardKey)}>
                            <h4 className="bp-card-title">{p.title}</h4>
                            <span className={`bp-card-chevron ${isOpen ? 'bp-card-chevron--open' : ''}`}>
                              <ChevronDown size={12} aria-hidden="true" />
                            </span>
                          </div>
                          <p className="bp-card-desc">{p.desc}</p>

                          {isOpen && (
                            <div className="bp-card-body">
                              {p.note && <div className="bp-note">{p.note}</div>}
                              {p.tip && (
                                <div className="bp-tip">
                                  <Lightbulb size={14} aria-hidden="true" /> {p.tip}
                                </div>
                              )}
                              {p.warn && (
                                <div className="bp-warn">
                                  <AlertTriangle size={14} aria-hidden="true" /> {p.warn}
                                </div>
                              )}

                              {/* Columns (good/bad verbs) */}
                              {p.columns && (
                                <div className="bp-columns">
                                  <div className="bp-col bp-col--good">
                                    <div className="bp-col-label">{p.columns.good.label}</div>
                                    {p.columns.good.items.map((item, i) => (
                                      <div key={i} className="bp-col-item"><code>{item}</code></div>
                                    ))}
                                  </div>
                                  <div className="bp-col bp-col--bad">
                                    <div className="bp-col-label">{p.columns.bad.label}</div>
                                    {p.columns.bad.items.map((item, i) => (
                                      <div key={i} className="bp-col-item"><code>{item}</code></div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Table */}
                              {p.table && (
                                <div className="bp-table-wrap">
                                  <table className="bp-table">
                                    <thead>
                                      <tr>{p.table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                      {p.table.rows.map((row, ri) => (
                                        <tr key={ri}>{row.map((cell, ci) => <td key={ci}><code>{cell}</code></td>)}</tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Examples */}
                              {(p.bad || p.good) && (
                                <div className="bp-examples">
                                  {p.bad?.map((text, i) => (
                                    <div key={`b${i}`} className="bp-ex bp-ex--bad">
                                      <span className="bp-ex-badge"><X size={12} aria-hidden="true" /></span>
                                      <code>{text}</code>
                                    </div>
                                  ))}
                                  {p.good?.map((text, i) => (
                                    <div key={`g${i}`} className="bp-ex bp-ex--good">
                                      <span className="bp-ex-badge"><Check size={12} aria-hidden="true" /></span>
                                      <code>{text}</code>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════ Tab: Patterns ════ */}
        {activeTab === 'patterns' && (
          <div className="bp-body-scroll">
            <p className="bp-intro">Copy-paste these patterns. Replace <code>&lt;angle brackets&gt;</code> with your values.</p>
            <div className="bp-table-wrap">
              <table className="bp-table">
                <thead>
                  <tr><th>Action</th><th>Pattern</th></tr>
                </thead>
                <tbody>
                  {quickRef.map((row, i) => (
                    <tr key={i}>
                      <td><span className="bp-action-badge">{row.action}</span></td>
                      <td><code>{row.pattern}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="bp-footer">
          <span className="bp-footer-hint">Reopen anytime from the sidebar</span>
          <button className="bp-footer-btn" onClick={handleClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
