# J.A.R.V.I.S. HUD

Asystent głosowy w stylu Jarvisa z Iron Mana: spokojny, przyrządowy interfejs z reaktorem, który reaguje na Twój głos, i sterowaniem po polsku.
„Mózgiem” jest **Cindy** uruchomiona na tym samym komputerze, czyli Claude Code / Codex
na Twoich subskrypcjach. HUD nie ma własnego klucza API i nic dodatkowo nie kosztuje.

```
[ przeglądarka: HUD + mikrofon + głos ]  ⇄  [ server.mjs (most) ]  ⇄  [ Cindy — lokalne API ]  ⇄  Claude / GPT
```

Most jest potrzebny, bo lokalne API Cindy celowo odrzuca zapytania wysyłane prosto z przeglądarek.

## Wymagania

- Windows 10/11
- [Node.js 22 LTS](https://nodejs.org)
- Cindy na komputerze, w wersji z lokalnym API dla aplikacji (to nowa funkcja, więc trzymaj Cindy zaktualizowaną)
- Microsoft Edge albo Chrome (rozpoznawanie mowy działa tylko w nich i wymaga internetu)

## Uruchomienie

1. Włącz Cindy.
2. Kliknij dwa razy `start.bat`.
3. W Cindy pojawi się okno z prośbą o połączenie aplikacji **„JARVIS HUD”**. Kliknij **Zezwól**.
4. Dotknij reaktora albo przytrzymaj **spację** i mów.

Bez Cindy możesz kliknąć **Tryb demo**. Wtedy sprawdzisz wygląd, mikrofon i głos, ale odpowiedzi nie generuje AI.

Zgoda w Cindy obowiązuje tylko do zamknięcia mostu. Po każdym uruchomieniu trzeba ją dać ponownie.
Tak jest bezpieczniej, bo token nie jest nigdzie zapisywany.

## Sterowanie

| Akcja | Jak |
|---|---|
| Mów (jedno polecenie) | dotknij rdzenia / przycisk **Mów** / przytrzymaj spację |
| Tryb „Jarvis, …” | w ustawieniach **Reaguj na słowo „Jarvis”**: HUD słucha cały czas |
| Przerwij mowę i odpowiedź | **Przerwij** albo `Esc` |
| Wpisz zamiast mówić | pole na dole + Enter |

Najlepiej brzmi głos **„Microsoft Marek Online (Natural)”** w Edge. Wybierzesz go w ustawieniach (ikona w prawym górnym rogu).

## Tło: obrazy i wideo

HUD rysuje rdzeń, teren, smugi światła i animację startu w kodzie, bez żadnych opłat.
Możesz dodać własne tło: wrzuć pliki do folderu `media/` (opis w [`media/README.md`](media/README.md)):

- `tlo.mp4`: zapętlone wideo (darmowe z Pixabay, Mixkit, Pexels albo własne z AI)
- `tlo.jpg`: nieruchome tło z efektem głębi
- `hologramy.jpg`: warstwa hologramów na czarnym tle

Własne wideo AI za darmo na Twoim komputerze: [`docs/wideo-ai-lokalnie.md`](docs/wideo-ai-lokalnie.md).

Jeśli radio przycina, wyłącz w ustawieniach **Pełne efekty** albo **Tło z folderu media**.

## Ustawienia (`config.json`)

Skopiuj `config.example.json` do `config.json` i zmień ustawienia według potrzeb:

| Pole | Znaczenie |
|---|---|
| `cwd` | folder, w którym agent pracuje (np. folder z projektami) |
| `toolPolicy` | `client-only` = agent tylko rozmawia (domyślne, bezpieczne). `native` = agent może czytać i zmieniać pliki w `cwd` oraz uruchamiać polecenia, więc włączaj to świadomie |
| `engine` | preferowany silnik: `claude-code`, `codex` albo `pi` |
| `model` | konkretny model; pusty = pierwszy pasujący (zmienisz go też w HUD) |

## Bezpieczeństwo

- Most słucha tylko na `127.0.0.1`, więc nie da się do niego wejść z innych urządzeń w sieci.
- Odrzuca zapytania z innych stron internetowych (sprawdza nagłówki Host i Origin), więc obca strona otwarta w przeglądarce nie może sterować agentem.
- Domyślnie agent nie ma dostępu do plików.

## Plan: Cindy w radiu (CarJarvis)

Etap 2, gdy radio ma internet:

- **A. Oficjalna aplikacja Cindy na Androida w radiu.** Łączy się z Cindy na komputerze przez chmurę Cindy (wymaga darmowego konta Cindy, a komputer musi być włączony). Najszybsza droga, ale bez wyglądu Iron Mana.
- **B. Ten HUD w radiu.** Radio otwiera HUD przez bezpieczny tunel do komputera (np. Tailscale) z dodatkowym PIN-em. CarJarvis dostaje kafelek „Jarvis”, który uruchamia HUD w trybie pełnoekranowym. Układ jest już przygotowany pod ekran 1024×600.

W aucie HUD ma działać głosem: krótkie odpowiedzi czytane na głos, bez czytania długich tekstów podczas jazdy.
