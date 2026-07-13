import { h, render } from './vendor/preact.mjs';
import { useEffect, useMemo, useState } from './vendor/preact-hooks.mjs';
import htm from './vendor/htm.mjs';

const html = htm.bind(h);

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = data?.error;
    throw new Error(typeof error === 'string' ? error : error?.message || `请求失败 (${response.status})`);
  }
  return data;
}

const api = {
  dashboard: () => request('/api/dashboard'),
  skills: () => request('/api/skills'),
  detail: id => request(`/api/skills/${encodeURIComponent(id)}`),
  settings: () => request('/api/settings'),
  sources: () => request('/api/sources'),
  automation: () => request('/api/automation/status'),
  saveSettings: data => request('/api/settings', jsonOptions('PUT', data)),
  updateSource: (id, data) => request(`/api/sources/${encodeURIComponent(id)}`, jsonOptions('PATCH', data)),
  addSource: data => request('/api/sources', jsonOptions('POST', data)),
  removeSource: id => request(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  bulk: data => request('/api/skills/bulk', jsonOptions('POST', data)),
  saveSkill: (id, raw) => request(`/api/skills/${encodeURIComponent(id)}`, jsonOptions('PUT', { raw })),
  classify: ids => request('/api/ai/classify', jsonOptions('POST', { ids })),
  testAI: data => request('/api/ai/test', jsonOptions('POST', data)),
  runMaintenance: classify => request('/api/automation/run', jsonOptions('POST', { classify })),
  discover: params => request(`/api/discovery/github?${new URLSearchParams(params)}`),
  importSkill: file => upload('/api/skills/import', file),
  importDatabase: file => upload('/api/database/import', file)
};

function jsonOptions(method, data) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function upload(path, file) {
  const form = new FormData();
  form.append('file', file);
  return request(path, { method: 'POST', body: form });
}

function formatDate(value) {
  if (!value) return '尚未运行';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function extractError(error) {
  return error instanceof Error ? error.message : String(error);
}

const NAV = [
  ['dashboard', '总览', '01'],
  ['library', 'Skills 库', '02'],
  ['discover', '发现', '03'],
  ['automation', '自动维护', '04'],
  ['settings', '设置', '05']
];

const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', agents: 'Agents', openclaw: 'OpenClaw', gemini: 'Gemini', cursor: 'Cursor', custom: '自定义' };

function App() {
  const [page, setPage] = useState('dashboard');
  const [skills, setSkills] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [settings, setSettings] = useState(null);
  const [sources, setSources] = useState([]);
  const [automation, setAutomation] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  async function refresh() {
    const [skillData, dashData, settingData, sourceData, automationData] = await Promise.all([
      api.skills(), api.dashboard(), api.settings(), api.sources(), api.automation()
    ]);
    setSkills(skillData);
    setDashboard(dashData);
    setSettings(settingData);
    setSources(sourceData.sources || []);
    setAutomation(automationData);
  }

  useEffect(() => { refresh().catch(error => setToast(extractError(error))); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3400);
    return () => clearTimeout(timer);
  }, [toast]);

  function navigate(target) {
    setPage(target);
    setSelected(new Set());
  }

  async function run(task, success) {
    setBusy(true);
    try {
      await task();
      if (success) setToast(success);
      await refresh();
    } catch (error) { setToast(extractError(error)); }
    finally { setBusy(false); }
  }

  return html`
    <div class="app-shell">
      <aside class="sidebar">
        <button class="brand" onClick=${() => navigate('dashboard')} aria-label="返回总览">
          <span class="brand-mark">S</span>
          <span><strong>SkillPilot</strong><small>LOCAL OPS</small></span>
        </button>
        <nav class="main-nav" aria-label="主导航">
          ${NAV.map(([id, label, index]) => html`
            <button class=${page === id ? 'nav-item active' : 'nav-item'} onClick=${() => navigate(id)} key=${id}>
              <span class="nav-index">${index}</span><span>${label}</span>
              ${id === 'library' && html`<span class="nav-count">${skills.length}</span>`}
            </button>
          `)}
        </nav>
        <div class="sidebar-status">
          <span class=${automation?.settings?.enabled ? 'status-light online' : 'status-light'}></span>
          <div><strong>${automation?.settings?.enabled ? '自动维护已启用' : '本地模式'}</strong><small>数据仅保存在此设备</small></div>
        </div>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div class="mobile-brand"><span class="brand-mark">S</span><strong>SkillPilot</strong></div>
          <label class="global-search">
            <span aria-hidden="true">⌕</span>
            <input value=${globalSearch} onInput=${event => setGlobalSearch(event.target.value)} onFocus=${() => page !== 'library' && navigate('library')} placeholder="搜索名称、分类、标签或来源" aria-label="全局搜索" />
            <kbd>⌘ K</kbd>
          </label>
          <div class="top-actions">
            <button class="icon-button" onClick=${() => refresh().then(() => setToast('索引已刷新'))} aria-label="刷新索引">↻</button>
            <button class="primary-button compact" onClick=${() => document.getElementById('skill-import').click()}>导入 Skill</button>
            <input id="skill-import" class="visually-hidden" type="file" accept=".zip" onChange=${event => event.target.files[0] && run(() => api.importSkill(event.target.files[0]), 'Skill 导入成功')} />
          </div>
        </header>

        <div class="page-stage">
          ${!dashboard ? html`<${LoadingState} />` : page === 'dashboard' ? html`<${Dashboard} data=${dashboard} automation=${automation} onNavigate=${navigate} onRun=${() => run(() => api.runMaintenance(false), '维护任务已完成')} busy=${busy} />` : ''}
          ${page === 'library' ? html`<${Library} skills=${skills} search=${globalSearch} selected=${selected} setSelected=${setSelected} onOpen=${async skill => { try { setDetail(await api.detail(skill.id)); } catch (error) { setToast(extractError(error)); } }} onBulk=${(action, category) => run(() => api.bulk({ ids: [...selected], action, category }), '批量操作已完成').then(() => setSelected(new Set()))} onExport=${() => exportSelected([...selected], setToast)} onClassify=${() => run(() => api.classify([...selected]), 'AI 分类已完成')} busy=${busy} />` : ''}
          ${page === 'discover' ? html`<${Discover} onToast=${setToast} />` : ''}
          ${page === 'automation' ? html`<${Automation} status=${automation} settings=${settings} busy=${busy} onSave=${patch => run(() => api.saveSettings({ automation: patch }), '自动维护设置已保存')} onRun=${classify => run(() => api.runMaintenance(classify), '维护任务已完成')} />` : ''}
          ${page === 'settings' ? html`<${Settings} settings=${settings} sources=${sources} busy=${busy} onSave=${patch => run(() => api.saveSettings(patch), '设置已保存')} onTest=${data => run(() => api.testAI(data), 'AI 连接正常')} onSourceToggle=${(id, enabled) => run(() => api.updateSource(id, { enabled }), '来源设置已更新')} onAddSource=${data => run(() => api.addSource(data), '自定义来源已添加')} onRemoveSource=${id => run(() => api.removeSource(id), '来源已移除')} onImportDb=${file => run(() => api.importDatabase(file), '数据库已恢复')} />` : ''}
        </div>
      </main>

      ${detail && html`<${SkillDrawer} detail=${detail} busy=${busy} onClose=${() => setDetail(null)} onSave=${raw => run(() => api.saveSkill(detail.id, raw), 'Skill 已保存').then(() => setDetail(null))} />`}
      ${toast && html`<div class="toast" role="status">${toast}</div>`}
    </div>
  `;
}

function LoadingState() {
  return html`<div class="loading-state" aria-busy="true"><span></span><span></span><span></span><p>正在建立本地 Skills 索引…</p></div>`;
}

function PageHeading({ eyebrow, title, description, actions }) {
  return html`<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="page-description">${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function Dashboard({ data, automation, onNavigate, onRun, busy }) {
  const categoryEntries = Object.entries(data.categories || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return html`
    <section class="page dashboard-page">
      <${PageHeading} eyebrow="LOCAL SKILL OPERATIONS" title="你的 Agent 能力，一目了然" description="统一管理每一个 Skill 的来源、状态与上下文成本。" actions=${html`<button class="secondary-button" onClick=${onRun} disabled=${busy}>${busy ? '运行中…' : '立即维护'}</button><button class="primary-button" onClick=${() => onNavigate('discover')}>发现新 Skills</button>`} />
      <div class="metric-grid">
        <article class="metric primary-metric"><span>已索引 Skills</span><strong>${data.total}</strong><small>来自 ${data.sources?.filter(source => source.exists).length || 0} 个本地来源</small></article>
        <article class="metric"><span>已启用</span><strong>${data.enabled}</strong><small>${data.total ? Math.round(data.enabled / data.total * 100) : 0}% 正在参与 Agent 上下文</small></article>
        <article class="metric"><span>已停用</span><strong>${data.disabled}</strong><small>已移出 Agent 扫描目录</small></article>
        <article class="metric"><span>待更新</span><strong>${data.updates || 0}</strong><small>${automation?.lastScheduledRun ? `上次检查 ${formatDate(automation.lastScheduledRun)}` : '尚未执行远程检查'}</small></article>
      </div>
      <div class="dashboard-columns">
        <article class="panel category-panel">
          <div class="panel-header"><div><span class="section-kicker">分类分布</span><h2>能力地图</h2></div><button class="text-button" onClick=${() => onNavigate('library')}>查看全部</button></div>
          <div class="category-list">${categoryEntries.length ? categoryEntries.map(([name, count], index) => html`<button key=${name} onClick=${() => onNavigate('library')}><span class="category-rank">0${index + 1}</span><span class="category-name">${name}</span><strong>${count}</strong></button>`) : html`<div class="empty-inline">运行 AI 分类后，这里会形成你的能力地图。</div>`}</div>
        </article>
        <article class="panel activity-panel">
          <div class="panel-header"><div><span class="section-kicker">最近变化</span><h2>本地动态</h2></div></div>
          <div class="activity-list">${data.recentlyModified?.map(skill => html`<button key=${skill.id} onClick=${() => onNavigate('library')}><span class="agent-monogram">${(skill.agent || 'S').slice(0, 1).toUpperCase()}</span><span><strong>${skill.name}</strong><small>${AGENT_LABELS[skill.agent] || skill.sourceName} · ${skill.category}</small></span><time>${formatDate(skill.modified)}</time></button>`)}</div>
        </article>
      </div>
      <article class="source-strip"><div><span class="section-kicker">连接状态</span><h2>Agent 来源</h2></div><div class="source-chips">${data.sources?.map(source => html`<span class=${source.exists && source.enabled ? 'source-chip connected' : 'source-chip'} key=${source.id}><i></i>${source.name}<b>${source.exists ? '已发现' : '未安装'}</b></span>`)}</div></article>
    </section>
  `;
}

function Library({ skills, search, selected, setSelected, onOpen, onBulk, onExport, onClassify, busy }) {
  const [agent, setAgent] = useState('all');
  const [state, setState] = useState('all');
  const [category, setCategory] = useState('all');
  const [view, setView] = useState('table');
  const categories = [...new Set(skills.map(skill => skill.category).filter(Boolean))].sort();
  const filtered = useMemo(() => skills.filter(skill => {
    const haystack = `${skill.name} ${skill.description} ${skill.category} ${(skill.tags || []).join(' ')} ${skill.sourceName}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (agent === 'all' || skill.agent === agent) && (state === 'all' || (state === 'enabled') === skill.isEnabled) && (category === 'all' || skill.category === category);
  }), [skills, search, agent, state, category]);
  const allSelected = filtered.length > 0 && filtered.every(skill => selected.has(skill.id));
  function toggle(id) { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); setSelected(next); }
  function toggleAll() { const next = new Set(selected); filtered.forEach(skill => allSelected ? next.delete(skill.id) : next.add(skill.id)); setSelected(next); }
  return html`
    <section class="page library-page">
      <${PageHeading} eyebrow="UNIFIED INVENTORY" title="Skills 库" description="跨 Agent 检索、分组与控制本地上下文。" actions=${html`<div class="view-toggle"><button class=${view === 'table' ? 'active' : ''} onClick=${() => setView('table')}>列表</button><button class=${view === 'grid' ? 'active' : ''} onClick=${() => setView('grid')}>卡片</button></div>`} />
      <div class="filter-row">
        <select value=${agent} onChange=${event => setAgent(event.target.value)} aria-label="Agent 来源"><option value="all">全部 Agent</option>${Object.entries(AGENT_LABELS).map(([id, label]) => html`<option value=${id}>${label}</option>`)}</select>
        <select value=${category} onChange=${event => setCategory(event.target.value)} aria-label="分类"><option value="all">全部分类</option>${categories.map(item => html`<option value=${item}>${item}</option>`)}</select>
        <select value=${state} onChange=${event => setState(event.target.value)} aria-label="启用状态"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>
        <span class="result-count">显示 ${filtered.length} / ${skills.length}</span>
      </div>
      ${selected.size > 0 && html`<div class="bulk-bar" role="toolbar"><strong>已选 ${selected.size} 项</strong><button onClick=${() => onBulk('enable')} disabled=${busy}>启用</button><button onClick=${() => onBulk('disable')} disabled=${busy}>停用</button><button onClick=${() => { const categoryName = prompt('输入分类名称'); if (categoryName) onBulk('categorize', categoryName); }}>分类</button><button onClick=${onClassify} disabled=${busy}>AI 分类</button><button onClick=${onExport}>导出</button><button class="danger-text" onClick=${() => confirm(`确定永久删除 ${selected.size} 个 Skills？`) && onBulk('delete')} disabled=${busy}>删除</button><button class="bulk-close" onClick=${() => setSelected(new Set())}>取消选择</button></div>`}
      ${filtered.length === 0 ? html`<${EmptyState} title="没有匹配的 Skills" text="调整筛选条件，或导入一个新的 Skill 包。" />` : view === 'table' ? html`
        <div class="skills-table-wrap"><table class="skills-table"><thead><tr><th><input type="checkbox" checked=${allSelected} onChange=${toggleAll} aria-label="选择全部" /></th><th>Skill</th><th>Agent / 来源</th><th>分类</th><th>状态</th><th>修改时间</th><th></th></tr></thead><tbody>${filtered.map(skill => html`<tr key=${skill.id} class=${selected.has(skill.id) ? 'selected' : ''}><td><input type="checkbox" checked=${selected.has(skill.id)} onChange=${() => toggle(skill.id)} aria-label=${`选择 ${skill.name}`} /></td><td><button class="skill-name-button" onClick=${() => onOpen(skill)}><span class="skill-avatar">${skill.name.slice(0, 1).toUpperCase()}</span><span><strong>${skill.name}</strong><small>${skill.description || '暂无描述'}</small></span></button></td><td><span class="agent-label">${AGENT_LABELS[skill.agent] || skill.agent}</span><small class="source-sub">${skill.sourceName}</small></td><td><span class="category-badge">${skill.category}</span></td><td><span class=${skill.isEnabled ? 'state enabled' : 'state disabled'}><i></i>${skill.isEnabled ? '启用' : '停用'}</span></td><td><time>${formatDate(skill.modified)}</time></td><td><button class="row-action" onClick=${() => onOpen(skill)} aria-label=${`查看 ${skill.name}`}>→</button></td></tr>`)}</tbody></table></div>
      ` : html`<div class="skills-grid">${filtered.map(skill => html`<article class=${selected.has(skill.id) ? 'skill-card selected' : 'skill-card'} key=${skill.id}><div class="card-select"><input type="checkbox" checked=${selected.has(skill.id)} onChange=${() => toggle(skill.id)} /></div><button onClick=${() => onOpen(skill)}><span class="skill-avatar large">${skill.name.slice(0, 1).toUpperCase()}</span><h3>${skill.name}</h3><p>${skill.description || '暂无描述'}</p><div><span class="category-badge">${skill.category}</span><span class=${skill.isEnabled ? 'state enabled' : 'state disabled'}><i></i>${skill.isEnabled ? '启用' : '停用'}</span></div><small>${AGENT_LABELS[skill.agent] || skill.agent} · ${skill.fileCount} files</small></button></article>`)}</div>`}
    </section>
  `;
}

