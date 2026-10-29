import { readMeeting, validateMeeting, nearbyLandmarks, meetingText, FLOOR_NAMES, PAID_NAMES, deliverShare } from './meeting.mjs';

const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
const button = (text, fn) => { const b = el('button', text); b.type = 'button'; b.onclick = fn; return b; };
export function installMeetingUI(api) {
  let value = readMeeting(api.initialHash), selectedLandmark = '';
  if (value && (!api.resolvePlace(value.id, value.floor) || !api.availableFloors(value.id).includes(value.floor))) value = null;
  const original = Boolean(value);
  const dialog = el('dialog', '', 'meeting-dialog'); dialog.id = 'meetingDialog';
  const heading = el('h2', original ? '共有された待ち合わせ場所' : '待ち合わせ場所を共有'); heading.id = 'meetingTitle';
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = button('閉じる', () => dialog.close()); close.className = 'meeting-close';
  const content = el('div'); dialog.append(close, heading, content); document.body.append(dialog);
  const opener = button(value ? '待合せあり' : '待ち合わせ', () => open()); opener.id = 'meetingOpen'; opener.className = 'chip';
  (document.querySelector('.mobile-primary') || document.querySelector('.bar')).append(opener);
  const action = button('ここで待ち合わせ', () => start()); action.id = 'meetingStart';
  const cardbar = document.querySelector('#mobile-cardbar');
  document.querySelector('#card').prepend(action);
  const mobileAction = button('ここで待ち合わせ', () => start()); mobileAction.id = 'meetingStartMobile';
  if (cardbar) cardbar.insertBefore(mobileAction, document.querySelector('#mobile-detail'));
  const marker = button('待合せ', () => open()); marker.id = 'meetingMarker'; marker.hidden = true; document.body.append(marker);
  const selectedNote = el('div', '', 'meeting-candidate-note');
  const observer = new MutationObserver(() => syncSelection());
  observer.observe(document.querySelector('#cardBody'), { childList: true });
  function syncSelection() {
    const place = api.resolvePlace(api.getSelected(), api.getViewFloor());
    for (const b of [action, mobileAction]) { b.disabled = !place; b.title = place ? 'この地点を待ち合わせ場所にする' : '位置の分かる建物・出口・改札を選んでください'; }
  }
  function save() { opener.textContent = value ? '待合せあり' : '待ち合わせ'; api.saveHash(); }
  function start() {
    const place = api.resolvePlace(api.getSelected(), api.getViewFloor());
    if (!place) return open();
    value = validateMeeting({ v: 1, id: place.id, floor: place.floor || 'unknown', paid: 'unknown', note: '', landmarkId: '' });
    heading.textContent = 'ここで待ち合わせ'; save(); render(); if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0;
  }
  function open() { render(); if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0; }
  function render() {
    content.replaceChildren();
    if (!value) {
      content.append(el('p', '地図の建物・出口・改札を選び、「ここで待ち合わせ」を押してください。位置が分からない出口は選べません。'));
      const place = api.resolvePlace(api.getSelected(), api.getViewFloor());
      if (place) content.append(button('選択中の場所で待ち合わせ', start));
      return;
    }
    const place = api.resolvePlace(value.id, value.floor);
    if (!place) { value = null; save(); return render(); }
    const name = el('h3', place.name), basis = el('p', place.basis, 'meeting-small');
    content.append(name, basis);
    const summary = el('p', '', 'meeting-summary'); content.append(summary);
    const locate = button('地図でこの場所を見る', () => { api.focusMeeting(value); dialog.close(); }); content.append(locate);
    const form = el('div', '', 'meeting-fields');
    const floorLabel = el('label', '階（利用者の指定）'), floor = el('select'); floor.id = 'meetingFloor';
    for (const [id, text] of Object.entries(FLOOR_NAMES).filter(([id]) => api.availableFloors(value.id).includes(id))) { const o = el('option', text); o.value = id; floor.append(o); }
    floor.value = value.floor; floorLabel.append(floor);
    const paidLabel = el('label', '改札の内外（利用者の指定）'), paid = el('select'); paid.id = 'meetingPaid';
    for (const [id, text] of Object.entries(PAID_NAMES)) { const o = el('option', text); o.value = id; paid.append(o); }
    paid.value = value.paid; paidLabel.append(paid); form.append(floorLabel, paidLabel);
    const noteLabel = el('label', '目印・補足（利用者の入力、160文字まで）'), note = el('textarea');
    note.id = 'meetingNote'; note.rows = 3; note.maxLength = 320; note.value = value.note;
    note.placeholder = '例：柱の番号や看板の名前など、現地で確かめた目印'; noteLabel.append(note); form.append(noteLabel); content.append(form);
    const nearbyTitle = el('h3', 'データ上の近くの目印候補');
    const caveat = el('p', '下の距離は地図上の直線距離です。歩く距離・見通し・通路の接続は未確認です。店舗・時計などの情報はまだ追加していません。', 'meeting-small');
    const nearby = el('div', '', 'meeting-nearby'); content.append(nearbyTitle, caveat, nearby, selectedNote);
    const actions = el('div', '', 'meeting-actions');
    const share = button('共有する', () => shareLink(false)), copy = button('リンクをコピー', () => shareLink(true)); actions.append(share, copy);
    const linkLabel = el('label', '共有リンク'), link = el('textarea'); link.id = 'meetingLink'; link.rows = 2; link.readOnly = true; linkLabel.append(link);
    const status = el('p', '', 'meeting-status'); status.id = 'meetingStatus'; status.setAttribute('role', 'status');
    const privacy = el('p', 'このリンクを受け取った人は目印メモも読めます。氏名・電話番号などは書かないでください。現在地の取得や追跡はしません。', 'meeting-small');
    const remove = button('待ち合わせを解除', () => { value = null; marker.hidden = true; save(); heading.textContent = '待ち合わせ場所を共有'; render(); }); remove.className = 'meeting-clear';
    content.append(actions, linkLabel, status, privacy, remove);
    function update() {
      note.value = [...note.value].slice(0, 160).join('');
      value = validateMeeting({ ...value, floor: floor.value, paid: paid.value, note: note.value, landmarkId: selectedLandmark });
      summary.textContent = FLOOR_NAMES[value.floor] + ' ／ ' + PAID_NAMES[value.paid] + '（利用者の指定）';
      save(); link.value = location.href;
      const lm = api.resolvePlace(value.landmarkId, value.floor);
      selectedNote.textContent = lm ? '選んだ目印：' + lm.name + '（位置・階・見通しは現地でも確認してください）' : '目印を選ぶか、上の補足欄に記入できます。';
    }
    function list() {
      nearby.replaceChildren();
      const origin = { ...api.resolvePlace(value.id, value.floor), floor: value.floor };
      const candidates = nearbyLandmarks(origin, api.allPlaces(value.floor));
      if (!candidates.length) nearby.append(el('p', 'この範囲の候補はありません。現地の目印を補足欄に記入できます。'));
      if (selectedLandmark) nearby.append(button('目印の選択を外す', () => { selectedLandmark = ''; update(); list(); }));
      for (const p of candidates) {
        const row = button(p.name + ' ／ ' + (p.sameFloor ? FLOOR_NAMES[p.floor] : '同じ階か未確認') + ' ／ 約' + Math.round(p.distance) + 'm', () => { selectedLandmark = p.id; update(); list(); });
        row.setAttribute('aria-pressed', String(selectedLandmark === p.id)); row.append(el('span', p.basis, 'meeting-small')); nearby.append(row);
      }
    }
    async function shareLink(copyOnly) {
      update();
      const landmark = api.resolvePlace(value.landmarkId, value.floor);
      const text = meetingText(value, place) + (landmark ? '\n目印候補：' + landmark.name : '');
      const result = await deliverShare({ share: !copyOnly && navigator.share ? p => navigator.share(p) : null, copy: navigator.clipboard?.writeText ? t => navigator.clipboard.writeText(t) : null }, { title: '東京駅の待ち合わせ場所', text, url: link.value });
      status.textContent = { shared: '共有操作を完了しました。', cancelled: '共有をキャンセルしました。', copied: 'リンクをコピーしました。', manual: '下の共有リンクを選択してコピーしてください。' }[result];
      if (result === 'manual') { link.focus(); link.select(); }
    }
    selectedLandmark = value.landmarkId; update(); list();
    floor.onchange = () => { selectedLandmark = ''; update(); list(); }; paid.onchange = update; note.oninput = update;
  }
  function updateMarker() {
    if (!value) { marker.hidden = true; return; }
    const place = api.resolvePlace(value.id, value.floor), point = place && api.project(place, value.floor);
    if (!point || !point.visible || (value.floor !== 'unknown' && value.floor !== api.getViewFloor() && api.getMode() === '2d')) { marker.hidden = true; return; }
    marker.hidden = false; marker.style.left = point.x + 'px'; marker.style.top = point.y + 'px';
    marker.textContent = '待合せ ' + FLOOR_NAMES[value.floor]; marker.title = place.name;
  }
  syncSelection();
  if (value) { api.focusMeeting(value); open(); } else if (new URLSearchParams(api.initialHash.slice(1)).has('meet')) { open(); content.prepend(el('p', '待ち合わせリンクを読み込めませんでした。作成した相手にリンクを確認してください。')); }
  return { get value() { return value; }, updateMarker, open };
}
