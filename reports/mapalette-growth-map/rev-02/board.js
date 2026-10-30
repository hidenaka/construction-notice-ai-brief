'use strict';
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const board = document.getElementById('skill-board');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (id) => document.getElementById(({ 'selected-title': 'detail-title', 'selected-status': 'detail-status', 'selected-condition': 'detail-condition' })[id] || id);
  const statusClass = { '達成': 'done', '進行中': 'wip', '次の挑戦': 'next' };
  const center = 550;
  const baseView = { x: 0, y: 0, size: 1100 };
  let camera = { ...baseView };
  let cameraTarget = { ...baseView };
  let animationId = null;
  let nodes = [];
  let branches = [];
  let selectedId = null;
  let activeBranch = null;
  const positions = new Map();
  const svgNodes = new Map();
  const listButtons = new Map();
  const branchButtons = new Map();
  const sectorElements = new Map();

  function svg(tag, attributes = {}, content) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function point(radius, degrees) {
    const angle = degrees * Math.PI / 180;
    return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  }
  function wedge(start, end, inner = 110, outer = 462) {
    const a = point(inner, start), b = point(outer, start), c = point(outer, end), d = point(inner, end);
    return `M ${a.x} ${a.y} L ${b.x} ${b.y} A ${outer} ${outer} 0 0 1 ${c.x} ${c.y} L ${d.x} ${d.y} A ${inner} ${inner} 0 0 0 ${a.x} ${a.y}`;
  }
  function addDefinitions() {
    const defs = svg('defs');
    const gold = svg('radialGradient', { id: 'node-gold', cx: '.35', cy: '.25', r: '.9' });
    gold.append(svg('stop', { offset: '0%', 'stop-color': '#f5dfa1' }), svg('stop', { offset: '55%', 'stop-color': '#cfaa60' }), svg('stop', { offset: '100%', 'stop-color': '#766039' }));
    const blue = svg('radialGradient', { id: 'node-blue', cx: '.3', cy: '.2', r: '1' });
    blue.append(svg('stop', { offset: '0%', 'stop-color': '#2f536b' }), svg('stop', { offset: '100%', 'stop-color': '#102336' }));
    const lineGold = svg('linearGradient', { id: 'line-gold', x1: '0', y1: '0', x2: '1', y2: '1' });
    lineGold.append(svg('stop', { offset: '0%', 'stop-color': '#765e35' }), svg('stop', { offset: '50%', 'stop-color': '#d6b578' }), svg('stop', { offset: '100%', 'stop-color': '#8f7341' }));
    const glow = svg('filter', { id: 'soft-glow', x: '-100%', y: '-100%', width: '300%', height: '300%' });
    glow.append(svg('feGaussianBlur', { stdDeviation: '1.8' }));
    const core = svg('radialGradient', { id: 'core-fill' });
    core.append(svg('stop', { offset: '0%', 'stop-color': '#273449' }), svg('stop', { offset: '100%', 'stop-color': '#0c1420' }));
    defs.append(gold, blue, lineGold, glow, core);
    board.append(defs);
  }
  function drawDial() {
    const dial = svg('g', { 'aria-hidden': 'true' });
    for (const radius of [110, 176, 224, 278, 328, 380, 438, 462, 470, 500]) {
      dial.append(svg('circle', { cx: center, cy: center, r: radius, class: `dial-ring${[224, 328, 438].includes(radius) ? ' fine' : ''}` }));
    }
    for (let i = 0; i < 120; i++) {
      const a = point(i % 5 === 0 ? 481 : 490, i * 3), b = point(498, i * 3);
      dial.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `dial-tick${i % 5 === 0 ? ' major' : ''}` }));
    }
    board.append(dial);
  }
  function layoutBranch(branchNodes, angle) {
    const layouts = {
      3: [[176, 0], [303, -13], [380, 10]],
      4: [[176, 0], [278, -14], [278, 14], [398, 0]],
      5: [[176, 0], [278, -14], [278, 14], [398, -12], [398, 12]],
      6: [[176, 0], [278, -14], [278, 14], [380, -15], [380, 15], [435, 0]]
    };
    branchNodes.forEach((node, i) => {
      const [radius, offset] = layouts[branchNodes.length][i];
      positions.set(node.id, { ...point(radius, angle + offset), radius, angle: angle + offset });
    });
  }
  function drawBranch(branch, index) {
    const branchNodes = nodes.filter((node) => node.branch === branch);
    const angle = -90 + index * 60;
    layoutBranch(branchNodes, angle);
    const group = svg('g', { class: 'sector', 'data-branch': branch });
    group.append(svg('path', { d: wedge(angle - 29, angle + 29), class: 'sector-surface', 'aria-hidden': 'true' }));
    const divisionA = point(114, angle - 30), divisionB = point(459, angle - 30);
    group.append(svg('line', { x1: divisionA.x, y1: divisionA.y, x2: divisionB.x, y2: divisionB.y, class: 'sector-divider', 'aria-hidden': 'true' }));
    const source = point(109, angle);
    const first = positions.get(branchNodes[0].id);
    group.append(svg('path', { d: `M ${source.x} ${source.y} L ${first.x} ${first.y}`, class: 'branch-link done', 'aria-hidden': 'true' }));
    branchNodes.forEach((node, i) => {
      if (i === 0) return;
      // Connections show a branch grouping; they never gate access to another node.
      const parentIndex = i <= 2 ? 0 : i === 5 ? 3 : i - 2;
      const from = positions.get(branchNodes[parentIndex].id), to = positions.get(node.id);
      const parent = branchNodes[parentIndex];
      let state = '';
      if (parent.status === '達成' && node.status === '達成') state = 'done';
      else if (node.status === '進行中') state = 'wip';
      group.append(svg('path', { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, class: `branch-link ${state}`, 'aria-hidden': 'true' }));
    });
    const label = point(530, angle);
    group.append(svg('text', { x: label.x, y: label.y - 12, class: 'branch-label-index', 'aria-hidden': 'true' }, `0${index + 1}`));
    group.append(svg('text', { x: label.x, y: label.y + 10, class: 'branch-label', 'aria-hidden': 'true' }, branch));
    board.append(group);
    sectorElements.set(branch, group);
    branchNodes.forEach((node) => drawNode(node, group));
  }
  function drawNode(node, group) {
    const p = positions.get(node.id);
    const nodeGroup = svg('g', {
      class: `node ${statusClass[node.status]}`,
      transform: `translate(${p.x} ${p.y})`,
      tabindex: '0', role: 'button',
      'aria-label': `${node.id} ${node.title}、${node.status}`,
      'aria-pressed': 'false', 'data-node-id': node.id
    });
    nodeGroup.append(svg('title', {}, `${node.id} · ${node.title} · ${node.status}`));
    nodeGroup.append(svg('circle', { r: 40, class: 'hit-area' }), svg('circle', { r: 36, class: 'node-halo' }), svg('circle', { r: 27, class: 'node-outer' }), svg('circle', { r: 22, class: 'inner-ring' }));
    nodeGroup.append(svg('text', { y: -3, class: 'node-label' }, node.id));
    nodeGroup.append(svg('text', { y: 14, class: 'state-mark' }, node.status === '達成' ? '✓' : node.status === '進行中' ? '◐' : '◇'));
    nodeGroup.append(svg('circle', { r: 29, class: 'celebration-ring' }));
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      nodeGroup.append(svg('circle', { cx: Math.cos(angle) * 47, cy: Math.sin(angle) * 47, r: 2, class: 'spark' }));
    }
    nodeGroup.addEventListener('click', () => selectNode(node.id));
    nodeGroup.addEventListener('focus', () => ensureNodeVisible(node.id));
    nodeGroup.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); }
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const pool = navigationNodes();
        let nextIndex = pool.findIndex((entry) => entry.id === node.id);
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = pool.length - 1;
        else nextIndex = (nextIndex + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + pool.length) % pool.length;
        const target = pool[nextIndex];
        selectNode(target.id);
        svgNodes.get(target.id).focus({ preventScroll: true });
      }
    });
    group.append(nodeGroup);
    svgNodes.set(node.id, nodeGroup);
  }
  function drawCore() {
    const core = svg('g', { 'aria-hidden': 'true' });
    core.append(svg('circle', { cx: center, cy: center, r: 105, fill: 'url(#core-fill)', stroke: '#a88e5e', 'stroke-width': '1.5' }));
    core.append(svg('circle', { cx: center, cy: center, r: 97, class: 'core-ring' }), svg('circle', { cx: center, cy: center, r: 88, class: 'core-ring', 'stroke-dasharray': '1 7' }));
    core.append(svg('text', { x: center, y: center - 26, class: 'core-subtitle' }, '成長盤'));
    core.append(svg('text', { x: center, y: center + 10, class: 'core-name' }, 'MaPalette'));
    core.append(svg('line', { x1: center - 30, x2: center + 30, y1: center + 29, y2: center + 29, stroke: '#aa925d', 'stroke-width': '1' }));
    core.append(svg('text', { x: center, y: center + 50, class: 'core-small' }, 'ここから、広がる。'));
    board.append(core);
  }
  function applyCamera() {
    board.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.size} ${camera.size}`);
    $('zoom-in').disabled = camera.size <= 300;
    $('zoom-out').disabled = camera.size >= 1100;
  }
  function moveCamera(target) {
    cameraTarget = { ...target };
    if (animationId !== null) cancelAnimationFrame(animationId);
    if (reducedMotion.matches) { camera = { ...target }; applyCamera(); return; }
    const from = { ...camera }, start = performance.now(), duration = 440;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
      camera = { x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased, size: from.size + (target.size - from.size) * eased };
      applyCamera();
      animationId = t < 1 ? requestAnimationFrame(frame) : null;
    }
    animationId = requestAnimationFrame(frame);
  }
  function ensureNodeVisible(id) {
    const position = positions.get(id);
    if (!position || cameraTarget.size >= baseView.size) return;
    const margin = 62;
    const target = cameraTarget;
    const inside = position.x >= target.x + margin && position.x <= target.x + target.size - margin && position.y >= target.y + margin && position.y <= target.y + target.size - margin;
    if (!inside) moveCamera({ x: position.x - target.size / 2, y: position.y - target.size / 2, size: target.size });
  }
  function focusBranch(branch) {
    activeBranch = branch;
    $('show-all').classList.toggle('active', branch === null);
    $('show-all').setAttribute('aria-pressed', String(branch === null));
    branchButtons.forEach((button, name) => { button.classList.toggle('active', branch === name); button.setAttribute('aria-pressed', String(branch === name)); });
    sectorElements.forEach((group, name) => group.classList.toggle('active', name === branch));
    svgNodes.forEach((element, id) => element.setAttribute('tabindex', !branch || nodes.find((node) => node.id === id).branch === branch ? '0' : '-1'));
    board.setAttribute('data-active-branch', branch || 'all');
    $('view-label').textContent = branch ? `${branch}をひらく` : '全体を見渡す';
    if (!branch) moveCamera(baseView);
    else {
      const subset = nodes.filter((node) => node.branch === branch), coords = subset.map((node) => positions.get(node.id));
      const minX = Math.min(...coords.map((p) => p.x)), maxX = Math.max(...coords.map((p) => p.x));
      const minY = Math.min(...coords.map((p) => p.y)), maxY = Math.max(...coords.map((p) => p.y));
      const size = Math.max(490, maxX - minX + 190, maxY - minY + 190);
      moveCamera({ x: (minX + maxX - size) / 2, y: (minY + maxY - size) / 2, size });
      if (!subset.some((node) => node.id === selectedId)) selectNode(subset[0].id);
    }
    updatePosition();
  }
  function navigationNodes() { return activeBranch ? nodes.filter((node) => node.branch === activeBranch) : nodes; }
  function updatePosition() {
    const pool = navigationNodes(), index = pool.findIndex((node) => node.id === selectedId);
    $('node-position').textContent = `${index + 1} / ${pool.length}${activeBranch ? ' · 分野内' : ' · 全体'}`;
    $('previous-node').setAttribute('aria-label', activeBranch ? `${activeBranch}の前のマスを見る` : '全28マスから前のマスを見る');
    $('next-node').setAttribute('aria-label', activeBranch ? `${activeBranch}の次のマスを見る` : '全28マスから次のマスを見る');
  }
  function selectNode(id) {
    const node = nodes.find((entry) => entry.id === id);
    if (!node) return;
    if (activeBranch && node.branch !== activeBranch) focusBranch(null);
    selectedId = id;
    board.setAttribute('data-selected-node', id);
    svgNodes.forEach((element, key) => { element.classList.toggle('selected', key === id); element.setAttribute('aria-pressed', String(key === id)); });
    listButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
    for (const field of ['id', 'branch', 'title', 'actor', 'condition', 'detail', 'status']) $('selected-' + field).textContent = node[field];
    $('selected-status').className = `status-badge ${statusClass[node.status]}`;
    $('selected-steps').replaceChildren();
    node.steps.forEach((step) => { const item = document.createElement('li'); item.textContent = step; $('selected-steps').append(item); });
    $('selected-steps').hidden = node.steps.length === 0;
    $('no-steps').hidden = node.steps.length > 0;
    $('celebrate').hidden = node.status !== '達成';
    $('effect-note').hidden = node.status !== '達成';
    $('selection-announcement').textContent = `${node.id}、${node.title}、${node.status}。詳細を更新しました。`;
    ensureNodeVisible(id);
    updatePosition();
  }
  function stepNode(direction) {
    const pool = navigationNodes(), current = pool.findIndex((node) => node.id === selectedId);
    selectNode(pool[(current + direction + pool.length) % pool.length].id);
  }
  function zoom(factor) {
    let size = Math.max(300, Math.min(1100, camera.size * factor));
    if (size > 1090) { focusBranch(null); return; }
    let focus = { x: camera.x + camera.size / 2, y: camera.y + camera.size / 2 };
    if (factor < 1 && selectedId) focus = positions.get(selectedId);
    moveCamera({ x: focus.x - size / 2, y: focus.y - size / 2, size });
  }
  function createNavigation() {
    branches.forEach((branch, i) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = branch;
      button.setAttribute('data-branch', branch); button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => focusBranch(branch));
      $('branch-controls').append(button); branchButtons.set(branch, button);
      const section = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = branch; section.append(heading);
      nodes.filter((node) => node.branch === branch).forEach((node) => {
        const listButton = document.createElement('button'), meta = document.createElement('strong'), title = document.createElement('span');
        listButton.type = 'button'; listButton.setAttribute('aria-pressed', 'false');
        meta.textContent = `${node.id} · ${node.status}`; title.textContent = node.title;
        listButton.append(meta, title);
        listButton.addEventListener('click', () => { focusBranch(branch); selectNode(node.id); $('node-panel').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' }); });
        section.append(listButton); listButtons.set(node.id, listButton);
      });
      $('node-list').append(section);
    });
    $('show-all').addEventListener('click', () => focusBranch(null));
    $('previous-node').addEventListener('click', () => stepNode(-1));
    $('next-node').addEventListener('click', () => stepNode(1));
    $('zoom-in').addEventListener('click', () => zoom(.78));
    $('zoom-out').addEventListener('click', () => zoom(1.28));
    $('celebrate').addEventListener('click', () => {
      const node = nodes.find((entry) => entry.id === selectedId);
      if (!node || node.status !== '達成') return;
      const element = svgNodes.get(selectedId);
      element.classList.remove('burst');
      // A single explicit animation; no audio, progress mutations or repeating motion.
      void element.getBoundingClientRect();
      element.classList.add('burst');
      setTimeout(() => element.classList.remove('burst'), reducedMotion.matches ? 50 : 1000);
      $('selection-announcement').textContent = `${node.id}の達成の光を再生しました。記録の変更はありません。`;
    });
  }
  async function initialize() {
    try {
      const response = await fetch('./nodes-public.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      nodes = data.nodes;
      if (!Array.isArray(nodes) || nodes.length !== 28) throw new Error('28マスの記録を確認できません');
      branches = [...new Set(nodes.map((node) => node.branch))];
      if (branches.length !== 6 || nodes.some((node) => !statusClass[node.status] || !Array.isArray(node.steps))) throw new Error('マスの形式を確認できません');
      addDefinitions(); drawDial(); branches.forEach(drawBranch); drawCore(); createNavigation();
      for (const [status, id] of [['達成', 'done-count'], ['進行中', 'wip-count'], ['次の挑戦', 'next-count']]) $(id).textContent = String(nodes.filter((node) => node.status === status).length);
      $('loading').hidden = true; $('node-panel').setAttribute('aria-busy', 'false');
      selectNode(nodes[0].id); applyCamera();
    } catch (error) {
      $('loading').textContent = '成長盤を読み込めませんでした。ページを再読み込みしてください。';
      $('selected-title').textContent = '記録を読み込めませんでした';
      $('selected-status').textContent = '読み込みエラー';
      $('selected-detail').textContent = '同じサイトの nodes-public.json が開けるか確認してください。';
      $('node-panel').setAttribute('aria-busy', 'false');
      for (const id of ['previous-node', 'next-node', 'show-all', 'zoom-in', 'zoom-out']) $(id).disabled = true;
      console.error('成長盤の読み込みに失敗しました:', error);
    }
  }
  initialize();
})();
