(() => {
  'use strict';

  const COLORS = ['#3b82f6', '#ef4444', '#22c55e'];
  const COLOR_NAMES = ['Niebieski', 'Czerwony', 'Zielony'];
  const LOGICAL_W = 360;
  const LOGICAL_H = 500;
  const BOARD_X = 180;
  const BOARD_Y = 190;
  const DEFAULTS = { boardR: 145, range: 70, stoneR: 15, offsetX: -45, offsetY: 55, shake: 0.35 };

  const $ = (id) => document.getElementById(id);
  const els = {
    lobbyView: $('lobbyView'), gameView: $('gameView'), localTab: $('localTab'), onlineTab: $('onlineTab'),
    localPanel: $('localPanel'), onlinePanel: $('onlinePanel'), onlineUnavailable: $('onlineUnavailable'),
    startLocalBtn: $('startLocalBtn'), createRoomBtn: $('createRoomBtn'), joinRoomBtn: $('joinRoomBtn'),
    createName: $('createName'), joinName: $('joinName'), joinCode: $('joinCode'), lobbyStatus: $('lobbyStatus'),
    roomLine: $('roomLine'), turnTitle: $('turnTitle'), gameStatus: $('gameStatus'), scoreboard: $('scoreboard'),
    canvas: $('gameCanvas'), resetRoundBtn: $('resetRoundBtn'), toggleSettingsBtn: $('toggleSettingsBtn'),
    settingsPanel: $('settingsPanel'), leaveGameBtn: $('leaveGameBtn'),
    boardR: $('boardR'), range: $('range'), offsetX: $('offsetX'), offsetY: $('offsetY'), shake: $('shake'),
    boardRVal: $('boardRVal'), rangeVal: $('rangeVal'), offsetXVal: $('offsetXVal'), offsetYVal: $('offsetYVal'), shakeVal: $('shakeVal')
  };
  const ctx = els.canvas.getContext('2d');

  let localPlayerCount = 2;
  let onlinePlayerCount = 2;
  let mode = 'local';
  let game = null;
  let myOnlinePlayer = null;
  let roomCode = null;
  let channel = null;
  let supabaseClient = null;
  let drag = null;
  let animation = null;
  let lastEventId = null;
  let busy = false;

  function onlineConfigured() {
    const cfg = window.KLUSTER_CONFIG || {};
    return Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY && window.supabase?.createClient);
  }

  if (onlineConfigured()) {
    const cfg = window.KLUSTER_CONFIG;
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
  } else {
    els.onlineUnavailable.classList.remove('hidden');
  }

  function setLobbyStatus(text, error = false) {
    els.lobbyStatus.textContent = text || '';
    els.lobbyStatus.style.color = error ? '#fca5a5' : '';
  }

  function setGameStatus(text) {
    els.gameStatus.textContent = text || '';
  }

  function selectTab(next) {
    const local = next === 'local';
    els.localTab.classList.toggle('active', local);
    els.onlineTab.classList.toggle('active', !local);
    els.localPanel.classList.toggle('hidden', !local);
    els.onlinePanel.classList.toggle('hidden', local);
  }

  els.localTab.addEventListener('click', () => selectTab('local'));
  els.onlineTab.addEventListener('click', () => selectTab('online'));

  document.querySelectorAll('.player-count').forEach(btn => btn.addEventListener('click', () => {
    localPlayerCount = Number(btn.dataset.count);
    document.querySelectorAll('.player-count').forEach(x => x.classList.toggle('active', x === btn));
  }));
  document.querySelectorAll('.online-count').forEach(btn => btn.addEventListener('click', () => {
    onlinePlayerCount = Number(btn.dataset.count);
    document.querySelectorAll('.online-count').forEach(x => x.classList.toggle('active', x === btn));
  }));

  function makeInitialState(count, players = null) {
    const p = players || Array.from({ length: count }, (_, seat) => ({
      id: `local-${seat}`,
      seat,
      name: `Gracz ${seat + 1}`,
      color: COLORS[seat]
    }));
    return {
      max_players: count,
      status: 'playing',
      players: p,
      hands: Array(count).fill(7),
      stones: [],
      current: 0,
      winner: null,
      event_seq: 0,
      last_event: null,
      settings: { boardR: DEFAULTS.boardR, range: DEFAULTS.range, stoneR: DEFAULTS.stoneR, shake: DEFAULTS.shake },
      version: 0
    };
  }

  function enterGame(nextMode, nextGame, code = null, player = null) {
    mode = nextMode;
    game = nextGame;
    roomCode = code;
    myOnlinePlayer = player;
    drag = null;
    animation = null;
    lastEventId = game.last_event?.id || null;
    els.lobbyView.classList.add('hidden');
    els.gameView.classList.remove('hidden');
    els.leaveGameBtn.classList.remove('hidden');
    els.settingsPanel.classList.add('hidden');
    els.roomLine.textContent = mode === 'online' ? `POKÓJ ${roomCode}` : `${game.max_players} GRACZY · LOKALNIE`;
    els.resetRoundBtn.textContent = mode === 'online' ? 'Reset rundy (host)' : 'Reset rundy';
    if (mode === 'online') {
      els.boardR.disabled = els.range.disabled = els.shake.disabled = true;
    } else {
      els.boardR.disabled = els.range.disabled = els.shake.disabled = false;
    }
    syncControlsFromGame();
    renderUI();
  }

  function leaveGame() {
    if (channel && supabaseClient) supabaseClient.removeChannel(channel);
    channel = null;
    game = null;
    roomCode = null;
    myOnlinePlayer = null;
    drag = null;
    animation = null;
    busy = false;
    els.gameView.classList.add('hidden');
    els.lobbyView.classList.remove('hidden');
    els.leaveGameBtn.classList.add('hidden');
    setLobbyStatus('');
  }

  els.leaveGameBtn.addEventListener('click', leaveGame);

  els.startLocalBtn.addEventListener('click', () => {
    enterGame('local', makeInitialState(localPlayerCount));
  });

  function syncControlsFromGame() {
    if (!game) return;
    const s = game.settings || DEFAULTS;
    els.boardR.value = s.boardR;
    els.range.value = s.range;
    els.shake.value = s.shake;
    els.offsetX.value = DEFAULTS.offsetX;
    els.offsetY.value = DEFAULTS.offsetY;
    updateControlLabels();
  }

  function updateControlLabels() {
    els.boardRVal.textContent = els.boardR.value;
    els.rangeVal.textContent = els.range.value;
    els.offsetXVal.textContent = els.offsetX.value;
    els.offsetYVal.textContent = els.offsetY.value;
    els.shakeVal.textContent = Number(els.shake.value).toFixed(2);
  }

  [els.boardR, els.range, els.offsetX, els.offsetY, els.shake].forEach(input => input.addEventListener('input', () => {
    updateControlLabels();
    if (mode === 'local' && game) {
      game.settings.boardR = Number(els.boardR.value);
      game.settings.range = Number(els.range.value);
      game.settings.shake = Number(els.shake.value);
    }
  }));

  els.toggleSettingsBtn.addEventListener('click', () => els.settingsPanel.classList.toggle('hidden'));

  function playerBySeat(seat) {
    return game?.players?.find(p => p.seat === seat) || { seat, name: `Gracz ${seat + 1}`, color: COLORS[seat] };
  }

  function isMyTurn() {
    if (!game || game.status !== 'playing' || game.winner !== null) return false;
    if (mode === 'local') return true;
    return myOnlinePlayer?.seat === game.current;
  }

  function renderUI() {
    if (!game) return;
    els.scoreboard.classList.toggle('three', game.max_players === 3);
    els.scoreboard.innerHTML = '';
    for (let seat = 0; seat < game.max_players; seat++) {
      const p = playerBySeat(seat);
      const card = document.createElement('div');
      card.className = 'score-card' + (game.current === seat && game.status === 'playing' ? ' active' : '');
      card.style.color = p.color || COLORS[seat];
      card.innerHTML = `<div class="score-name">${escapeHtml(p.name || COLOR_NAMES[seat])}</div><div class="score-count">${game.hands?.[seat] ?? 7}</div>`;
      els.scoreboard.appendChild(card);
    }

    if (game.status === 'waiting') {
      els.turnTitle.textContent = `Czekamy na graczy (${game.players.length}/${game.max_players})`;
      setGameStatus('Udostępnij kod pokoju. Gra ruszy automatycznie, gdy wszyscy dołączą.');
    } else if (game.winner !== null && game.winner !== undefined) {
      const p = playerBySeat(game.winner);
      els.turnTitle.textContent = `${p.name} wygrywa!`;
      setGameStatus('Pozbył się wszystkich swoich kamieni.');
    } else {
      const p = playerBySeat(game.current);
      els.turnTitle.textContent = `Tura: ${p.name}`;
      if (mode === 'online' && !isMyTurn()) setGameStatus('Czekasz na ruch drugiego gracza.');
      else setGameStatus('Złap kamień aktywnego gracza z dołu i połóż go w okręgu.');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }

  function sourcePosition(seat) {
    if (game.max_players === 2) return seat === 0 ? { x: 100, y: 455 } : { x: 260, y: 455 };
    return [{ x: 62, y: 455 }, { x: 180, y: 455 }, { x: 298, y: 455 }][seat];
  }

  function pointFromPointer(e) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * LOGICAL_W / rect.width,
      y: (e.clientY - rect.top) * LOGICAL_H / rect.height
    };
  }

  function insideBoard(x, y) {
    const r = game?.settings?.boardR ?? DEFAULTS.boardR;
    const stoneR = game?.settings?.stoneR ?? DEFAULTS.stoneR;
    return Math.hypot(x - BOARD_X, y - BOARD_Y) <= r - stoneR - 2;
  }

  els.canvas.addEventListener('pointerdown', (e) => {
    if (!game || busy || !isMyTurn() || game.status !== 'playing') return;
    const seat = game.current;
    if ((game.hands?.[seat] ?? 0) <= 0) return;
    const p = pointFromPointer(e);
    const src = sourcePosition(seat);
    if (Math.hypot(p.x - src.x, p.y - src.y) > 28) return;
    e.preventDefault();
    drag = { px: p.x, py: p.y, x: p.x + Number(els.offsetX.value), y: p.y + Number(els.offsetY.value), valid: false };
    drag.valid = insideBoard(drag.x, drag.y);
    try { els.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });

  els.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const p = pointFromPointer(e);
    drag.px = p.x; drag.py = p.y;
    drag.x = p.x + Number(els.offsetX.value);
    drag.y = p.y + Number(els.offsetY.value);
    drag.valid = insideBoard(drag.x, drag.y);
  });

  async function releaseDrag(e) {
    if (!drag) return;
    e.preventDefault();
    try { els.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    const placed = { x: drag.x, y: drag.y, valid: drag.valid };
    drag = null;
    if (!placed.valid) {
      setGameStatus('Kamień musi znaleźć się w całości w okręgu.');
      return;
    }
    if (mode === 'local') applyLocalMove(placed.x, placed.y);
    else await sendOnlineMove(placed.x, placed.y);
  }
  els.canvas.addEventListener('pointerup', releaseDrag);
  els.canvas.addEventListener('pointercancel', releaseDrag);

  function connectedComponent(stones, startId, range) {
    const byId = new Map(stones.map(s => [s.id, s]));
    const found = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      const a = byId.get(id);
      if (!a) continue;
      for (const b of stones) {
        if (found.has(b.id)) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) <= range) {
          found.add(b.id);
          queue.push(b.id);
        }
      }
    }
    return found;
  }

  function applyLocalMove(x, y) {
    if (!game || game.status !== 'playing') return;
    const seat = game.current;
    const state = structuredClone(game);
    state.version = (state.version || 0) + 1;
    state.event_seq = (state.event_seq || 0) + 1;
    state.hands[seat] -= 1;
    const stone = { id: `s-${state.version}-${Math.random().toString(36).slice(2, 7)}`, x, y, owner: seat };
    state.stones.push(stone);
    const comp = connectedComponent(state.stones, stone.id, state.settings.range);
    let event;
    if (comp.size > 1) {
      const reactionStones = state.stones.filter(s => comp.has(s.id));
      state.stones = state.stones.filter(s => !comp.has(s.id));
      state.hands[seat] += reactionStones.length;
      event = { id: `local-${state.event_seq}`, type: 'reaction', playerSeat: seat, reaction_stones: reactionStones, placed: stone };
      state.current = (seat + 1) % state.max_players;
    } else {
      event = { id: `local-${state.event_seq}`, type: 'place', playerSeat: seat, placed: stone };
      if (state.hands[seat] === 0) {
        state.winner = seat;
        state.status = 'finished';
      } else {
        state.current = (seat + 1) % state.max_players;
      }
    }
    state.last_event = event;
    setGameState(state, true);
  }

  function setGameState(next, animateNewEvent = true) {
    const incomingEvent = next?.last_event || null;
    const shouldAnimate = animateNewEvent && incomingEvent && incomingEvent.id !== lastEventId;
    game = next;
    if (shouldAnimate) startEventAnimation(incomingEvent);
    if (incomingEvent?.id) lastEventId = incomingEvent.id;
    syncControlsFromGame();
    renderUI();
  }

  function startEventAnimation(event) {
    if (event.type !== 'reaction') return;
    animation = { event, start: performance.now() };
  }

  async function api(body) {
    if (!onlineConfigured()) throw new Error('Supabase nie jest skonfigurowany.');
    const cfg = window.KLUSTER_CONFIG;
    const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/game-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
    return data;
  }

  els.createRoomBtn.addEventListener('click', async () => {
    if (!onlineConfigured()) return setLobbyStatus('Najpierw skonfiguruj Supabase w config.js.', true);
    try {
      setLobbyStatus('Tworzę pokój...');
      const data = await api({ action: 'create_room', maxPlayers: onlinePlayerCount, name: els.createName.value.trim() || 'Gracz 1' });
      saveSession(data.game.code, data.player);
      enterGame('online', data.game.state, data.game.code, data.player);
      await subscribeRoom(data.game.code);
    } catch (err) { setLobbyStatus(err.message, true); }
  });

  els.joinRoomBtn.addEventListener('click', async () => {
    if (!onlineConfigured()) return setLobbyStatus('Najpierw skonfiguruj Supabase w config.js.', true);
    const code = els.joinCode.value.trim().toUpperCase();
    if (code.length !== 6) return setLobbyStatus('Kod pokoju powinien mieć 6 znaków.', true);
    try {
      setLobbyStatus('Dołączam...');
      const data = await api({ action: 'join_room', code, name: els.joinName.value.trim() || 'Gracz' });
      saveSession(code, data.player);
      enterGame('online', data.game.state, code, data.player);
      await subscribeRoom(code);
    } catch (err) { setLobbyStatus(err.message, true); }
  });

  function saveSession(code, player) {
    localStorage.setItem(`kluster_session_${code}`, JSON.stringify(player));
    localStorage.setItem('kluster_last_room', code);
  }

  async function subscribeRoom(code) {
    if (channel) await supabaseClient.removeChannel(channel);
    channel = supabaseClient
      .channel(`game-${code}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `code=eq.${code}` }, payload => {
        if (payload.new?.state) setGameState(payload.new.state, true);
      })
      .subscribe();
  }

  async function sendOnlineMove(x, y) {
    if (!myOnlinePlayer || busy) return;
    busy = true;
    setGameStatus('Wysyłam ruch...');
    try {
      const data = await api({
        action: 'move', code: roomCode, playerId: myOnlinePlayer.id, token: myOnlinePlayer.token,
        x, y, version: game.version ?? 0
      });
      setGameState(data.game.state, true);
    } catch (err) {
      setGameStatus(err.message);
    } finally {
      busy = false;
    }
  }

  els.resetRoundBtn.addEventListener('click', async () => {
    if (!game) return;
    if (mode === 'local') {
      const count = game.max_players;
      const players = structuredClone(game.players);
      enterGame('local', makeInitialState(count, players));
      return;
    }
    if (!myOnlinePlayer) return;
    try {
      const data = await api({ action: 'reset', code: roomCode, playerId: myOnlinePlayer.id, token: myOnlinePlayer.token });
      setGameState(data.game.state, false);
    } catch (err) { setGameStatus(err.message); }
  });

  function drawStone(x, y, r, color, angle = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    const g = ctx.createRadialGradient(-r * .35, -r * .4, 2, 0, 0, r * 1.25);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(.2, color);
    g.addColorStop(1, '#111827');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      const rr = r * (.92 + .06 * Math.sin(i * 2.7));
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBoard(now) {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    if (!game) return;

    const boardR = game.settings?.boardR ?? DEFAULTS.boardR;
    const stoneR = game.settings?.stoneR ?? DEFAULTS.stoneR;

    ctx.save();
    ctx.beginPath();
    ctx.arc(BOARD_X, BOARD_Y, boardR, 0, Math.PI * 2);
    ctx.fillStyle = '#171d24';
    ctx.fill();
    ctx.strokeStyle = '#39424d';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    for (const s of game.stones || []) {
      drawStone(s.x, s.y, stoneR, COLORS[s.owner], 0);
    }

    if (animation) drawReactionAnimation(now, stoneR);

    if (drag) {
      ctx.save();
      ctx.strokeStyle = '#77818d';
      ctx.globalAlpha = .45;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(drag.px, drag.py);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
      ctx.restore();
      drawStone(drag.x, drag.y, stoneR, COLORS[game.current], 0, drag.valid ? 1 : .45);
    }

    const sourceY = 455;
    ctx.strokeStyle = '#303844';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(12, 420); ctx.lineTo(348, 420); ctx.stroke();
    ctx.setLineDash([]);

    for (let seat = 0; seat < game.max_players; seat++) {
      const src = sourcePosition(seat);
      const active = game.status === 'playing' && game.current === seat;
      drawStone(src.x, sourceY, 14, COLORS[seat], 0, active ? 1 : .55);
      ctx.fillStyle = COLORS[seat];
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(game.hands?.[seat] ?? 0), src.x, 487);
      if (active) {
        ctx.strokeStyle = COLORS[seat];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(src.x, sourceY, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawReactionAnimation(now, stoneR) {
    const event = animation.event;
    const stones = event.reaction_stones || [];
    if (!stones.length) { animation = null; return; }
    const shakeMs = (game.settings?.shake ?? DEFAULTS.shake) * 1000;
    const pullMs = 520;
    const elapsed = now - animation.start;
    const cx = stones.reduce((s, x) => s + x.x, 0) / stones.length;
    const cy = stones.reduce((s, x) => s + x.y, 0) / stones.length;

    if (elapsed < shakeMs) {
      const k = elapsed / shakeMs;
      stones.forEach((s, i) => {
        const amp = .4 + k * 2.6;
        const ox = Math.sin(now * .05 + i * 2.1) * amp;
        const oy = Math.cos(now * .061 + i * 1.3) * amp * .5;
        drawStone(s.x + ox, s.y + oy, stoneR, COLORS[s.owner], Math.sin(now * .04 + i) * .05 * k);
      });
      return;
    }

    const t = Math.min(1, (elapsed - shakeMs) / pullMs);
    const q = 1 - Math.pow(1 - t, 3);
    stones.forEach((s, i) => {
      const x = s.x + (cx - s.x) * q;
      const y = s.y + (cy - s.y) * q;
      drawStone(x, y, stoneR, COLORS[s.owner], q * (i % 2 ? 1 : -1), 1 - Math.max(0, (t - .8) / .2));
    });
    if (t >= 1) animation = null;
  }

  function frame(now) {
    drawBoard(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Canvas jest logicznie 360x500; CSS skaluje go responsywnie.
  els.canvas.width = LOGICAL_W;
  els.canvas.height = LOGICAL_H;
  updateControlLabels();
})();
