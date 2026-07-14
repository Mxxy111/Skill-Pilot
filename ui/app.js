import { h, render } from './vendor/preact.mjs';
import { useEffect, useMemo, useRef, useState } from './vendor/preact-hooks.mjs';
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
  cancelMaintenance: id => request('/api/automation/run/cancel', jsonOptions('POST', { id })),
  discover: params => request(`/api/discovery/catalog?${new URLSearchParams(params)}`),
  inspectRepository: repository => request('/api/discovery/inspections', jsonOptions('POST', { repository, useAI: true })),
  recommendRepositories: (query, repositories) => request('/api/discovery/recommendations', jsonOptions('POST', { query, repositories })),
  installTargets: () => request('/api/skill-installations/targets'),
  installSkills: data => request('/api/skill-installations', jsonOptions('POST', data)),
  checkAppUpdate: force => request(`/api/app-updates/status${force ? '?force=1' : ''}`),
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

function formatCompactNumber(value) {
  const number = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function extractError(error) {
  return error instanceof Error ? error.message : String(error);
}

function maintenanceMessage(result) {
  if (!result) return '维护任务未完成';
  const parts = [];
  if (result.updates) parts.push(`检查 ${result.updates.checked}/${result.updates.eligible || 0} 个可追踪来源`);
  if (result.appliedUpdates?.length) parts.push(`更新 ${result.appliedUpdates.filter(item => item.ok).length} 项`);
  if (result.classification) parts.push(result.classification.total
    ? `分类 ${result.classification.succeeded} 项，剩余 ${result.classification.remaining}`
    : `分类无需更新，保留 ${result.classification.skippedStable || 0} 项`);
  if (result.failures) parts.push(`${result.failures} 个问题待处理`);
  return parts.join(' · ') || '维护完成：当前没有可跟踪任务';
}

const NAV = [
  ['dashboard', '总览', 'dashboard'],
  ['library', 'Skills 库', 'library'],
  ['discover', '发现', 'discover'],
  ['automation', '自动维护', 'automation'],
  ['settings', '设置', 'settings']
];

const ICON_PATHS = {
  dashboard: ['M4 4h6v6H4z', 'M14 4h6v4h-6z', 'M14 12h6v8h-6z', 'M4 14h6v6H4z'],
  library: ['M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 1 5 17z', 'M5 17a2 2 0 0 1 2-2h12'],
  discover: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15 9-2 4-4 2 2-4z'],
  automation: ['M20 12a8 8 0 0 1-13.7 5.6L4 20v-6h6l-2.2 2.2A6 6 0 0 0 18 12', 'M4 12A8 8 0 0 1 17.7 6.4L20 4v6h-6l2.2-2.2A6 6 0 0 0 6 12'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-1.9.3l-.8.5a1.7 1.7 0 0 0-.9 1.6v.2h-4v-.2a1.7 1.7 0 0 0-.9-1.6l-.8-.5a1.7 1.7 0 0 0-1.9-.3l-.2.1-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.9l-.4-.9a1.7 1.7 0 0 0-1.4-1.1h-.2V9h.2a1.7 1.7 0 0 0 1.4-1.1l.4-.9a1.7 1.7 0 0 0-.3-1.9L4.2 5l2-3.4.2.1a1.7 1.7 0 0 0 1.9-.3l.8-.5A1.7 1.7 0 0 0 10 .1V0h4v.2a1.7 1.7 0 0 0 .9 1.6l.8.5a1.7 1.7 0 0 0 1.9.3l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9l.4.9A1.7 1.7 0 0 0 21.2 9h.2v4h-.2a1.7 1.7 0 0 0-1.4 1.1z'],
  search: ['m21 21-4.35-4.35', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  plus: ['M12 5v14', 'M5 12h14']
};

function Icon({ name, size = 18 }) {
  return html`<svg class="ui-icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICON_PATHS[name] || []).map(path => html`<path d=${path}></path>`)}</svg>`;
}

const AGENT_LABELS = { claude: 'Claude', codex: 'Codex', agents: 'Agents', openclaw: 'OpenClaw', gemini: 'Gemini', cursor: 'Cursor', custom: '自定义' };

const DISCOVERY_VIEWS = [
  ['popular', '全网热门', '累计安装量最高'],
  ['trending', '本周趋势', '近期增长最快'],
  ['hot', '正在升温', '此刻增速明显']
];

const DISCOVERY_TOPICS = [
  ['featured', '精选起点'], ['development', '开发与工程'], ['research', '科研与论文'],
  ['data', '数据与图表'], ['design', '设计与创意'], ['documents', '文档与演示'],
  ['automation', '自动化与效率'], ['testing', '测试与质量'], ['devops', '部署与运维'],
  ['security', '安全与审计'], ['marketing', '内容与增长']
];

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
  const [appUpdate, setAppUpdate] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const reportedRun = useRef(null);

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

  async function checkAppUpdate(force = false) {
    setCheckingUpdate(true);
    try {
      const result = await api.checkAppUpdate(force);
      setAppUpdate(result);
      if (force) setToast(result.updateAvailable
        ? `发现新版本 ${result.latestVersion}`
        : result.status === 'unpublished' ? '仓库尚未发布正式 Release' : '当前已是最新版本');
      return result;
    } catch (error) {
      setAppUpdate(current => ({ ...(current || {}), status: 'error', message: extractError(error) }));
      if (force) setToast(extractError(error));
    } finally { setCheckingUpdate(false); }
  }

  useEffect(() => {
    refresh().catch(error => setToast(extractError(error)));
    checkAppUpdate(false);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3400);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const activeRun = automation?.run;
    if (!activeRun || !['running', 'cancelling'].includes(activeRun.status)) return;
    const timer = setInterval(async () => {
      try {
        const status = await api.automation();
        setAutomation(status);
        const runState = status.run;
        if (runState && !['running', 'cancelling'].includes(runState.status) && reportedRun.current !== runState.id) {
          reportedRun.current = runState.id;
          setToast(runState.status === 'cancelled' ? '维护任务已停止' : runState.error || maintenanceMessage(runState.result));
          await refresh();
        }
      } catch (error) { setToast(extractError(error)); }
    }, 700);
    return () => clearInterval(timer);
  }, [automation?.run?.id, automation?.run?.status]);

  function navigate(target) {
    setPage(target);
    setSelected(new Set());
  }

  async function run(task, success) {
    setBusy(true);
    try {
      const result = await task();
      await refresh();
      if (success) setToast(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (error) { setToast(extractError(error)); }
    finally { setBusy(false); }
  }

  async function startMaintenance(classify) {
    try {
      const response = await api.runMaintenance(classify);
      reportedRun.current = null;
      setAutomation(current => ({ ...(current || {}), run: response.run, isRunning: true }));
      setToast('维护任务已转入后台运行，界面可以继续操作');
      return response.run;
    } catch (error) { setToast(extractError(error)); }
  }

  async function cancelMaintenance() {
    try {
      const response = await api.cancelMaintenance(automation?.run?.id);
      setAutomation(current => ({ ...(current || {}), run: response.run }));
    } catch (error) { setToast(extractError(error)); }
  }

  return html`
    <div class="app-shell">
      <aside class="sidebar">
        <button class="brand" onClick=${() => navigate('dashboard')} aria-label="返回总览">
          <span class="brand-mark">S</span>
          <span><strong>SkillPilot</strong><small>LOCAL OPS</small></span>
        </button>
        <nav class="main-nav" aria-label="主导航">
          ${NAV.map(([id, label, icon]) => html`
            <button class=${page === id ? 'nav-item active' : 'nav-item'} onClick=${() => navigate(id)} key=${id}>
              <span class="nav-icon"><${Icon} name=${icon} /></span><span>${label}</span>
              ${id === 'library' && html`<span class="nav-count">${skills.length}</span>`}
            </button>
          `)}
        </nav>
        <div class="sidebar-status">
          <span class=${automation?.settings?.enabled ? 'status-light online' : 'status-light'}></span>
          <div><strong>${['running', 'cancelling'].includes(automation?.run?.status) ? '维护任务运行中' : automation?.settings?.enabled ? '自动维护已启用' : '本地模式'}</strong><small>${automation?.run?.status === 'running' ? automation.run.message : '数据仅保存在此设备'}</small></div>
        </div>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div class="mobile-brand"><span class="brand-mark">S</span><strong>SkillPilot</strong></div>
          <label class="global-search">
            <${Icon} name="search" size=${16} />
            <input value=${globalSearch} onInput=${event => setGlobalSearch(event.target.value)} onFocus=${() => page !== 'library' && navigate('library')} placeholder="搜索名称、分类、标签或来源" aria-label="全局搜索" />
            <kbd>⌘ K</kbd>
          </label>
          <div class="top-actions">
            ${appUpdate?.updateAvailable && html`<button class="update-chip" onClick=${() => navigate('settings')}>↑ v${appUpdate.latestVersion}</button>`}
            <button class="icon-button" onClick=${() => refresh().then(() => setToast('索引已刷新'))} aria-label="刷新索引"><${Icon} name="refresh" /></button>
            <button class="primary-button compact" onClick=${() => document.getElementById('skill-import').click()}><${Icon} name="plus" size=${15} />导入 Skill</button>
            <input id="skill-import" class="visually-hidden" type="file" accept=".zip" onChange=${event => event.target.files[0] && run(() => api.importSkill(event.target.files[0]), 'Skill 导入成功')} />
          </div>
        </header>

        <div class="page-stage">
          ${!dashboard ? html`<${LoadingState} />` : page === 'dashboard' ? html`<${Dashboard} data=${dashboard} automation=${automation} onNavigate=${navigate} onRun=${() => startMaintenance(false)} busy=${busy || ['running', 'cancelling'].includes(automation?.run?.status)} />` : ''}
          ${page === 'library' ? html`<${Library} skills=${skills} search=${globalSearch} selected=${selected} setSelected=${setSelected} onOpen=${async skill => { try { setDetail(await api.detail(skill.id)); } catch (error) { setToast(extractError(error)); } }} onBulk=${(action, category) => run(() => api.bulk({ ids: [...selected], action, category }), '批量操作已完成').then(() => setSelected(new Set()))} onExport=${() => exportSelected([...selected], setToast)} onClassify=${() => run(() => api.classify([...selected]), 'AI 分类已完成')} busy=${busy} />` : ''}
          ${page === 'discover' ? html`<${Discover} settings=${settings} busy=${busy} onToast=${setToast} onInstall=${payload => run(() => api.installSkills(payload), result => `已安装 ${result.installed.length} 个 Skills 到 ${result.target.name}`)} />` : ''}
          ${page === 'automation' ? html`<${Automation} status=${automation} settings=${settings} busy=${busy} onSave=${patch => run(() => api.saveSettings({ automation: patch }), '自动维护设置已保存')} onRun=${startMaintenance} onCancel=${cancelMaintenance} />` : ''}
          ${page === 'settings' ? html`<${Settings} settings=${settings} sources=${sources} appUpdate=${appUpdate} checkingUpdate=${checkingUpdate} busy=${busy} onCheckUpdate=${() => checkAppUpdate(true)} onSave=${patch => run(() => api.saveSettings(patch), '设置已保存')} onTest=${data => run(() => api.testAI(data), 'AI 连接正常')} onSourceToggle=${(id, enabled) => run(() => api.updateSource(id, { enabled }), '来源设置已更新')} onAddSource=${data => run(() => api.addSource(data), '自定义来源已添加')} onRemoveSource=${id => run(() => api.removeSource(id), '来源已移除')} onImportDb=${file => run(() => api.importDatabase(file), '数据库已恢复')} />` : ''}
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

function PageHeading({ title, description, actions }) {
  return html`<header class="page-heading"><div><h1>${title}</h1><p class="page-description">${description}</p></div><div class="heading-actions">${actions}</div></header>`;
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
        <article class="metric"><span>待更新</span><strong>${data.updates || 0}</strong><small>${automation?.updates?.tracked ? `跟踪 ${automation.updates.eligible}/${automation.updates.tracked} 个来源${automation.lastScheduledRun ? ` · ${formatDate(automation.lastScheduledRun)}` : ''}` : '尚无可跟踪来源；通过“发现”安装后自动登记'}</small></article>
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

function Discover({ settings, busy, onToast, onInstall }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('popular');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inspecting, setInspecting] = useState('');
  const [inspection, setInspection] = useState(null);
  const [targets, setTargets] = useState([]);
  const [targetAgent, setTargetAgent] = useState('codex');
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
  const [recommendations, setRecommendations] = useState(new Map());
  const [recommending, setRecommending] = useState(false);
  async function search(overrides = {}) {
    const requestState = {
      search: overrides.search ?? query,
      category: overrides.category ?? category,
      view: overrides.view ?? view,
      limit: 24
    };
    setLoading(true);
    try {
      setData(await api.discover(requestState));
      setRecommendations(new Map());
    }
    catch (error) { onToast(extractError(error)); }
    finally { setLoading(false); }
  }
  async function inspect(repo) {
    setInspecting(repo.repository);
    try {
      const result = await api.inspectRepository(repo.repository);
      setInspection(result);
      const requestedSkill = String(repo.skillName || '').toLowerCase();
      const exactMatches = result.scan.skills.filter(skill => {
        const pathName = String(skill.path || '').split('/').at(-1)?.toLowerCase();
        return String(skill.name || '').toLowerCase() === requestedSkill || pathName === requestedSkill;
      });
      setSelectedPaths(new Set((exactMatches.length ? exactMatches : result.scan.skills).map(skill => skill.path)));
      setAcknowledgeRisk(false);
      const preferred = result.ai?.assessment?.recommendedAgents?.find(id => targets.some(target => target.id === id));
      setTargetAgent(preferred || targets[0]?.id || 'codex');
    } catch (error) { onToast(extractError(error)); }
    finally { setInspecting(''); }
  }
  async function recommend() {
    if (!data?.items?.length) return;
    setRecommending(true);
    try {
      const candidates = [];
      const repositories = new Set();
      for (const skill of data.items) {
        if (repositories.has(skill.repository)) continue;
        repositories.add(skill.repository);
        candidates.push({
          repository: skill.repository,
          description: `${skill.skillName} · ${skill.installs || skill.stars || 0} 次生态采用`,
          stars: skill.installs || skill.stars || 0,
          topics: category ? [category] : []
        });
        if (candidates.length === 8) break;
      }
      const result = await api.recommendRepositories(query || DISCOVERY_TOPICS.find(item => item[0] === category)?.[1] || '优质、实用的 Agent Skills', candidates);
      setRecommendations(new Map(result.recommendations.map(item => [item.repository.toLowerCase(), item])));
      onToast(`AI 已评估 ${result.recommendations.length} 个候选仓库`);
    } catch (error) { onToast(extractError(error)); }
    finally { setRecommending(false); }
  }
  function toggleSkill(path) {
    setSelectedPaths(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  async function install() {
    const result = await onInstall({
      repository: inspection.repository,
      commitSha: inspection.commitSha,
      targetAgent,
      skillPaths: [...selectedPaths],
      acknowledgeRisk
    });
    if (result) setInspection(null);
  }
  function selectView(nextView) {
    setView(nextView);
    setCategory('');
    setQuery('');
    search({ view: nextView, category: '', search: '' });
  }
  function selectTopic(nextCategory) {
    setCategory(nextCategory);
    setQuery('');
    search({ category: nextCategory, search: '' });
  }
  useEffect(() => { search({ search: '', category: '', view: 'popular' }); }, []);
  useEffect(() => { api.installTargets().then(result => setTargets(result.targets || [])).catch(error => onToast(extractError(error))); }, []);
  const currentView = DISCOVERY_VIEWS.find(item => item[0] === view) || DISCOVERY_VIEWS[0];
  const currentTopic = DISCOVERY_TOPICS.find(item => item[0] === category);
  const hasAppliedSearch = Boolean(data?.query);
  return html`<section class="page discover-page"><${PageHeading} title="不知道搜什么，也能找到好 Skills" description="先浏览真实安装量与增长趋势；有明确任务时，直接描述你想完成什么，不必猜仓库名或英文关键词。" actions=${settings?.ai?.enabled ? html`<button class="secondary-button" onClick=${recommend} disabled=${recommending || loading || !data?.items?.length}>${recommending ? 'AI 挑选中…' : 'AI 帮我从本页挑选'}</button>` : null} />
    <section class="discovery-principles" aria-label="发现依据"><div><span>01</span><strong>按单个 Skill 排名</strong><small>不再把整个仓库当成一个结果</small></div><div><span>02</span><strong>真实生态安装量</strong><small>热门来自采用，而不是名称碰巧命中</small></div><div><span>03</span><strong>安装前仍会安全复检</strong><small>固定 commit、静态扫描、风险确认</small></div></section>
    <form class="discovery-search catalog-search" onSubmit=${event => { event.preventDefault(); setCategory(''); search({ category: '' }); }}><label><${Icon} name="search" size=${18} /><input value=${query} onInput=${event => setQuery(event.target.value)} placeholder="描述任务，例如：帮我制作一份医学研究汇报" aria-label="按任务寻找 Skills" /></label><button class="primary-button">按任务寻找</button></form>
    <nav class="topic-rail" aria-label="Skills 主题">${DISCOVERY_TOPICS.map(([id, label]) => html`<button class=${category === id ? 'active' : ''} type="button" onClick=${() => selectTopic(id)} aria-pressed=${category === id}>${label}</button>`)}</nav>
    <div class="discover-toolbar catalog-toolbar"><div class="segmented" aria-label="榜单类型">${DISCOVERY_VIEWS.map(([id, label]) => html`<button class=${!category && !hasAppliedSearch && view === id ? 'active' : ''} type="button" onClick=${() => selectView(id)} aria-pressed=${!category && !hasAppliedSearch && view === id}>${label}</button>`)}</div><div class="catalog-result-label"><strong>${currentTopic ? currentTopic[1] : hasAppliedSearch ? '任务匹配' : currentView[1]}</strong><span>${data?.source === 'github-fallback' ? 'GitHub 降级结果' : data?.searchType === 'blended' ? '多路意图聚合 · skills.sh' : data?.searchType === 'semantic' ? '语义检索 · skills.sh' : data?.source ? 'skills.sh 生态索引' : ''}</span></div></div>
    ${data?.resolvedQuery && hasAppliedSearch && data.resolvedQuery.toLowerCase() !== data.query.toLowerCase() && html`<div class="intent-translation"><span>已理解你的任务</span><code>${data.resolvedQuery}</code></div>`}
    ${data?.warning && html`<div class="catalog-warning"><strong>生态榜单暂时不可用，已自动降级</strong><span>当前显示 GitHub 仓库结果；恢复后会自动回到单 Skill 安装榜。</span></div>`}
    ${loading ? html`<div class="catalog-skeleton" aria-busy="true" aria-label="正在载入 Skills 榜单">${[1, 2, 3, 4, 5, 6].map(item => html`<i key=${item}></i>`)}</div>` : data?.items?.length ? html`<div class="skill-catalog-grid">${data.items.map(skill => { const recommendation = recommendations.get(skill.repository.toLowerCase()); const metric = data.source === 'github-fallback' ? skill.stars : skill.installs; return html`<article class=${recommendation ? 'catalog-skill-card recommended' : 'catalog-skill-card'} key=${skill.id}><header><span class="catalog-rank">#${String(skill.rank || 0).padStart(2, '0')}</span><span class=${skill.change > 0 ? 'catalog-trend rising' : 'catalog-trend'}>${skill.change > 0 ? `↑ ${formatCompactNumber(skill.change)}` : skill.view === 'trending' ? '本周趋势' : skill.view === 'hot' ? '正在升温' : '生态精选'}</span></header><div class="catalog-skill-title"><h2>${skill.skillName}</h2><p>${skill.repository}</p></div>${recommendation && html`<div class="recommendation-note"><strong>AI ${recommendation.score} 分</strong><span>${recommendation.reason}</span></div>`}<div class="catalog-metric"><strong>${formatCompactNumber(metric)}</strong><span>${data.source === 'github-fallback' ? 'GitHub Stars' : '生态安装'}</span></div>${skill.description && html`<p class="catalog-description">${skill.description}</p>`}<footer><a href=${skill.url} target="_blank" rel="noopener noreferrer">查看来源 ↗</a><button class="primary-button compact" onClick=${() => inspect(skill)} disabled=${Boolean(inspecting) || busy}>${inspecting === skill.repository ? '正在检查…' : '检查并安装'}</button></footer></article>`; })}</div>` : html`<${EmptyState} title="还没有找到合适的 Skill" text="试着描述最终想完成的任务，或直接从上方主题开始浏览。" />`}
    ${inspection && html`<${RepositoryInspectionDialog} inspection=${inspection} targets=${targets} targetAgent=${targetAgent} setTargetAgent=${setTargetAgent} selectedPaths=${selectedPaths} toggleSkill=${toggleSkill} acknowledgeRisk=${acknowledgeRisk} setAcknowledgeRisk=${setAcknowledgeRisk} busy=${busy} onInstall=${install} onClose=${() => setInspection(null)} />`}
  </section>`;
}

function RepositoryInspectionDialog({ inspection, targets, targetAgent, setTargetAgent, selectedPaths, toggleSkill, acknowledgeRisk, setAcknowledgeRisk, busy, onInstall, onClose }) {
  const { scan, ai } = inspection;
  const blocked = !scan.installable;
  const needsAcknowledgement = scan.risk.requiresAcknowledgement;
  const canInstall = !blocked && selectedPaths.size > 0 && targetAgent && (!needsAcknowledgement || acknowledgeRisk) && !busy;
  return html`<div class="inspection-overlay" onClick=${event => event.target === event.currentTarget && onClose()}>
    <section class="inspection-dialog" role="dialog" aria-modal="true" aria-labelledby="inspection-title">
      <header><div><span class="section-kicker">PINNED REPOSITORY INSPECTION</span><h2 id="inspection-title">${inspection.repository}</h2><code>${inspection.commitSha.slice(0, 12)}</code></div><button class="icon-button" onClick=${onClose} aria-label="关闭仓库检查">×</button></header>
      <div class="inspection-summary"><div><span>发现 Skills</span><strong>${scan.skills.length}</strong></div><div><span>扫描文件</span><strong>${scan.fileCount}</strong></div><div><span>静态风险</span><strong class=${`risk-text ${scan.risk.level}`}>${scan.risk.level}</strong></div><div><span>许可证</span><strong>${inspection.metadata.license || '未知'}</strong></div></div>
      ${ai?.status === 'complete' ? html`<article class="ai-assessment"><span class="section-kicker">AI ASSESSMENT · ${Math.round(ai.assessment.confidence * 100)}%</span><h3>${ai.assessment.isSkillRepository ? 'AI 判断为有效 Skills 仓库' : 'AI 判断与 Skills 的相关性较低'}</h3><p>${ai.assessment.summary || 'AI 未提供摘要。'}</p><div>${ai.assessment.categories.map(item => html`<span class="category-badge">${item}</span>`)}</div></article>` : html`<article class="ai-assessment muted"><h3>${ai?.status === 'disabled' ? 'AI 分析未启用' : ai?.status === 'error' ? 'AI 分析失败，静态检查仍然有效' : '未运行 AI 分析'}</h3>${ai?.message && html`<p>${ai.message}</p>`}</article>`}
      <div class="inspection-columns"><article><div class="inspection-section-title"><h3>选择要安装的 Skills</h3><span>${selectedPaths.size}/${scan.skills.length}</span></div><div class="skill-choice-list">${scan.skills.map(skill => html`<label key=${skill.path}><input type="checkbox" checked=${selectedPaths.has(skill.path)} onChange=${() => toggleSkill(skill.path)} /><span><strong>${skill.name}</strong><small>${skill.path}</small></span></label>`)}</div></article>
        <article><div class="inspection-section-title"><h3>风险检查结果</h3><span class=${`risk-pill ${scan.risk.level}`}>${scan.risk.level}</span></div>${scan.risk.findings.length ? html`<ul class="risk-findings">${scan.risk.findings.map(item => html`<li><strong>${item.code}</strong><span>${item.message}${item.path ? ` · ${item.path}` : ''}</span></li>`)}</ul>` : html`<p class="clean-scan">未发现已知高风险模式。静态扫描不能替代人工审阅。</p>`}</article></div>
      <footer><label class="target-select">安装到 Agent<select value=${targetAgent} onChange=${event => setTargetAgent(event.target.value)}>${targets.map(target => html`<option value=${target.id}>${target.name}</option>`)}</select></label>${needsAcknowledgement && html`<label class="risk-ack"><input type="checkbox" checked=${acknowledgeRisk} onChange=${event => setAcknowledgeRisk(event.target.checked)} /><span>我已阅读高风险发现，仍要安装固定 commit</span></label>`}<button class="secondary-button" onClick=${onClose}>取消</button><button class="primary-button" onClick=${onInstall} disabled=${!canInstall}>${busy ? '安装中…' : blocked ? '已阻止安装' : `安装 ${selectedPaths.size} 个 Skills`}</button></footer>
    </section>
  </div>`;
}

function MaintenanceRun({ run, onCancel }) {
  if (!run) return null;
  const active = ['running', 'cancelling'].includes(run.status);
  const progress = run.total > 0 ? Math.round(run.completed / run.total * 100) : 0;
  const phase = {
    queued: '等待启动', starting: '准备环境', updates: '检查来源', classification: 'AI 分类',
    complete: '运行完成', error: '运行失败', cancelled: '已停止'
  }[run.phase] || '处理中';
  return html`<article class=${active ? 'maintenance-progress active' : `maintenance-progress ${run.status}`} aria-live="polite">
    <div class="maintenance-progress-head"><div class="run-glyph" aria-hidden="true"><i></i><i></i><i></i></div><div><span>${phase}</span><h2>${run.message || '正在维护 Skills'}</h2><p>${run.current ? `当前：${run.current}` : active ? '任务在后台运行，你可以继续浏览和管理 Skills。' : formatDate(run.finishedAt)}</p></div>${active && html`<button class="secondary-button compact" onClick=${onCancel} disabled=${run.status === 'cancelling'}>${run.status === 'cancelling' ? '正在停止…' : '停止任务'}</button>`}</div>
    <progress class="progress-track" aria-label="维护进度" max="100" value=${run.total ? Math.max(2.5, progress) : 2.5}>${progress}%</progress>
    <div class="progress-meta"><span>${run.total ? `${run.completed} / ${run.total}` : '正在计算工作量'}</span><span>${run.remaining ? `本批完成后仍有 ${run.remaining} 项` : active ? '保持应用开启即可' : run.status}</span></div>
  </article>`;
}

function Automation({ status, settings, busy, onSave, onRun, onCancel }) {
  const [form, setForm] = useState(settings?.automation || {});
  useEffect(() => setForm(settings?.automation || {}), [settings]);
  if (!status || !settings) return html`<${LoadingState} />`;
  const update = patch => setForm(current => ({ ...current, ...patch }));
  const maintenanceActive = ['running', 'cancelling'].includes(status?.run?.status);
  return html`<section class="page automation-page"><${PageHeading} eyebrow="AUTOMATED MAINTENANCE" title="可追踪、可回滚的 Skills 维护" description="只更新具有明确 GitHub 来源记录的 Skills；每次更新先静态复检并备份，新增高风险时自动停止。" actions=${html`<button class="secondary-button" onClick=${() => onRun(Boolean(form.classification))} disabled=${busy || maintenanceActive}>${maintenanceActive ? '后台运行中…' : '立即运行一次'}</button><button class="primary-button" onClick=${() => onSave(form)} disabled=${busy}>保存设置</button>`} />
    <${MaintenanceRun} run=${status?.run} onCancel=${onCancel} />
    ${!status.updates?.eligible && html`<div class="maintenance-notice"><strong>当前没有可更新的跟踪来源</strong><span>通过“发现 → 检查并安装”添加的 Skills 会自动记录仓库、commit 和子路径；已有本地 Skills 不会被猜测来源或擅自覆盖。</span></div>`}
    <div class="automation-layout"><article class="panel automation-control"><div class="toggle-line"><div><span class="section-kicker">主开关</span><h2>定期自动维护</h2><p>仅在 SkillPilot 正在运行或驻留托盘时执行。下次运行时间会持久保存，重启不会立即误触发。</p></div><label class="switch"><input type="checkbox" checked=${Boolean(form.enabled)} onChange=${event => update({ enabled: event.target.checked })} /><span></span></label></div><div class="form-grid"><div class="schedule-fields"><label>运行间隔<select value=${form.intervalHours || 24} onChange=${event => update({ intervalHours: Number(event.target.value) })}><option value="6">每 6 小时</option><option value="12">每 12 小时</option><option value="24">每天</option><option value="168">每周</option></select></label><label>单次 AI 分类数量<select value=${form.classificationBatchSize || 25} onChange=${event => update({ classificationBatchSize: Number(event.target.value) })}><option value="10">10 个</option><option value="25">25 个</option><option value="50">50 个</option><option value="100">100 个</option></select></label></div><div class="option-stack"><label><input type="checkbox" checked=${Boolean(form.updateChecks)} onChange=${event => update({ updateChecks: event.target.checked })} /><span><strong>检查来源更新</strong><small>仅比较已登记来源的默认分支 commit，并分别报告检查、跳过与失败</small></span></label><label><input type="checkbox" checked=${Boolean(form.autoUpdate)} onChange=${event => update({ autoUpdate: event.target.checked })} /><span><strong>自动应用低风险更新</strong><small>先备份再原子替换；高风险、路径变化或扫描不完整时停止更新</small></span></label><label><input type="checkbox" checked=${Boolean(form.classification)} onChange=${event => update({ classification: event.target.checked })} /><span><strong>AI 分批自动分类</strong><small>${settings.ai.enabled ? `限定为 10 个大类；仅处理未分类或内容已变化的 Skills，稳定结果不会重复覆盖` : '请先在设置中启用 AI'}</small></span></label></div></div></article>
      <article class="panel run-status"><span class=${status.isRunning ? 'run-orb active' : 'run-orb'}></span><span class="section-kicker">运行状态</span><h2>${status.isRunning ? '维护任务执行中' : '系统空闲'}</h2><p>上次运行：${formatDate(status.lastScheduledRun)}<br />下次计划：${formatDate(status.nextRunAt)}</p><dl><div><dt>可跟踪</dt><dd>${status.updates?.eligible || 0}</dd></div><div><dt>待更新</dt><dd>${status.updates?.total || 0}</dd></div><div><dt>异常</dt><dd>${status.updates?.failed || 0}</dd></div></dl></article></div>
    <article class="panel history-panel"><div class="panel-header"><div><span class="section-kicker">审计记录</span><h2>最近任务</h2></div></div>${status.history?.length ? html`<div class="history-list">${status.history.map(item => html`<div key=${item.id}><span class=${`history-status ${item.status}`}></span><span><strong>${item.message}</strong><small>${item.type}</small></span><time>${formatDate(item.at)}</time></div>`)}</div>` : html`<${EmptyState} title="还没有维护记录" text="运行一次维护任务后，结果会保存在这里。" />`}</article>
  </section>`;
}

function Settings({ settings, sources, appUpdate, checkingUpdate, busy, onCheckUpdate, onSave, onTest, onSourceToggle, onAddSource, onRemoveSource, onImportDb }) {
  const [ai, setAI] = useState(settings?.ai || {});
  const [github, setGithub] = useState(settings?.github || {});
  const [newSource, setNewSource] = useState({ name: '', path: '' });
  useEffect(() => { setAI(settings?.ai || {}); setGithub(settings?.github || {}); }, [settings]);
  if (!settings) return html`<${LoadingState} />`;
  return html`<section class="page settings-page"><${PageHeading} eyebrow="CONFIGURATION" title="设置" description="配置模型、来源与可移植数据。所有敏感信息只保存在本机。" actions=${html`<button class="primary-button" onClick=${() => onSave({ ai, github })} disabled=${busy}>保存全部设置</button>`} />
    <div class="settings-grid"><article class="panel settings-card wide"><div class="settings-card-title"><span class="settings-index">AI</span><div><h2>自定义 AI 服务</h2><p>兼容 OpenAI Chat Completions API 与本地 Ollama。</p></div><label class="switch"><input type="checkbox" checked=${Boolean(ai.enabled)} onChange=${event => setAI({ ...ai, enabled: event.target.checked })} /><span></span></label></div><div class="form-grid three"><label>API Base URL<input value=${ai.baseUrl || ''} onInput=${event => setAI({ ...ai, baseUrl: event.target.value })} placeholder="http://localhost:11434/v1" /></label><label>模型<input value=${ai.model || ''} onInput=${event => setAI({ ...ai, model: event.target.value })} placeholder="qwen3:8b" /></label><label>API Key<input type="password" value=${ai.apiKey || ''} onInput=${event => setAI({ ...ai, apiKey: event.target.value })} placeholder=${ai.hasApiKey ? '已保存，留空则保持不变' : '本地 Ollama 可留空'} /></label></div><button class="secondary-button compact" onClick=${() => onTest(ai)} disabled=${busy || !ai.baseUrl || !ai.model}>测试连接</button></article>
      <article class="panel settings-card"><div class="settings-card-title"><span class="settings-index">GH</span><div><h2>GitHub 发现</h2><p>Token 可提高 API 速率限制。</p></div></div><label>Personal Access Token<input type="password" value=${github.token || ''} onInput=${event => setGithub({ ...github, token: event.target.value })} placeholder=${github.hasToken ? '已安全保存' : '可选'} /></label></article>
      <article class="panel settings-card"><div class="settings-card-title"><span class="settings-index">DB</span><div><h2>数据迁移</h2><p>导出分类、设置与历史，不包含密钥。</p></div></div><div class="button-stack"><a class="secondary-button" href="/api/database/export">导出数据库</a><button class="secondary-button" onClick=${() => document.getElementById('db-import').click()}>恢复数据库</button><input id="db-import" class="visually-hidden" type="file" accept=".json" onChange=${event => event.target.files[0] && onImportDb(event.target.files[0])} /></div></article>
      <${AppUpdateCard} status=${appUpdate} checking=${checkingUpdate} onCheck=${onCheckUpdate} />
    </div>
    <article class="panel sources-settings"><div class="panel-header"><div><span class="section-kicker">扫描路径</span><h2>Agent 来源</h2></div></div><div class="source-table">${sources.map(source => html`<div key=${source.id}><span class="agent-monogram">${source.name.slice(0, 1)}</span><span><strong>${source.name}</strong><small>${source.path}</small></span><span class=${source.exists ? 'path-state found' : 'path-state'}>${source.exists ? '已发现' : '路径不存在'}</span><label class="switch small"><input type="checkbox" checked=${source.enabled} onChange=${event => onSourceToggle(source.id, event.target.checked)} /><span></span></label>${!source.builtIn ? html`<button class="text-button danger-text" onClick=${() => confirm('仅移除来源配置，不删除文件。继续？') && onRemoveSource(source.id)}>移除</button>` : html`<span></span>`}</div>`)}</div><form class="add-source" onSubmit=${event => { event.preventDefault(); onAddSource(newSource); setNewSource({ name: '', path: '' }); }}><input value=${newSource.name} onInput=${event => setNewSource({ ...newSource, name: event.target.value })} placeholder="来源名称" aria-label="来源名称" /><input value=${newSource.path} onInput=${event => setNewSource({ ...newSource, path: event.target.value })} placeholder="绝对路径，例如 D:\\skills" aria-label="来源绝对路径" /><button class="secondary-button">添加自定义路径</button></form></article>
  </section>`;
}

function AppUpdateCard({ status, checking, onCheck }) {
  const state = !status ? '正在检查当前版本…'
    : status.status === 'update-available' ? `发现新版本 ${status.latestVersion}`
      : status.status === 'current' ? '当前已是最新版本'
        : status.status === 'unpublished' ? '仓库尚未发布正式 Release'
          : `检查失败：${status.message || '请稍后重试'}`;
  return html`<article class="panel settings-card wide app-update-card">
    <div class="settings-card-title"><span class="settings-index">UP</span><div><h2>应用更新</h2><p>当前版本 ${status?.currentVersion || '—'} · 通过 GitHub 正式 Release 检查，不会静默下载或安装。</p></div><span class=${status?.updateAvailable ? 'update-state available' : 'update-state'}>${state}</span></div>
    <div class="update-card-actions"><button class="secondary-button compact" onClick=${onCheck} disabled=${checking}>${checking ? '检查中…' : '立即检查更新'}</button>${status?.release?.url && html`<a class="primary-button compact" href=${status.release.url} target="_blank" rel="noopener noreferrer">查看 GitHub Release</a>`}<small>上次检查：${formatDate(status?.checkedAt)}</small></div>
  </article>`;
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
