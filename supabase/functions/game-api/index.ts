import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const COLORS = ["#3b82f6", "#ef4444", "#22c55e"];
const DEFAULTS = { boardR: 145, range: 70, stoneR: 15, shake: 0.35 };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanName(v: unknown) {
  const s = String(v ?? "Gracz").trim().slice(0, 18);
  return s || "Gracz";
}

function code6() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashToken(token: string) {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function initialState(maxPlayers: number, firstPlayer: any) {
  return {
    max_players: maxPlayers,
    status: "waiting",
    players: [firstPlayer],
    hands: Array(maxPlayers).fill(7),
    stones: [],
    current: 0,
    winner: null,
    event_seq: 0,
    last_event: null,
    settings: DEFAULTS,
    version: 0,
  };
}

function connectedComponent(stones: any[], startId: string, range: number) {
  const byId = new Map(stones.map(s => [s.id, s]));
  const found = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
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

function insideBoard(x: number, y: number, state: any) {
  const boardX = 180, boardY = 190;
  const r = state.settings?.boardR ?? DEFAULTS.boardR;
  const stoneR = state.settings?.stoneR ?? DEFAULTS.stoneR;
  return Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - boardX, y - boardY) <= r - stoneR - 2;
}

async function findGame(code: string) {
  const { data, error } = await admin.from("games").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  return data;
}

async function verifyPlayer(gameId: string, playerId: string, token: string) {
  const { data, error } = await admin.from("game_players").select("*").eq("game_id", gameId).eq("id", playerId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const hash = await hashToken(token);
  return hash === data.token_hash ? data : null;
}

async function createRoom(body: any) {
  const maxPlayers = Number(body.maxPlayers);
  if (![2,3].includes(maxPlayers)) return json({ error: "Dozwolone są 2 albo 3 osoby." }, 400);
  const playerId = crypto.randomUUID();
  const token = randomToken();
  const player = { id: playerId, seat: 0, name: cleanName(body.name), color: COLORS[0] };

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = code6();
    const state = initialState(maxPlayers, player);
    const { data: game, error } = await admin.from("games").insert({ code, max_players: maxPlayers, status: "waiting", state, version: 0 }).select("*").single();
    if (error) {
      if (String(error.code) === "23505") continue;
      throw error;
    }
    const tokenHash = await hashToken(token);
    const { error: playerError } = await admin.from("game_players").insert({
      id: playerId, game_id: game.id, seat: 0, name: player.name, color: player.color, token_hash: tokenHash
    });
    if (playerError) throw playerError;
    return json({ game: { code, state }, player: { ...player, token } });
  }
  return json({ error: "Nie udało się wygenerować kodu pokoju." }, 500);
}

async function joinRoom(body: any) {
  const code = String(body.code ?? "").trim().toUpperCase();
  const game = await findGame(code);
  if (!game) return json({ error: "Nie znaleziono pokoju." }, 404);
  const state = structuredClone(game.state);
  if (state.status === "finished") return json({ error: "Ta rozgrywka już się zakończyła." }, 409);

  const { data: existing, error: pErr } = await admin.from("game_players").select("seat").eq("game_id", game.id);
  if (pErr) throw pErr;
  const used = new Set((existing ?? []).map((p: any) => p.seat));
  let seat = -1;
  for (let i = 0; i < game.max_players; i++) if (!used.has(i)) { seat = i; break; }
  if (seat < 0) return json({ error: "Pokój jest pełny." }, 409);

  const playerId = crypto.randomUUID();
  const token = randomToken();
  const player = { id: playerId, seat, name: cleanName(body.name), color: COLORS[seat] };
  const tokenHash = await hashToken(token);

  const { error: insertError } = await admin.from("game_players").insert({
    id: playerId, game_id: game.id, seat, name: player.name, color: player.color, token_hash: tokenHash
  });
  if (insertError) return json({ error: "Ktoś dołączył w tej samej chwili. Spróbuj ponownie." }, 409);

  state.players.push(player);
  state.players.sort((a: any, b: any) => a.seat - b.seat);
  if (state.players.length === game.max_players) state.status = "playing";
  state.version = Number(game.version) + 1;

  const { data: updated, error: updateError } = await admin.from("games")
    .update({ state, status: state.status, version: state.version })
    .eq("id", game.id).eq("version", game.version).select("*").maybeSingle();

  if (updateError || !updated) {
    await admin.from("game_players").delete().eq("id", playerId);
    return json({ error: "Pokój zmienił się w trakcie dołączania. Spróbuj jeszcze raz." }, 409);
  }

  return json({ game: { code, state }, player: { ...player, token } });
}

async function move(body: any) {
  const code = String(body.code ?? "").trim().toUpperCase();
  const game = await findGame(code);
  if (!game) return json({ error: "Nie znaleziono pokoju." }, 404);
  const player = await verifyPlayer(game.id, String(body.playerId ?? ""), String(body.token ?? ""));
  if (!player) return json({ error: "Nieprawidłowa sesja gracza." }, 401);

  if (Number(body.version) !== Number(game.version)) return json({ error: "Stan gry właśnie się zmienił. Spróbuj ruch ponownie." }, 409);
  const state = structuredClone(game.state);
  if (state.status !== "playing" || state.winner !== null) return json({ error: "Gra nie jest aktywna." }, 409);
  if (player.seat !== state.current) return json({ error: "To nie jest Twoja tura." }, 409);
  if ((state.hands[player.seat] ?? 0) <= 0) return json({ error: "Nie masz już kamieni." }, 409);

  const x = Number(body.x), y = Number(body.y);
  if (!insideBoard(x, y, state)) return json({ error: "Kamień musi znaleźć się w całości w okręgu." }, 400);

  state.hands[player.seat] -= 1;
  const stone = { id: crypto.randomUUID(), x, y, owner: player.seat };
  state.stones.push(stone);
  const component = connectedComponent(state.stones, stone.id, state.settings?.range ?? DEFAULTS.range);
  state.event_seq = Number(state.event_seq || 0) + 1;

  if (component.size > 1) {
    const reactionStones = state.stones.filter((s: any) => component.has(s.id));
    state.stones = state.stones.filter((s: any) => !component.has(s.id));
    state.hands[player.seat] += reactionStones.length;
    state.last_event = {
      id: `${game.version + 1}-${crypto.randomUUID()}`,
      seq: state.event_seq,
      type: "reaction",
      playerSeat: player.seat,
      placed: stone,
      reaction_stones: reactionStones
    };
    state.current = (player.seat + 1) % state.max_players;
  } else {
    state.last_event = {
      id: `${game.version + 1}-${crypto.randomUUID()}`,
      seq: state.event_seq,
      type: "place",
      playerSeat: player.seat,
      placed: stone
    };
    if (state.hands[player.seat] === 0) {
      state.winner = player.seat;
      state.status = "finished";
    } else {
      state.current = (player.seat + 1) % state.max_players;
    }
  }

  state.version = Number(game.version) + 1;
  const { data: updated, error } = await admin.from("games")
    .update({ state, status: state.status, version: state.version })
    .eq("id", game.id).eq("version", game.version).select("*").maybeSingle();
  if (error || !updated) return json({ error: "Ktoś wykonał ruch w tym samym momencie. Odśwież stan." }, 409);
  return json({ game: { code, state } });
}

async function resetRoom(body: any) {
  const code = String(body.code ?? "").trim().toUpperCase();
  const game = await findGame(code);
  if (!game) return json({ error: "Nie znaleziono pokoju." }, 404);
  const player = await verifyPlayer(game.id, String(body.playerId ?? ""), String(body.token ?? ""));
  if (!player) return json({ error: "Nieprawidłowa sesja gracza." }, 401);
  if (player.seat !== 0) return json({ error: "Tylko host może zresetować rundę." }, 403);

  const state = structuredClone(game.state);
  state.hands = Array(state.max_players).fill(7);
  state.stones = [];
  state.current = 0;
  state.winner = null;
  state.last_event = null;
  state.event_seq = 0;
  state.status = state.players.length === state.max_players ? "playing" : "waiting";
  state.version = Number(game.version) + 1;

  const { error } = await admin.from("games").update({ state, status: state.status, version: state.version }).eq("id", game.id);
  if (error) throw error;
  return json({ game: { code, state } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    switch (body.action) {
      case "create_room": return await createRoom(body);
      case "join_room": return await joinRoom(body);
      case "move": return await move(body);
      case "reset": return await resetRoom(body);
      default: return json({ error: "Nieznana akcja." }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Błąd serwera." }, 500);
  }
});