function Discover({ onToast }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('popular');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  async function search() {
    setLoading(true);
    try { setData(await api.discover({ search: query, category, sort, page: 1 })); }
    catch (error) { onToast(extractError(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { search(); }, [sort]);
  return html`<section class="page discover-page"><${PageHeading} eyebrow="GITHUB DISCOVERY" title="发现优质 Skills" description="从 GitHub 热门与近期活跃项目中寻找新的 Agent 能力。" />
    <form class="discovery-search" onSubmit=${event => { event.preventDefault(); search(); }}><label><span>⌕</span><input value=${query} onInput=${event => setQuery(event.target.value)} placeholder="例如：医学研究、数据分析、前端设计" aria-label="搜索 GitHub Skills" /></label><select value=${category} onChange=${event => setCategory(event.target.value)}><option value="">全部领域</option><option value="development">开发</option><option value="science">科研</option><option value="data">数据</option><option value="design">设计</option><option value="productivity">效率</option><option value="security">安全</option><option value="writing">写作</option></select><button class="primary-button">搜索</button></form>
    <div class="discover-toolbar"><div class="segmented"><button class=${sort === 'popular' ? 'active' : ''} onClick=${() => setSort('popular')}>热门优先</button><button class=${sort === 'latest' ? 'active' : ''} onClick=${() => setSort('latest')}>最近更新</button></div><span>${data ? `约 ${data.total} 个相关仓库` : ''}</span></div>
    ${loading ? html`<${LoadingState} />` : data?.items?.length ? html`<div class="repo-grid">${data.items.map(repo => html`<article class="repo-card" key=${repo.id}><div class="repo-owner"><img src=${repo.avatarUrl} alt="" /><span>${repo.owner}</span><span class="repo-license">${repo.license || 'NO LICENSE'}</span></div><h2>${repo.name.split('/')[1]}</h2><p>${repo.description || '该仓库没有提供描述。'}</p><div class="repo-topics">${repo.topics.slice(0, 4).map(topic => html`<span>${topic}</span>`)}</div><div class="repo-footer"><span>★ ${repo.stars.toLocaleString()}</span><span>⑂ ${repo.forks.toLocaleString()}</span><time>${formatDate(repo.updatedAt)}</time><a href=${repo.url} target="_blank" rel="noopener noreferrer">在 GitHub 查看 ↗</a></div></article>`)}</div>` : html`<${EmptyState} title="未找到匹配项目" text="尝试更宽泛的关键词，或切换到热门排序。" />`}
  </section>`;
}

function Automation({ status, settings, busy, onSave, onRun }) {
  const [form, setForm] = useState(settings?.automation || {});
  useEffect(() => setForm(settings?.automation || {}), [settings]);
  if (!status || !settings) return html`<${LoadingState} />`;
  const update = patch => setForm(current => ({ ...current, ...patch }));
  return html`<section class="page automation-page"><${PageHeading} eyebrow="AUTOMATED MAINTENANCE" title="让 Skills 库保持清洁、准确、最新" description="按周期检查远程更新，并可使用自定义 AI 自动补齐分类与标签。" actions=${html`<button class="secondary-button" onClick=${() => onRun(Boolean(form.classification))} disabled=${busy}>${busy ? '运行中…' : '立即运行一次'}</button><button class="primary-button" onClick=${() => onSave(form)}>保存设置</button>`} />
    <div class="automation-layout"><article class="panel automation-control"><div class="toggle-line"><div><span class="section-kicker">主开关</span><h2>定期自动维护</h2><p>SkillPilot 运行期间按计划执行，不上传本地数据库。</p></div><label class="switch"><input type="checkbox" checked=${Boolean(form.enabled)} onChange=${event => update({ enabled: event.target.checked })} /><span></span></label></div><div class="form-grid"><label>运行间隔<select value=${form.intervalHours || 24} onChange=${event => update({ intervalHours: Number(event.target.value) })}><option value="6">每 6 小时</option><option value="12">每 12 小时</option><option value="24">每天</option><option value="168">每周</option></select></label><div class="option-stack"><label><input type="checkbox" checked=${Boolean(form.updateChecks)} onChange=${event => update({ updateChecks: event.target.checked })} /><span><strong>检查来源更新</strong><small>比较已安装插件的远程提交</small></span></label><label><input type="checkbox" checked=${Boolean(form.autoUpdate)} onChange=${event => update({ autoUpdate: event.target.checked })} /><span><strong>自动应用更新</strong><small>仅更新可追踪的 Git 来源</small></span></label><label><input type="checkbox" checked=${Boolean(form.classification)} onChange=${event => update({ classification: event.target.checked })} /><span><strong>AI 自动分类</strong><small>${settings.ai.enabled ? `使用 ${settings.ai.model}` : '请先在设置中启用 AI'}</small></span></label></div></div></article>
      <article class="panel run-status"><span class=${status.isRunning ? 'run-orb active' : 'run-orb'}></span><span class="section-kicker">运行状态</span><h2>${status.isRunning ? '维护任务执行中' : '系统空闲'}</h2><p>上次计划运行：${formatDate(status.lastScheduledRun)}</p><dl><div><dt>待更新</dt><dd>${status.updates?.total || 0}</dd></div><div><dt>历史记录</dt><dd>${status.history?.length || 0}</dd></div></dl></article></div>
    <article class="panel history-panel"><div class="panel-header"><div><span class="section-kicker">审计记录</span><h2>最近任务</h2></div></div>${status.history?.length ? html`<div class="history-list">${status.history.map(item => html`<div key=${item.id}><span class=${`history-status ${item.status}`}></span><span><strong>${item.message}</strong><small>${item.type}</small></span><time>${formatDate(item.at)}</time></div>`)}</div>` : html`<${EmptyState} title="还没有维护记录" text="运行一次维护任务后，结果会保存在这里。" />`}</article>
  </section>`;
}

function Settings({ settings, sources, busy, onSave, onTest, onSourceToggle, onAddSource, onRemoveSource, onImportDb }) {
  const [ai, setAI] = useState(settings?.ai || {});
  const [github, setGithub] = useState(settings?.github || {});
  const [newSource, setNewSource] = useState({ name: '', path: '' });
  useEffect(() => { setAI(settings?.ai || {}); setGithub(settings?.github || {}); }, [settings]);
  if (!settings) return html`<${LoadingState} />`;
  return html`<section class="page settings-page"><${PageHeading} eyebrow="CONFIGURATION" title="设置" description="配置模型、来源与可移植数据。所有敏感信息只保存在本机。" actions=${html`<button class="primary-button" onClick=${() => onSave({ ai, github })} disabled=${busy}>保存全部设置</button>`} />
    <div class="settings-grid"><article class="panel settings-card wide"><div class="settings-card-title"><span class="settings-index">AI</span><div><h2>自定义 AI 服务</h2><p>兼容 OpenAI Chat Completions API 与本地 Ollama。</p></div><label class="switch"><input type="checkbox" checked=${Boolean(ai.enabled)} onChange=${event => setAI({ ...ai, enabled: event.target.checked })} /><span></span></label></div><div class="form-grid three"><label>API Base URL<input value=${ai.baseUrl || ''} onInput=${event => setAI({ ...ai, baseUrl: event.target.value })} placeholder="http://localhost:11434/v1" /></label><label>模型<input value=${ai.model || ''} onInput=${event => setAI({ ...ai, model: event.target.value })} placeholder="qwen3:8b" /></label><label>API Key<input type="password" value=${ai.apiKey || ''} onInput=${event => setAI({ ...ai, apiKey: event.target.value })} placeholder=${ai.hasApiKey ? '已保存，留空则保持不变' : '本地 Ollama 可留空'} /></label></div><button class="secondary-button compact" onClick=${() => onTest(ai)} disabled=${busy || !ai.baseUrl || !ai.model}>测试连接</button></article>
      <article class="panel settings-card"><div class="settings-card-title"><span class="settings-index">GH</span><div><h2>GitHub 发现</h2><p>Token 可提高 API 速率限制。</p></div></div><label>Personal Access Token<input type="password" value=${github.token || ''} onInput=${event => setGithub({ ...github, token: event.target.value })} placeholder=${github.hasToken ? '已安全保存' : '可选'} /></label></article>
      <article class="panel settings-card"><div class="settings-card-title"><span class="settings-index">DB</span><div><h2>数据迁移</h2><p>导出分类、设置与历史，不包含密钥。</p></div></div><div class="button-stack"><a class="secondary-button" href="/api/database/export">导出数据库</a><button class="secondary-button" onClick=${() => document.getElementById('db-import').click()}>恢复数据库</button><input id="db-import" class="visually-hidden" type="file" accept=".json" onChange=${event => event.target.files[0] && onImportDb(event.target.files[0])} /></div></article>
    </div>
    <article class="panel sources-settings"><div class="panel-header"><div><span class="section-kicker">扫描路径</span><h2>Agent 来源</h2></div></div><div class="source-table">${sources.map(source => html`<div key=${source.id}><span class="agent-monogram">${source.name.slice(0, 1)}</span><span><strong>${source.name}</strong><small>${source.path}</small></span><span class=${source.exists ? 'path-state found' : 'path-state'}>${source.exists ? '已发现' : '路径不存在'}</span><label class="switch small"><input type="checkbox" checked=${source.enabled} onChange=${event => onSourceToggle(source.id, event.target.checked)} /><span></span></label>${!source.builtIn ? html`<button class="text-button danger-text" onClick=${() => confirm('仅移除来源配置，不删除文件。继续？') && onRemoveSource(source.id)}>移除</button>` : html`<span></span>`}</div>`)}</div><form class="add-source" onSubmit=${event => { event.preventDefault(); onAddSource(newSource); setNewSource({ name: '', path: '' }); }}><input value=${newSource.name} onInput=${event => setNewSource({ ...newSource, name: event.target.value })} placeholder="来源名称" aria-label="来源名称" /><input value=${newSource.path} onInput=${event => setNewSource({ ...newSource, path: event.target.value })} placeholder="绝对路径，例如 D:\\skills" aria-label="来源绝对路径" /><button class="secondary-button">添加自定义路径</button></form></article>
  </section>`;
}

function SkillDrawer({ detail, busy, onClose, onSave }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  function beginEdit() {
    const fm = detail.frontmatter || {};
    const lines = Object.entries(fm).map(([key, value]) => Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value}`);
    setRaw(lines.length ? `---\n${lines.join('\n')}\n---\n${detail.content || ''}` : detail.content || '');
    setEditing(true);
  }
  return html`<div class="drawer-overlay" onClick=${event => event.target === event.currentTarget && onClose()}><aside class="skill-drawer" role="dialog" aria-modal="true" aria-labelledby="skill-title"><header><div><span class="section-kicker">${detail.sourceName || detail.source}</span><h2 id="skill-title">${detail.name}</h2></div><button class="icon-button" onClick=${onClose} aria-label="关闭">×</button></header><p class="drawer-description">${detail.description || '暂无描述'}</p><div class="drawer-badges"><span class="category-badge">${detail.category}</span><span class=${detail.isEnabled ? 'state enabled' : 'state disabled'}><i></i>${detail.isEnabled ? '启用' : '停用'}</span>${detail.risk !== 'unknown' && html`<span class=${`risk ${detail.risk}`}>风险 ${detail.risk}</span>`}</div><dl class="drawer-meta"><div><dt>Agent</dt><dd>${AGENT_LABELS[detail.agent] || detail.agent}</dd></div><div><dt>文件</dt><dd>${detail.fileCount}</dd></div><div><dt>版本</dt><dd>${detail.version || '未标注'}</dd></div><div><dt>最近修改</dt><dd>${formatDate(detail.modified)}</dd></div></dl><section><h3>本地路径</h3><code>${detail.path}</code></section><section class="content-section"><h3>${editing ? '编辑 SKILL.md' : '内容预览'}</h3>${editing ? html`<textarea value=${raw} onInput=${event => setRaw(event.target.value)} aria-label="SKILL.md 内容"></textarea>` : html`<pre>${(detail.content || '没有可预览的内容').trim()}</pre>`}</section><footer>${editing ? html`<button class="primary-button" onClick=${() => onSave(raw)} disabled=${busy}>保存修改</button><button class="secondary-button" onClick=${() => setEditing(false)}>取消</button>` : detail.source === 'local' && detail.isEnabled ? html`<button class="primary-button" onClick=${beginEdit}>编辑文件</button>` : ''}<button class="secondary-button drawer-close" onClick=${onClose}>关闭</button></footer></aside></div>`;
}

function EmptyState({ title, text }) {
  return html`<div class="empty-state"><span>∅</span><h2>${title}</h2><p>${text}</p></div>`;
}

async function exportSelected(ids, setToast) {
  try {
    const response = await fetch('/api/skills/bulk/export', jsonOptions('POST', { ids }));
    if (!response.ok) throw new Error('导出失败');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = 'skillpilot-skills.zip'; link.click();
    URL.revokeObjectURL(url);
    setToast('导出已完成');
  } catch (error) { setToast(extractError(error)); }
}

render(html`<${App} />`, document.getElementById('app'));
