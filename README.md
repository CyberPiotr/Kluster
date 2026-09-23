# Kluster Prototype

Mobilny prototyp gry inspirowanej Kluster, przygotowany do testów lokalnych i online.

## Status

- 2 albo 3 graczy
- po 8 kamieni na gracza
- tryb lokalny na jednym urządzeniu
- tryb online przez kod pokoju
- Supabase Realtime
- serwerowe rozstrzyganie ruchów przez Edge Function
- deterministyczna reakcja: drżenie -> przyciągnięcie -> KLACK
- reset rundy
- host = gracz 1

## Aktualne ustawienia

- promień planszy: 145 px
- zasięg magnesu: 70 px
- offset kamienia względem palca: -45 px poziomo / +55 px pionowo
- drżenie: 0,35 s
- kamienie: 8 na gracza
- pajęczy zmysł: wyłączony

## Test online

Aktualna wersja testowa jest wystawiona przez Supabase Edge Function:

https://irkurcebsgisfnnharwz.supabase.co/functions/v1/kluster-web

### Jak zagrać

1. Otwórz link na pierwszym telefonie.
2. Wejdź w **Online**.
3. Wybierz **2 graczy** albo **3 graczy**.
4. Wpisz nick i kliknij **Utwórz pokój**.
5. Gra pokaże 6-znakowy kod pokoju.
6. Otwórz ten sam link na drugim / trzecim telefonie.
7. Wejdź w **Online -> Dołącz**.
8. Wpisz nick oraz kod pokoju.
9. Gdy komplet graczy dołączy, gra rozpocznie się automatycznie.

## Architektura online

Frontend nie decyduje o wyniku ruchu.

1. Gracz wysyła pozycję kamienia do `game-api`.
2. Edge Function sprawdza gracza, turę i wersję stanu.
3. Serwer wylicza reakcję magnetyczną.
4. Stan jest zapisywany w Postgres.
5. Supabase Realtime przekazuje nowy stan pozostałym graczom.
6. Telefony odtwarzają tę samą animację.

## Supabase

Projekt: **Kluster**

Region: **eu-central-1**

Tabele:
- `games`
- `game_players`

Edge Functions:
- `game-api`
- `kluster-web`

RLS jest włączone. Dane uwierzytelniające graczy są przechowywane jako hashe tokenów. Service role nie trafia do frontendu.

## Git

- `main` — baza
- `klustertest` — aktywna gałąź testowa

Frontend na gałęzi `klustertest` jest skonfigurowany pod projekt Supabase Kluster.

## Uwaga

To nadal prototyp do sprawdzania frajdy i zasad. Nie ma jeszcze m.in. matchmakingu, trwałych kont, rankingu, reconnectu po utracie lokalnego tokenu ani pełnej fizyki biegunów magnetycznych.


## Test rozrywki

Gałąź `test-rozrywki` służy do eksperymentów poprawiających odczucie gry.

Aktualny eksperyment:
- proceduralny dźwięk zderzenia magnesów generowany przez Web Audio API,
- dźwięk odpala się w końcowej fazie animacji przyciągania,
- głośność lekko rośnie wraz z liczbą kamieni objętych reakcją,
- brak zewnętrznego pliku audio i problemów licencyjnych.
