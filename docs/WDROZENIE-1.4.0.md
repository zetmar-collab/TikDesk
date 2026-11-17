# TikDesk 1.4.0 — wdrożenie zaleceń audytu

Data: 17 listopada 2026. Dokument opisuje wdrożenie wersji 1.4.0. Kod oraz instalator są udostępnione w repozytorium i wydaniu v1.4.0.

## Poprawki

| Audyt | Zmiana | Weryfikacja |
| --- | --- | --- |
| B1: zawieszone przygotowanie | Helper bounded z przerwaniem i timeoutem, odzyskanie stanu po anulowaniu, limit oczekiwania przy wyjściu. Timeout odczytu może zakończyć zawieszony renderer; strona wymaga wtedy odświeżenia. | Test nigdy nierozwiązanego Promise i rzeczywistego IPC anulowania w Electron. |
| B2: pozorny MP4 | Sprawdzanie hierarchii ścieżki, nagłówków, opisu kodeka/wymiarów i niepustych danych przed podmianą celu. | Wadliwy plik 44-bajtowy jest odrzucany; istniejący plik zachowany; rzeczywisty film pobrany. |
| B3: awaria procesu | Zapis historii przed połączeniem i ścieżki częściowej przed utworzeniem pliku, stan przerwany po restarcie i kontrolowane sprzątanie po decyzji użytkownika. | Przerwanie osobnego procesu testowego podczas transferu, odczyt historii i usunięcie wyłącznie powiązanego pliku częściowego. |
| B4: logowanie w małym oknie | Stały przycisk w nawigacji, niezależny od ukrywanej karty konta. | Kontrola DOM w oknie 800×640. |
| B5: duże metadane | Kolejka z indeksem, bez rozwijania tablicy w argumenty funkcji, ograniczenie liczby dodanych elementów. | Tablica 200 000 obiektów nie powoduje RangeError. |
| S1: minimatch | Override wyłącznie podatnych wersji do 11.0.1; bez zamiany starych głównych wersji o innym API. | npm audit: 0 alertów; NSIS zbudowany. |

Dodano także limit transferu 2 GB / 30 minut, sprawdzanie wolnego miejsca, obsługę proxy HTTP/HTTPS wybranego przez Chromium, osobne zgody na kamerę i mikrofon, normalizację domen cookies i widoczne błędy zapisu ustawień. Oczekiwanie przy wyjściu ma limit; w awaryjnym zakończeniu dane odzyskiwania pozostają do następnego startu.

## Osiem nowych funkcji

1. Szukanie, filtry i sortowanie pobrań/zakładek.
2. Usuwanie wpisów i czyszczenie historii po potwierdzeniu, rozpoznawanie brakujących plików. Gotowe filmy pozostają na dysku.
3. Zakładka oglądanego filmu z kanonicznym adresem, także na feedzie.
4. Podgląd i kopiowanie diagnostyki: wersje, liczniki, etapy i kody; bez cookies, treści wyjątków, adresów materiałów i prywatnych ścieżek.
5. Trwała kolejka do 50 zadań, Start/Pauza, anulowanie pojedynczego zadania i ponowne rozpoznawanie filmu po ID. Po restarcie czeka na Start. Praca kolejki otwiera strony filmów i zmienia główny widok.
6. Import/eksport zakładek JSON: limit 1 MB/100 pozycji, walidacja całości, usuwanie parametrów URL, informacja o duplikatach przed zatwierdzeniem.
7. Panel zgód z cofaniem oraz pomiar i czyszczenie cache bez usuwania sesji. Reset sesji wstrzymuje kolejkę i anuluje transfer.
8. Własne skróty: wykrywanie konfliktów, wyłączanie poleceń, przywracanie domyślnych, zapis po restarcie.

## Architektura i jakość

Dodano moduły async, queue, library, permissions i diagnostics. Pełny harness Electron przeniesiono z main do scripts/smoke.cjs, poza paczkę produkcyjną. Ustawienia i biblioteki pozostają w plikach JSON; nie wykonano migracji bazy ani usuwania danych użytkownika.

Dodano ESLint dla kodu, skryptów i testów. Typecheck JSDoc/checkJs jest stopniowy i obecnie obejmuje kontrakty async oraz diagnostics. Workflow CI przygotowano do lint/typecheck/audytu, testów, budowania NSIS, testu paczki, instalacji i deinstalacji na jednorazowym runnerze oraz zapisania raportów. Nie uruchamiano tej nowej konfiguracji zdalnie.

## Wyniki

- 47 testów jednostkowych/regresyjnych: zaliczone.
- Lint i skonfigurowany typecheck: zaliczone.
- Czteroprocesowy test restartu: zaliczony, również kolejka i własne skróty.
- Smoke Electron: zaliczony; nowe polecenia, filtry, logowanie w małym oknie, skróty i anulowanie sprawdzone.
- Rzeczywisty TikTok: udane pobranie i wykonanie rzeczywistego zadania kolejki; w ostatniej próbie każdy plik miał 1 331 915 bajtów.
- NSIS: instalator zbudowany. Gotowe EXE uruchomiono w osobnym profilu i sprawdzono start UI, IPC i izolację.
- Źródła src w app.asar odpowiadają źródłom lokalnym; zależność proxy undici jest w paczce.
- npm audit: 0 alertów; suma SHA-256 instalatora w dist/SHA256SUMS-1.4.0.txt.

Szczegóły maszynowe: artifacts/verification-1.4.0.json. Wygląd panelu Ustawienia został obejrzany na zrzucie. W ostatnim smoke ostrzeżenie UnknownVizError dotyczyło zrzutu zdalnego fixture; nie oznacza niepowodzenia testów funkcjonalnych i nie potwierdza obrazu tej konkretnej próbki. Harness wykrywa również zwrócenie poprzedniego obrazu panelu przez compositor.

## Granice weryfikacji i pozostałe ryzyka

- Instalator jest niepodpisany, ponieważ nie dostarczono certyfikatu Authenticode.
- Nie instalowano/deinstalowano aplikacji w zwykłym profilu Windows użytkownika. Test instalacji/deinstalacji przygotowano dla izolowanego CI; odbiór aktualizacji z poprzedniej wersji na docelowym Windows pozostaje potrzebny.
- Nie automatyzowano logowania ani działań na koncie TikTok, publikowania, używania rzeczywistej kamery/mikrofonu ani sieci firmowej. Nowe zgody i wybór proxy mają testy kontrolowane; odbiór z urządzeniami i rzeczywistym proxy pozostaje osobnym testem.
- SOCKS i uwierzytelnienie proxy nie są obsługiwane. Nie ma cichego przejścia do połączenia bezpośredniego po błędzie konfiguracji.
- Walidacja MP4 nie dekoduje wszystkich klatek. Rozpoznawanie materiału nadal zależy od bieżącej budowy strony TikToka.
- Odzyskiwanie obejmuje nowe zadania z powiązaniem pliku tymczasowego. Osieroconych plików starszych wersji bez takiego zapisu program nie identyfikuje i nie usuwa automatycznie.
- Raport smoke zawiera próbkę pamięci procesów, ale nie przeprowadzono długotrwałego benchmarku ani testu wszystkich konfiguracji DPI/monitorów.

Instalator: dist/TikDesk-Setup-1.4.0.exe. Instrukcja funkcji i testów znajduje się w README.md; lista zmian w CHANGELOG.md.
